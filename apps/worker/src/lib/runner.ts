import { execFile, spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { ClaimedStory, CriterionEvent } from '@cenzontle/shared';
import { ApiClient, ApiError } from './api-client.js';
import { logger } from './logger.js';
import { wrapWithSandbox } from './sandbox.js';
import {
  startTailFollowSession,
  readOutputTail,
  cleanupSession,
  hasTmuxAndTtyd,
  type TtydSession,
} from './tmux-ttyd.js';
import {
  verifyDoDCriteria,
  buildRetryPrompt,
  hasFailedCriteria,
  extractFailedCriteria,
  extractPassedCriteria,
  type CriterionVerdict,
} from './dod-verifier.js';
import {
  sanitizeExternalSecrets,
  buildSecretEnv,
  serializeDotenv,
  makeRedactor,
  redactSecrets,
  scanDiffForSecrets,
} from './secrets.js';
import {
  resolveMaxDodAttempts,
  evaluateDoomLoop,
  INITIAL_DOOM_LOOP_STATE,
  DOOM_LOOP_THRESHOLD,
  type DoomLoopState,
} from './dod-retry.js';

/**
 * Lista hardcoded de milestones técnicos del worker (workflow del run).
 * Se inicializan en `pending` y se marcan `completed`/`failed` a medida
 * que el flow avanza. Visibles en UI como pill SECUNDARIA "workflow" —
 * útiles para diagnosis técnica (¿el clone falló? ¿el push falló?).
 *
 * Los milestones PRIMARIOS son los acceptance criteria de la story (vienen
 * de `claimed.acceptanceCriteria`, parseados del vault por el backend) y
 * los marca individualmente el verifier Sonnet per-criterio.
 */
const WORKER_MILESTONES: Array<{ id: string; label: string }> = [
  { id: 'workdir.ready', label: 'Espacio de trabajo listo' },
  { id: 'repo.cloned', label: 'Repositorio clonado' },
  { id: 'claude.spawned', label: 'Claude ejecutando' },
  { id: 'claude.exited', label: 'Claude terminó' },
  { id: 'auto.commit', label: 'Cambios committeados' },
  { id: 'branch.pushed', label: 'Branch en remote' },
];

const execFileAsync = promisify(execFile);

/**
 * Helper para correr `git` en el workdir. Usa `execFile` (no `exec`) para
 * pasar args como array sin shell parsing — protección contra args maliciosos
 * que pudieran venir de un branch name comprometido.
 *
 * El env explícito incluye GIT_TERMINAL_PROMPT=0 para que git nunca pida
 * password interactivamente (failure inmediato si el token no funciona, en
 * vez de quedarse colgado esperando input que nunca llega).
 */
async function git(
  args: string[],
  cwd: string,
  maxBuffer = 10 * 1024 * 1024,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    env: {
      HOME: process.env.HOME ?? '',
      PATH: process.env.PATH ?? '',
      USER: process.env.USER ?? '',
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      // Crítico: si el token del clone URL falla, queremos que git falle
      // RÁPIDO con código no-cero, no que se quede esperando un prompt.
      GIT_TERMINAL_PROMPT: '0',
    },
    // Default 10MB cubre el output del clone; el escaneo pre-push lo amplía
    // — un diff grande legítimo no debe fallar-cerrado el push.
    maxBuffer,
  });
}

// Re-export para compat con callers que importaban desde aquí.
export type { ClaimedStory } from '@cenzontle/shared';

/**
 * Patrones que NUNCA deben llegar a un commit del Forge: dependencias y
 * artefactos de build. Si el agente los commitea, el diff explota (el caso
 * real del 2026-05-27: 37k archivos / 6.4M líneas de node_modules → el
 * escaneo de secretos pre-push excede maxBuffer y aborta el push).
 */
const MANDATORY_GITIGNORE_PATTERNS = [
  'node_modules/',
  '.next/',
  'out/',
  'dist/',
  'build/',
  '.turbo/',
  '.cache/',
  'coverage/',
  '.nyc_output/',
  '*.tsbuildinfo',
  'tsconfig.tsbuildinfo',
  '.vercel/',
  '.lighthouseci/',
  '.DS_Store',
  '*.log',
];

/** Dirs concretos a sacar del índice si el agente los stageó/commiteó. */
const BUILD_ARTIFACT_DIRS = [
  'node_modules',
  '.next',
  'out',
  'dist',
  'build',
  '.turbo',
  '.cache',
  'coverage',
  '.nyc_output',
];

/**
 * GARANTÍA determinista del harness: asegura que el workdir tenga un
 * `.gitignore` con los patrones obligatorios ANTES de que el worker stagee
 * nada. Devuelve cuántos patrones agregó.
 *
 * Por qué vive en el worker y NO solo en el prompt: el agente (LLM) puede
 * olvidar crear `.gitignore`, crear uno incompleto, o que `create-next-app`
 * lo sobrescriba. Confiar en el prompt = no-determinista → el bug vuelve.
 * El worker es código que SIEMPRE corre → garantiza la invariante.
 * Principio de harness engineering: no delegar invariantes al modelo.
 */
async function ensureGitignorePatterns(workdir: string, runId: string): Promise<number> {
  const gitignorePath = join(workdir, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    // No existe — se crea desde cero abajo.
  }
  // Normaliza un patrón para comparación SEMÁNTICA: quita slash inicial/final
  // y sufijos `/*` para que `/node_modules`, `node_modules`, `node_modules/`
  // y `node_modules/*` se traten como el mismo patrón (qa-reviewer #5 — evita
  // duplicar líneas y logs engañosos).
  const normalize = (p: string): string =>
    p.trim().replace(/^\//, '').replace(/\/\*?$/, '');
  const existingNormalized = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .map(normalize),
  );
  const missing = MANDATORY_GITIGNORE_PATTERNS.filter(
    (p) => !existingNormalized.has(normalize(p)),
  );
  if (missing.length === 0) return 0;

  const header = existing.trim().length > 0 ? `${existing.trimEnd()}\n` : '';
  const block = `\n# === CENZONTLE Forge — patrones obligatorios (auto-añadidos) ===\n${missing.join('\n')}\n`;
  await fs.writeFile(gitignorePath, header + block, { encoding: 'utf-8' });
  logger.info(
    { event: 'git.gitignore.ensured', runId, addedCount: missing.length, patterns: missing },
    `.gitignore: añadidos ${missing.length} patrón(es) obligatorio(s) faltante(s)`,
  );
  return missing.length;
}

/**
 * Redacta credenciales embebidas en una URL de clone/remote del texto de un
 * error de git. Cuando `git clone`/`git push` falla por auth, git suele
 * incluir la URL completa en su mensaje — p.ej.
 * `fatal: Authentication failed for 'https://x-access-token:TOKEN@github.com/o/r.git'`.
 * Si esa URL trae un token embebido, el mensaje crudo lo filtraría: el worker
 * lo manda al backend (se persiste en `agent_runs.errorMessage` y se muestra
 * en la UI) y lo loguea. Extraemos user/password de `repoUrl` y los
 * reemplazamos por '***'; si la URL traía credenciales (o no se pudo
 * parsear), reemplazamos además la URL completa como defensa extra. Un
 * `repoUrl` limpio (sin token) se deja intacto — no es secreto y oculta
 * qué repo falló sería peor UX.
 *
 * Exportada para test unitario (secrets-críticos → cobertura explícita).
 */
export function redactRepoUrlCredentials(
  text: string,
  repoUrl: string | null,
): string {
  if (!text || !repoUrl) return text;
  let out = text;
  let hadCredentials = false;
  try {
    const u = new URL(repoUrl);
    // Redactamos cualquier credencial no vacía. La heurística anterior de
    // `length >= 4` para evitar "ruido de substrings" filtraba tokens
    // legítimos de 1-3 chars (el sanitizer del DTO no garantiza longitud
    // mínima en `repoUrl`, y proveedores custom pueden usar tokens cortos
    // como passwords HTTP Basic). Preferir falsos positivos benignos
    // (substring común redactado) antes que filtrar una credencial real.
    for (const cred of [u.password, u.username]) {
      if (cred && cred.length >= 1) {
        out = out.split(cred).join('***');
        hadCredentials = true;
      }
    }
  } catch {
    // repoUrl no parseable como URL — no podemos extraer user/pass; por
    // seguridad asumimos que PUEDE traer credenciales y redactamos entero.
    hadCredentials = true;
  }
  return hadCredentials ? out.split(repoUrl).join('<repo-url>') : out;
}

/**
 * Threshold ms — kill el proceso `claude` si excede esta duración.
 *
 * DEFAULT 30 min, pero el valor AUTORITATIVO viene del backend en el
 * claim payload (`ClaimedStory.forgeWorkerMaxRunDurationMs`), configurable
 * desde `/factory/settings → tab Factory`. Esta constante se usa SOLO como
 * red de seguridad cuando:
 *   - El backend es viejo y NO incluye el campo (claim legacy).
 *   - El valor del backend es 0/NaN/negativo (defensa contra basura).
 *
 * Rango válido cuando viene del backend: 300_000 (5 min) .. 7_200_000 (2h).
 * Stories con muchos componentes UI o tests pesados típicamente necesitan
 * 3_600_000-5_400_000 (60-90 min) — el viejo default de 30 min mataba runs
 * justo antes del commit (observado run cb180125, 11 componentes pixel-perfect).
 */
export const MAX_RUN_DURATION_MS_DEFAULT = 30 * 60 * 1000;
export const MAX_RUN_DURATION_MS_MIN = 300_000; // 5 min — clamp inferior
export const MAX_RUN_DURATION_MS_MAX = 7_200_000; // 2 h — clamp superior

/**
 * Resuelve el max run duration efectivo del worker para un run dado.
 *
 * Algoritmo:
 *   1. Si el backend NO envió el campo (legacy claim, deploy parcial) o
 *      envió un valor inválido (NaN, ≤0, negativo) → DEFAULT 30 min.
 *   2. Si envió un valor válido pero fuera del rango [MIN, MAX] → CLAMP
 *      al borde más cercano. `clamped: true` para que el caller pueda log.
 *   3. Si envió un valor dentro del rango → pasa tal cual con `clamped: false`.
 *
 * `source` distingue "backend" (el operador configuró) vs "default" (no
 * configurado o fallback) para observabilidad. Sin esto, no podríamos
 * saber en producción si un timeout efectivo viene de un default
 * accidental vs de una decisión del operador.
 *
 * Función pura exportada para testing — la lógica vive acá y `runStory`
 * solo la llama. Ver runner.timeout-resolver.spec.ts.
 */
export function resolveMaxRunDurationMs(
  backendValue: number | undefined,
): { value: number; source: 'backend' | 'default'; clamped: boolean } {
  if (typeof backendValue !== 'number' || !Number.isFinite(backendValue) || backendValue <= 0) {
    return { value: MAX_RUN_DURATION_MS_DEFAULT, source: 'default', clamped: false };
  }
  const clamped = Math.min(MAX_RUN_DURATION_MS_MAX, Math.max(MAX_RUN_DURATION_MS_MIN, backendValue));
  return {
    value: clamped,
    source: 'backend',
    clamped: clamped !== backendValue,
  };
}

/**
 * Observabilidad de "agente colgado". Si los running tokens (in/out) NO se
 * mueven entre N iteraciones consecutivas del progress timer (cada 30s), el
 * agente probablemente está atorado en una tool call que no retorna —
 * típicamente `vitest`/`jest` sin `--run`, `next dev`, etc. Loggeamos warn
 * cuando se cumple el threshold y escalamos a ERROR tras un segundo umbral.
 *
 * No matamos automáticamente — un operator puede querer revisar antes de
 * intervenir. El log estructurado da contexto suficiente (last tool, pid,
 * cpu/mem) para decidir kill manual.
 */
const STUCK_DETECT_TOKEN_FREEZE_TICKS = 3; // 3 ticks × 30s = 90s
const STUCK_LIKELY_HANG_TICKS = 10; // 10 ticks × 30s = 5min

/**
 * Threshold ms — una bash task en background que excede esta duración se
 * marca como `long_running`. 60s es razonable: builds/installs típicos
 * caben; un `vitest` en watch mode lo excede ampliamente.
 */
const BASH_LONG_RUNNING_THRESHOLD_MS = 60_000;

/**
 * Patrones heurísticos de comandos en watch mode que NUNCA salen.
 * Cada entry es {regex, label} — match positivo en el comando de un Bash
 * tool call activa el log `bash.task.likely_watch_mode`.
 *
 * Mantener conservador — un falso positivo confunde, pero los siguientes
 * son comandos que en headless mode JAMÁS terminan por sí solos:
 *   - vitest sin --run (default es watch mode)
 *   - jest --watch / --watchAll
 *   - nodemon
 *   - next dev (sin build & start)
 *   - npm/pnpm/yarn run dev
 *   - tsc --watch
 */
const WATCH_MODE_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /\bvitest\b(?!.*--run\b)/, label: 'vitest sin --run (default watch)' },
  { regex: /\bjest\b.*--watch(All)?\b/, label: 'jest --watch' },
  { regex: /\bnodemon\b/, label: 'nodemon' },
  { regex: /\bnext\s+dev\b/, label: 'next dev' },
  { regex: /\b(npm|pnpm|yarn)\s+run\s+dev\b/, label: 'package script dev' },
  { regex: /\btsc\b.*--watch\b/, label: 'tsc --watch' },
];

/**
 * Directorio donde se persisten los `/complete` payloads que NO se pudieron
 * reportar al backend tras agotar los retries del ApiClient. Cada archivo es
 * `{runId}.json` con `{ runId, payload, savedAt, attemptsExhausted }`.
 *
 * Vive bajo `~/.factory-worker/pending-completes/` — colocalizado con el
 * config del worker. Permisos 0700 al directorio + 0600 a los archivos: el
 * payload puede contener `errorMessage` con stderr crudo (post-redacción)
 * y nombres de archivos del repo.
 *
 * Boot recovery: en `start.ts` el daemon lee el dir al arrancar, intenta
 * re-reportar cada archivo y, en éxito, lo borra. Si falla, se conserva
 * para el próximo restart.
 */
const PENDING_COMPLETES_DIR = join(homedir(), '.factory-worker', 'pending-completes');

/**
 * Snapshot del estado de runningTokens para detección de freeze. Tracking
 * minimal: solo necesitamos saber si in/out cambiaron y desde cuándo el
 * último cambio. `lastToolCall` lo capturamos del último `tool_use` del
 * stream-json del agente — proporciona forensics si el agente se cuelga
 * (ej: "stuck after Bash: vitest").
 */
interface StuckDetectState {
  lastInputTokens: number;
  lastOutputTokens: number;
  noChangeTicks: number;
  lastToolCall: { name: string; inputPreview: string } | null;
}

/**
 * Una bash task en background que el agente lanzó. Se trackea por
 * heurística (input de tool_use con `run_in_background: true`) para detectar
 * runs largos y comandos en watch mode. La key del Map es un hash sintético
 * del comando + startedAt — el agente no expone un task ID estable.
 */
interface BashTaskInfo {
  command: string;
  startedAt: number;
  /** Indica si ya emitimos el WARN long_running para evitar spam de logs. */
  longRunningLogged: boolean;
  /** Match de WATCH_MODE_PATTERNS ya logueado para evitar spam. */
  watchModeLogged: boolean;
}

/**
 * Inspecciona stats de un proceso vía `ps` (CPU% y RSS en KB). Pure best-effort:
 * si `ps` falla por cualquier razón, retorna `null` — no debe fallar el flujo.
 *
 * Cross-platform (darwin/linux): el formato de columnas es estable. En BSD/macOS
 * usamos `-o pid,%cpu,rss,comm`; en Linux GNU el mismo formato funciona.
 */
async function getProcessStats(
  pid: number,
): Promise<{ cpuPercent: number; rssKb: number; comm: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-p', String(pid), '-o', 'pid=,%cpu=,rss=,comm='],
      { timeout: 2000 },
    );
    const line = stdout.trim();
    if (!line) return null;
    // Columnas separadas por whitespace. `comm` (último campo) puede tener
    // espacios — los toleramos uniendo el resto.
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 4) return null;
    const cpuPercent = parseFloat(parts[1]) || 0;
    const rssKb = parseInt(parts[2], 10) || 0;
    const comm = parts.slice(3).join(' ');
    return { cpuPercent, rssKb, comm };
  } catch {
    return null;
  }
}

/**
 * Persiste un `/complete` payload no reportable a `~/.factory-worker/pending-completes/{runId}.json`.
 * Mkdir-recursive con `mode: 0o700` y archivo con `mode: 0o600` — el payload
 * puede contener stderr (post-redacción) y paths del repo: protegerlo del
 * resto del sistema es defensa en profundidad.
 *
 * `recoveryBlockedByDto`: cuando el backend rechazó el complete con 400 por
 * validación de DTO (incidente real del 2026-05-25: criterionId > 200 chars),
 * persistimos igual el payload para que el operador pueda recuperarlo a mano
 * — PERO marcamos el archivo para que `recoverOnePendingComplete` NO lo
 * reintente al próximo boot (el DTO seguiría rechazando hasta que el bug se
 * arregle y el worker se redespliegue).
 *
 * No-throws: si el write falla, loguea WARN y sigue (el sweeper backend marca
 * abandoned si nada llega). Cualquier excepción acá sería peor que el silencio.
 */
async function writePendingComplete(
  runId: string,
  payload: Record<string, unknown>,
  attemptsExhausted: number,
  recoveryBlockedByDto = false,
  backendErrorBody: unknown = null,
): Promise<string | null> {
  try {
    await fs.mkdir(PENDING_COMPLETES_DIR, { recursive: true, mode: 0o700 });
    const filePath = join(PENDING_COMPLETES_DIR, `${runId}.json`);
    const body = JSON.stringify(
      {
        runId,
        payload,
        savedAt: new Date().toISOString(),
        attemptsExhausted,
        recovery_blocked_by_dto: recoveryBlockedByDto,
        backendErrorBody: recoveryBlockedByDto ? backendErrorBody : undefined,
      },
      null,
      2,
    );
    await fs.writeFile(filePath, body, { encoding: 'utf-8', mode: 0o600 });
    return filePath;
  } catch (err) {
    logger.warn(
      {
        event: 'complete.pending.write_fail',
        runId,
        error: (err as Error).message,
      },
      'No se pudo persistir el /complete pendiente — boot recovery no podrá reintentarlo',
    );
    return null;
  }
}

/**
 * Path del directorio de pending completes (helper para que start.ts pueda
 * importarlo sin duplicar el literal). Boot recovery vive en start.ts.
 */
export function getPendingCompletesDir(): string {
  return PENDING_COMPLETES_DIR;
}

/**
 * Re-reporta un único pending complete al backend. Usado por boot recovery
 * en start.ts. Si éxito → borra el archivo. Si fail con 409/410 (run ya
 * terminal en backend) → borra el archivo (no hay nada que recuperar). Si
 * fail con otro motivo → conserva el archivo y loguea para próximo retry.
 *
 * Retorna `true` si el archivo fue borrado (éxito o terminal), `false` si
 * debe conservarse.
 */
export async function recoverOnePendingComplete(
  client: ApiClient,
  filePath: string,
): Promise<boolean> {
  let parsed: {
    runId?: string;
    payload?: Record<string, unknown>;
    savedAt?: string;
    recovery_blocked_by_dto?: boolean;
    backendErrorBody?: unknown;
  };
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      {
        event: 'complete.recovery.read_fail',
        filePath,
        error: (err as Error).message,
      },
      `No se pudo leer el pending complete — borrando archivo corrupto`,
    );
    // Archivo corrupto: borrarlo (re-leerlo cada boot sería infinito spam).
    await fs.unlink(filePath).catch(() => undefined);
    return true;
  }
  const runId = parsed.runId;
  if (!runId || !parsed.payload) {
    logger.warn(
      { event: 'complete.recovery.malformed', filePath },
      'Pending complete sin runId/payload — borrando',
    );
    await fs.unlink(filePath).catch(() => undefined);
    return true;
  }
  // Archivos marcados `recovery_blocked_by_dto` se persistieron porque el
  // backend rechazó el complete con 400 (DTO validation). Reintentar daría
  // el mismo 400 — solo loguear WARN y CONSERVAR el archivo para que el
  // operador lo revise (probablemente edite el JSON o levante un fix del
  // DTO y luego renombre el archivo para forzar reintento manual).
  if (parsed.recovery_blocked_by_dto === true) {
    logger.warn(
      {
        event: 'complete.recovery.blocked_by_dto',
        runId,
        filePath,
        savedAt: parsed.savedAt,
        backendErrorBody: parsed.backendErrorBody,
      },
      `[recovery] /complete diferido marcado recovery_blocked_by_dto=true — NO se reintenta automáticamente (el backend lo seguiría rechazando con 400). Revisar manualmente: ${filePath}`,
    );
    // Retornamos `false` para que el caller lo cuente como "still pending"
    // sin borrarlo. Sigue ocupando un slot en el directorio hasta que el
    // operador intervenga.
    return false;
  }
  try {
    await client.post(`/factory/workers/runs/${runId}/complete`, parsed.payload);
    logger.info(
      { event: 'complete.recovery.ok', runId, savedAt: parsed.savedAt },
      `[recovery] /complete diferido reportado exitosamente al backend`,
    );
    await fs.unlink(filePath).catch(() => undefined);
    return true;
  } catch (err) {
    // 409/410 = run ya terminal en el backend (el sweeper lo marcó abandoned
    // o un re-claim recompletó). No hay nada que recuperar — borramos.
    if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
      logger.info(
        {
          event: 'complete.recovery.already_terminal',
          runId,
          status: err.status,
        },
        `[recovery] /complete diferido: backend ya tenía el run en terminal — descartando`,
      );
      await fs.unlink(filePath).catch(() => undefined);
      return true;
    }
    logger.warn(
      {
        event: 'complete.recovery.fail',
        runId,
        filePath,
        error: (err as Error).message,
        status: err instanceof ApiError ? err.status : null,
      },
      `[recovery] /complete diferido falló — se reintentará en el próximo boot`,
    );
    return false;
  }
}

/**
 * Frecuencia de progress POST mientras claude corre. 30s = balance entre
 * mantener `lastProgressAt` fresh para el sweeper (10min threshold) y no
 * inundar el backend con llamadas.
 */
const PROGRESS_INTERVAL_MS = 30_000;

/**
 * Bytes máximo de stdout/stderr buffer enviado en cada progress. El DTO
 * del backend acepta hasta 8000 chars; cortamos las últimas N líneas.
 */
const MAX_OUTPUT_BYTES = 8000;

/**
 * Resuelve el binario `claude` del PATH. Asume que el usuario lo tiene
 * instalado (`npm i -g @anthropic-ai/claude-code` o similar). Si no, falla
 * limpio con mensaje accionable.
 */
function resolveClaudeBin(): string {
  return process.env.CLAUDE_BIN ?? 'claude';
}

/**
 * Ejecuta una historia reclamada: crea worktree temporal, spawn `claude -p`
 * headless con el prompt como argumento, captura stdout/stderr a un log
 * redactado que el frontend ve via `tail -f` en iframe, y al terminar hace
 * commit + push. El backend recibe `prBranchPushed=true` y abre el PR via
 * Octokit (HITO 5).
 *
 * Si el repo no está configurado (claimed.repoUrl === null), el runner
 * sigue ejecutando claude en un sandbox temporal pero NO hace push ni PR
 * — solo reporta success/failure. Esto permite probar el flow E2E sin
 * setup completo de GitHub.
 */
export async function runStory(
  client: ApiClient,
  claimed: ClaimedStory,
): Promise<void> {
  const { runId, storyId, storyTitle, storyMarkdown, branch, prompt, repoUrl, baseBranch, anthropicApiKey, forgeWorkerModel, forgeWorkerEffort } = claimed;

  // === Resolver el max run duration desde el backend con clamps ===
  // Lógica delegada a `resolveMaxRunDurationMs` (función pura, testeable
  // independientemente — ver runner.timeout-resolver.test.ts).
  const backendMaxRunDuration = claimed.forgeWorkerMaxRunDurationMs;
  const { value: maxRunDurationMs, source: maxRunDurationSource, clamped: maxRunDurationClamped } =
    resolveMaxRunDurationMs(backendMaxRunDuration);

  // Log DEDICADO y PROMINENTE del timeout efectivo. Aparece al INICIO del run,
  // ANTES de cualquier otro log de spawn/clone/etc., para que el operador
  // pueda ver de inmediato qué timeout va a aplicar sin scrollear. Incluye
  // valor en ms + minutos legibles + fuente (backend vs default).
  logger.info(
    {
      event: 'run.max_duration',
      runId,
      storyId,
      maxRunDurationMs,
      maxRunDurationMin: Math.round(maxRunDurationMs / 60_000),
      source: maxRunDurationSource,
      backendValue: backendMaxRunDuration ?? null,
      clamped: maxRunDurationClamped,
    },
    `⏱️  [run.max_duration] timeout=${Math.round(maxRunDurationMs / 60_000)}min ` +
      `(${maxRunDurationMs}ms) source=${maxRunDurationSource}` +
      (maxRunDurationClamped ? ` ⚠️  clamped from backendValue=${backendMaxRunDuration}ms` : '') +
      (maxRunDurationSource === 'default'
        ? ' ⚠️  backend NO envió valor — usando default 30 min (verificar AgentTokenSettings)'
        : ''),
  );

  if (maxRunDurationClamped) {
    logger.warn(
      {
        event: 'run.max_duration.clamped',
        runId,
        backendValue: backendMaxRunDuration,
        clampedValue: maxRunDurationMs,
        min: MAX_RUN_DURATION_MS_MIN,
        max: MAX_RUN_DURATION_MS_MAX,
      },
      `[run.max_duration.clamped] backend=${backendMaxRunDuration}ms clamped to ${maxRunDurationMs}ms`,
    );
  }

  logger.info(
    {
      event: 'run.start',
      runId,
      storyId,
      storyTitle,
      branch,
      baseBranch,
      hasRepoUrl: !!repoUrl,
      mode: repoUrl ? 'git' : 'sandbox',
      promptLength: prompt?.length ?? 0,
      maxRunDurationMs,
      maxRunDurationSource,
    },
    `Starting run for story "${storyTitle}" (mode=${repoUrl ? 'git' : 'sandbox'}, maxDuration=${(maxRunDurationMs / 60_000).toFixed(0)}min)`,
  );

  // ════════════════════════════════════════════════════════════════════════
  // DEFENSIVE GUARDS — campos críticos del ClaimedStory payload
  // ════════════════════════════════════════════════════════════════════════
  //
  // El claim endpoint del backend DEBERÍA garantizar que estos campos vengan
  // no-vacíos (hay validación allá también). Pero defendemos doble — si el
  // backend tuvo un bug y nos pasa algo malformado, abortamos limpio acá
  // antes de spawnear claude con un -p "", git checkout -b "", o ANTHROPIC_API_KEY="".
  //
  // Cada guard tiene su evento único para forensics en logs. Si dispara,
  // reportamos al backend con forceCompletion=true para que la story no
  // quede zombie en estado claimed.
  const criticalFields: Array<{ name: string; value: unknown; minLength: number }> = [
    { name: 'storyTitle', value: storyTitle, minLength: 1 },
    { name: 'branch', value: branch, minLength: 1 },
    // ANTHROPIC_API_KEY: las claves reales empiezan con `sk-ant-` y tienen
    // 100+ chars. Threshold 10 es conservador — atrapa null/empty/dummy
    // sin rechazar claves legítimas.
    { name: 'anthropicApiKey', value: anthropicApiKey, minLength: 10 },
  ];
  for (const { name, value, minLength } of criticalFields) {
    const isInvalid =
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length < minLength);
    if (isInvalid) {
      const safePreview =
        typeof value === 'string'
          ? `"${value.slice(0, 20)}${value.length > 20 ? '...' : ''}"`
          : String(value);
      logger.error(
        {
          event: `run.field.invalid.${name}`,
          runId,
          storyId,
          fieldName: name,
          fieldValueLength: typeof value === 'string' ? value.length : null,
          fieldValuePreview: safePreview,
        },
        `Field ${name} vino vacío/inválido en claim payload — abort antes de spawn (evita exit 1 fantasma o crash de spawn)`,
      );
      try {
        await client.post(`/factory/workers/runs/${runId}/complete`, {
          // 64 = EX_USAGE (BSD sysexits): el claim payload del backend vino
          // malformado. No-cero → el backend marca la story 'blocked'.
          exitCode: 64,
          prBranchPushed: false,
          // `prNumber` y `commitSha` se omiten: aborto PRE-spawn, no hubo
          // commit ni rama; `prNumber` además fue removido del DTO por el
          // security fix de 2026-05-22 (CWE-639 / CWE-863).
          // `attempts` también se omite: el RunCompleteDto exige
          // `attempts >= 1` cuando está presente y aún no hubo pasada del DoD.
          forceCompletion: true,
          errorMessage: `Invalid claimed field: ${name} is empty or invalid (length=${typeof value === 'string' ? value.length : 0})`,
        });
      } catch (err) {
        logger.error(
          { event: `run.field.invalid.${name}.report_fail`, runId, error: (err as Error).message },
          `Failed to report invalid-${name} abort to backend`,
        );
      }
      return;
    }
  }

  if (!prompt || prompt.trim().length < 100) {
    logger.error(
      {
        event: 'run.prompt.empty_or_trivial',
        runId,
        storyId,
        promptLength: prompt?.length ?? 0,
        promptPreview: (prompt ?? '').slice(0, 200),
      },
      `Prompt vacío o trivial (length=${prompt?.length ?? 0}) — abort antes de spawn de claude (evita exit 1 con 0 tokens fantasma)`,
    );
    try {
      await client.post(`/factory/workers/runs/${runId}/complete`, {
        // 64 = EX_USAGE (BSD sysexits): claim payload malformado. No-cero →
        // el backend marca la story 'blocked'.
        exitCode: 64,
        prBranchPushed: false,
        // `prNumber` y `commitSha` se omiten: aborto PRE-spawn, no hubo
        // commit ni rama; `prNumber` además fue removido del DTO por el
        // security fix de 2026-05-22.
        // `attempts` también se omite: el RunCompleteDto exige
        // `attempts >= 1` cuando está presente y aún no hubo pasada del DoD.
        forceCompletion: true,
        errorMessage: `Empty or trivial prompt (length=${prompt?.length ?? 0}) — claim contract violation`,
      });
    } catch (err) {
      logger.error(
        { event: 'run.prompt.empty.report_fail', runId, error: (err as Error).message },
        'Failed to report empty-prompt abort to backend',
      );
    }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // HITO 2 — clone real cuando hay repoUrl, fallback a tmpdir vacío sino
  // ════════════════════════════════════════════════════════════════════════
  //
  // Si el backend nos dio repoUrl + baseBranch (porque hay un CodeRepository
  // configured), clonamos el repo, hacemos checkout a la story branch
  // partiendo de baseBranch, y configuramos identidad git. Si NO hay repo
  // (cualquier error en el resolve del backend), caemos al sandbox mode
  // anterior — claude corre en /tmp/ vacío sin push.
  const workdir = await fs.mkdtemp(join(tmpdir(), `factory-run-${runId.slice(0, 8)}-`));
  logger.debug({ event: 'workdir.created', runId, workdir }, 'Workdir prepared');

  // ════════════════════════════════════════════════════════════════════════
  // SECRETOS EXTERNOS — credenciales del org forwarded en el claim
  // ════════════════════════════════════════════════════════════════════════
  //
  // El backend forwardea TODOS los `ExternalSecret` del org en cada claim.
  // `claimed.externalSecrets ?? []` defiende contra un backend desincronizado
  // que no envíe el campo (mismo patrón defensivo que `dodCriteria ?? []`).
  // `sanitizeExternalSecrets` descarta nombres reservados o inválidos.
  //
  // `redact` redacta el output del agente por el valor literal de cada
  // secreto — los de terceros no matchean los patrones por prefijo. Se usa
  // en `appendFormattedToLog`, el único sink hacia el log file y el backend.
  const safeSecrets = sanitizeExternalSecrets(claimed.externalSecrets ?? []);
  const redact = makeRedactor(safeSecrets.map((s) => s.value));
  // True solo si ESTE worker escribió un `.env` efímero — gatea el borrado
  // pre-commit para no eliminar un `.env` que el repo target ya trackeaba.
  let wroteEphemeralDotenv = false;
  if (safeSecrets.length > 0) {
    logger.info(
      {
        event: 'run.secrets.loaded',
        runId,
        // Solo NOMBRES — nunca valores.
        secretNames: safeSecrets.map((s) => s.name),
        count: safeSecrets.length,
      },
      `${safeSecrets.length} secreto(s) externo(s) disponible(s) para el run`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // HITO 1.6 — Tracking de criterios/milestones del run
  // ════════════════════════════════════════════════════════════════════════
  //
  // Inicializa los milestones técnicos del worker en `pending`. A medida
  // que el flow avanza, cada uno pasa a `in_progress` → `completed` (o
  // `failed`). El array completo se reporta al backend en cada progress y
  // el frontend lo pinta como timeline visual.
  //
  // Worker milestones (técnicos): inicializados en `pending`, marcados
  // a lo largo del flow. Visibles en UI como pill secundaria "workflow".
  const workerCriteria: CriterionEvent[] = WORKER_MILESTONES.map((m) => ({
    id: m.id,
    label: m.label,
    status: 'pending',
    source: 'worker',
  }));

  // Milestones de la story que el verifier marca individualmente (pill
  // PRIMARIA en la UI). Tras 2026-05-21 el verificador del Forge SOLO revisa
  // la solución técnica (definicion-tecnica.md): los acceptance criteria y
  // los casos de QA se verifican en etapas POSTERIORES del pipeline (review
  // y QA Testing). Por eso ya no se crean los milestones `story.ac-*` ni
  // `story.tc-*` — mostrarlos en `pending` para siempre sería engañoso.
  // Solo quedan los `story.tl-*` que el bloque de abajo construye.
  const storyCriteria: CriterionEvent[] = [];

  // Per-item milestones del TL markdown. Mismo patrón: cada requirement
  // (checklist/contract/validation/errors) se renderiza individual. El
  // verifier emite UN verdict por requirement (kind='technical-design') con
  // `label` `"${CategoryLabel}: ${tr.description}"` — el match por label
  // abajo marca cada milestone individual.
  for (let i = 0; i < (claimed.technicalRequirements ?? []).length; i++) {
    const tr = claimed.technicalRequirements![i];
    const categoryLabel: Record<typeof tr.category, string> = {
      checklist: 'Checklist',
      contract: 'Contrato',
      validation: 'Validación',
      errors: 'Errores',
    };
    const label = `${categoryLabel[tr.category]}: ${tr.description}`;
    storyCriteria.push({
      id: `story.tl-${i + 1}`,
      label,
      status: 'pending',
      source: 'story',
    });
  }

  const markCriterion = (
    id: string,
    status: 'in_progress' | 'completed' | 'failed',
  ): void => {
    // Buscar primero en workerCriteria, luego en storyCriteria. IDs son
    // distintos (worker: `workdir.ready` / `repo.cloned` / `branch.pushed`...;
    // story: `story.tl-N` para los milestones de la solución técnica que el
    // verifier del Forge marca). Los antiguos `story.ac-*` y `story.tc-*` se
    // dejaron de emitir tras 2026-05-21 (verificación de AC + QA se mueve a
    // etapas posteriores del pipeline). No hay colisión de IDs, pero
    // priorizamos workerCriteria para early-exit en el caso común.
    let target: CriterionEvent[] | null = null;
    let idx = workerCriteria.findIndex((c) => c.id === id);
    if (idx !== -1) target = workerCriteria;
    else {
      idx = storyCriteria.findIndex((c) => c.id === id);
      if (idx !== -1) target = storyCriteria;
    }
    if (!target) return;
    const now = new Date().toISOString();
    target[idx] = {
      ...target[idx],
      status,
      ...(status === 'in_progress' && !target[idx].startedAt
        ? { startedAt: now }
        : {}),
      ...(status === 'completed' || status === 'failed'
        ? { completedAt: now }
        : {}),
    };
  };

  /**
   * Construye el array completo para enviar al backend. Combina:
   *  - workerCriteria: milestones técnicos del flow (workdir, clone, spawn, ...)
   *  - storyCriteria: acceptance criteria de la story (parseados del vault)
   *
   * El agent self-report (`.cenzontle-criteria.json`) fue ELIMINADO porque
   * era sycophancy: el agente que generaba el código se auto-evaluaba.
   * Ahora los criterios concretos vienen del seed (vault) y los marca el
   * verifier independiente (Sonnet), no el generator.
   */
  const buildCriteriaPayload = (): CriterionEvent[] => {
    return [...workerCriteria, ...storyCriteria];
  };

  // Workdir ya está creado, marcamos ese milestone done.
  markCriterion('workdir.ready', 'completed');

  let cloneSucceeded = false;
  if (repoUrl !== null && baseBranch !== null) {
    markCriterion('repo.cloned', 'in_progress');
    try {
      // 1. Clone con --depth=1 + filter para evitar bajar todo el history
      //    (faster + menos disk). Branch base ya checked out tras el clone.
      logger.info(
        { event: 'git.clone.start', runId, baseBranch },
        `git clone (depth=1, branch=${baseBranch})`,
      );
      await git(
        [
          'clone',
          '--depth',
          '1',
          '--branch',
          baseBranch,
          repoUrl,
          workdir,
        ],
        tmpdir(), // cwd cualquiera — el clone crea workdir
      );

      // 2. Configura identidad git para los commits (evita "Please tell me
      //    who you are" cuando claude commitee). Estos values son visibles
      //    en `git log` — usamos un autor descriptivo del Forge.
      await git(['config', 'user.email', 'forge-worker@cenzontle.io'], workdir);
      await git(['config', 'user.name', `CENZONTLE Forge Worker`], workdir);

      // 3. Crea + checkout a la story branch desde baseBranch. El push
      //    posterior usará este nombre.
      await git(['checkout', '-b', branch], workdir);

      cloneSucceeded = true;
      markCriterion('repo.cloned', 'completed');
      logger.info(
        { event: 'git.clone.ok', runId, branch, baseBranch },
        `Repo clonado y checked out a ${branch}`,
      );

      // OBS — Snapshot del estado git post-clone (baseline para detectar
      // drift posterior). Si más adelante el push falla con "origin does not
      // appear", comparar contra este snapshot revela si el agente reescribió
      // el `.git/` durante el run (ej. corriendo `git init` o
      // `npx create-next-app`). Try/catch para que un fallo del snapshot
      // NUNCA aborte el run.
      try {
        const remoteCheck = await git(['remote', '-v'], workdir);
        const headCheck = await git(['rev-parse', '--short', 'HEAD'], workdir);
        const remoteLines = remoteCheck.stdout.split('\n').filter(Boolean);
        logger.info(
          {
            event: 'git.workdir.snapshot.post_clone',
            runId,
            remotesCount: remoteLines.length,
            originPresent: remoteLines.some((l) => l.startsWith('origin')),
            headSha: headCheck.stdout.trim(),
          },
          `Post-clone snapshot: ${remoteLines.length} remote(s), origin=${remoteLines.some((l) => l.startsWith('origin')) ? 'sí' : 'NO'}, HEAD=${headCheck.stdout.trim()}`,
        );
      } catch (snapErr) {
        logger.warn(
          {
            event: 'git.workdir.snapshot.post_clone.fail',
            runId,
            error: (snapErr as Error).message,
          },
          `Snapshot post-clone falló (no bloqueante)`,
        );
      }
    } catch (err) {
      // Q5 (2026-05-21): el clone del repo es un prerrequisito DURO. Si el
      // repo estaba configurado (repoUrl != null) pero el clone falla
      // —token inválido, branch base inexistente, red caída— NO hay nada
      // que el agente pueda hacer: correr claude en un workdir vacío solo
      // produciría basura y quemaría tokens. Es un ERROR del run: lo
      // reportamos con exit code no-cero y abortamos antes de spawnear
      // claude. El backend marca la story 'blocked' para revisión humana.
      markCriterion('repo.cloned', 'failed');
      // El error de git puede incluir la URL del clone con el token embebido
      // (los fallos de auth la imprimen literal). Redactar ANTES de loguear o
      // mandar al backend — si no, el token del repo se filtra a la DB/UI.
      // `execFile` puede llenar `.message`, `.stderr` o ambos según la
      // plataforma; concatenamos los dos para que el redactor no deje
      // escapar un token presente solo en uno de los dos canales.
      const rawCloneErr = err as Error & { stderr?: string };
      const cloneErrCombined = `${rawCloneErr.message ?? ''}${rawCloneErr.stderr ? ` :: ${rawCloneErr.stderr}` : ''}`.trim();
      const cloneErrMsg = redactRepoUrlCredentials(cloneErrCombined, repoUrl);
      logger.error(
        { event: 'git.clone.fail', runId, error: cloneErrMsg },
        `Clone del repo falló — abortando el run con error (ya no hay sandbox fallback)`,
      );
      try {
        await client.post(`/factory/workers/runs/${runId}/complete`, {
          // 69 = EX_UNAVAILABLE (BSD sysexits): el recurso (repo) no está
          // disponible. Distinto de 127 (spawn) / 124 (timeout) / 143 (kill).
          exitCode: 69,
          prBranchPushed: false,
          // `prNumber` y `commitSha` se omiten: aún no hubo commit ni rama.
          // `prNumber` además fue removido del DTO por el security fix.
          errorMessage: `Repo clone failed: ${cloneErrMsg.slice(0, 500)}`,
          criteriaProgress: buildCriteriaPayload(),
        });
      } catch (reportErr) {
        logger.error(
          {
            event: 'git.clone.fail.report_fail',
            runId,
            error: (reportErr as Error).message,
          },
          'No se pudo reportar el fallo de clone — el sweeper marcará el run abandoned',
        );
      }
      await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECRETOS EXTERNOS — `.env` efímero en el workdir
  // ════════════════════════════════════════════════════════════════════════
  //
  // Además de las env vars del spawn (para SDKs `process.env`-based), un
  // `.env` cubre los frameworks file-based (Next.js/Vite leen `.env` del
  // cwd). Se escribe con modo 0600 (solo el owner lee) y se gitignorea
  // local-only vía `.git/info/exclude` — eso NO modifica archivos trackeados
  // ni contamina el PR. El `.env` además se borra explícitamente antes del
  // `git add -A` (más abajo). En sandbox mode (sin `.git`) el `.env` vive en
  // el workdir temporal y lo limpia el `fs.rm(workdir)` final.
  //
  // Si el repo target YA trackea un `.env`, NO lo tocamos — el agente recibe
  // las credenciales por env var igual.
  if (safeSecrets.length > 0) {
    let writeDotenv = true;
    if (cloneSucceeded) {
      try {
        const tracked = await git(['ls-files', '.env'], workdir);
        if (tracked.stdout.trim().length > 0) {
          writeDotenv = false;
          logger.warn(
            { event: 'run.secrets.dotenv.skip_tracked', runId },
            `El repo target ya trackea un .env — no se sobreescribe; los ` +
              `secretos van solo por env var`,
          );
        }
      } catch {
        // `git ls-files` falló — procedemos a escribir el `.env`.
      }
    }
    if (writeDotenv) {
      try {
        await fs.writeFile(
          join(workdir, '.env'),
          serializeDotenv(safeSecrets),
          { mode: 0o600 },
        );
        wroteEphemeralDotenv = true;
        if (cloneSucceeded) {
          // gitignore LOCAL-ONLY: `.git/info/exclude` no es un archivo
          // trackeado, así que no aparece en el diff del PR.
          await fs.appendFile(
            join(workdir, '.git', 'info', 'exclude'),
            '\n.env\n.env.local\n',
          );
        }
        logger.info(
          { event: 'run.secrets.dotenv.written', runId, count: safeSecrets.length },
          `.env efímero escrito (${safeSecrets.length} secreto(s), modo 0600)`,
        );
      } catch (err) {
        // No-fatal: las env vars del spawn siguen siendo el canal autoritativo.
        logger.warn(
          {
            event: 'run.secrets.dotenv.write_fail',
            runId,
            error: (err as Error).message,
          },
          `No se pudo escribir el .env efímero (non-fatal — los secretos van ` +
            `por env var igual)`,
        );
      }
    }
  }

  const startedAt = Date.now();
  const outputBuffer: string[] = [];
  let killed = false;
  let killByBackend = false; // 409/410 desde backend → matar claude (run terminal del lado server)
  // QA-reviewer F-C 2026-05-06: tracking de los SIGKILL fallback timers
  // para clearTimeout en cleanup. Antes los .unref() los dejaba huérfanos
  // en el event loop (sin daño porque .unref permite exit limpio, pero
  // suciedad).
  let sigkillFallbackHandle: NodeJS.Timeout | null = null;

  // COST CONTROL (Sprint 4 validation): forzamos Haiku 4.5 por default para
  // que la fase de testing del flow E2E sea barata. Override con env var
  // `CLAUDE_MODEL=claude-sonnet-4-6` o `claude-opus-4-7` si la story lo
  // requiere. Sprint 5+ podemos hacerlo configurable per-epic via UI.
  //
  // Resolución de modelo + effort en cascada (2026-05-19):
  //   1. claimed.forgeWorkerModel — viene del backend, configurado en
  //      /factory/settings → Factory. Es la fuente DE VERDAD. Cuando el
  //      operador cambia el modelo desde UI, aplica al próximo claim (≤30s
  //      por el cache TTL del AgentTokenSettings service).
  //   2. process.env.CLAUDE_MODEL — fallback legacy. Sigue funcionando para
  //      deployments antiguos del backend que no envíen el campo.
  //   3. Default hardcodeado — sanity net si el backend manda string vacío.
  //
  // Modelos válidos (precio público Anthropic por 1M tokens):
  //   claude-haiku-4-5-20251001 — $1 in / $5 out  (cheapest, validation)
  //   claude-sonnet-4-6         — $3 in / $15 out (balanced — DEFAULT)
  //   claude-opus-4-7           — $15 in / $75 out (most capable, hard tasks)
  const claudeModel = forgeWorkerModel || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  // Mismo patrón cascada para effort level. Para Sonnet/Opus, valores
  // >= 'high' activan thinking blocks automáticamente. Para Haiku 'high'
  // es no-op (Haiku no soporta extended thinking nativo).
  //   low     — sin thinking. Cheapest, fastest.
  //   medium  — thinking moderado.
  //   high    — extended thinking activo (recomendado para coding).  ← default
  //   xhigh   — thinking budget más generoso.
  //   max     — thinking budget máximo (solo Opus 4.6+).
  const claudeEffort = forgeWorkerEffort || process.env.CLAUDE_EFFORT || 'high';

  logger.info(
    {
      event: 'run.model',
      runId,
      model: claudeModel,
      effort: claudeEffort,
      source: forgeWorkerModel ? 'backend' : process.env.CLAUDE_MODEL ? 'env' : 'default',
    },
    `Spawning claude with model=${claudeModel} effort=${claudeEffort}`,
  );

  // ════════════════════════════════════════════════════════════════════
  // HITO 1.5 — Opción B: claude headless + tail -f en iframe
  // ════════════════════════════════════════════════════════════════════
  //
  // Flow:
  //   1. Crear log file vacío en /tmp/cenzontle-run-{runId}.log
  //   2. Levantar tmux+ttyd corriendo `tail -f LOG_FILE` (view-only)
  //   3. Spawn `claude -p PROMPT --flags` con stdout/stderr pipe
  //   4. En cada chunk de stdout/stderr: redactar y appendear al log file
  //   5. tail -f propaga al pane → ttyd al iframe → user ve streaming vivo
  //   6. exit code viene de child.on('close') — sin sentinel, sin polling
  //
  // wrapWithSandbox sigue aplicando — el comando spawneado sigue siendo
  // `sandbox-exec ... claude ...`. Defensa F-06 preservada.
  if (!hasTmuxAndTtyd()) {
    logger.error(
      { event: 'run.tmux_ttyd.unavailable', runId },
      'tmux y/o ttyd no disponibles — instala con `brew install tmux ttyd` o el equivalente de Linux',
    );
    try {
      await client.post(`/factory/workers/runs/${runId}/complete`, {
        exitCode: 127,
        errorMessage:
          'tmux/ttyd no disponibles en el host del worker. Sin ellos no puedo arrancar el terminal en streaming (HITO 1.5). Instala con `brew install tmux ttyd`.',
        lastOutput: '',
      });
    } catch {
      // sweeper limpiará
    }
    try {
      await fs.rm(workdir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return;
  }

  // 1. Crear log file vacío. tail -f falla si el archivo no existe en el
  //    momento de spawn, así que touch primero. Mode 0o600 — solo el user
  //    dueño del worker puede leer (defense en depth aunque ya está redactado).
  const logFilePath = `/tmp/cenzontle-run-${runId}.log`;
  try {
    await fs.writeFile(logFilePath, '', { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    logger.error(
      { event: 'run.log_file.create.fail', runId, error: (err as Error).message },
      'No se pudo crear el log file',
    );
    try {
      await client.post(`/factory/workers/runs/${runId}/complete`, {
        exitCode: 127,
        errorMessage: `No se pudo crear log file: ${(err as Error).message.slice(0, 1500)}`,
        lastOutput: '',
      });
    } catch {
      // sweeper limpiará
    }
    try {
      await fs.rm(workdir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return;
  }

  // 2. Levantar tmux+ttyd corriendo tail -f del log. Esto retorna el
  //    ttydUrl que reportamos al backend para que el iframe pueda conectar.
  let session: TtydSession;
  try {
    session = await startTailFollowSession({ runId, logFilePath });
  } catch (err) {
    const tmuxErr = err as Error;
    logger.error(
      { event: 'run.tmux_ttyd.start.fail', runId, error: tmuxErr.message },
      'Failed to start tail+ttyd session',
    );
    try {
      await client.post(`/factory/workers/runs/${runId}/complete`, {
        exitCode: 127,
        errorMessage: `tail+ttyd start failed: ${tmuxErr.message.slice(0, 1500)}`,
        lastOutput: '',
      });
    } catch {
      // sweeper limpiará
    }
    try {
      await fs.unlink(logFilePath);
    } catch {
      // ignore
    }
    try {
      await fs.rm(workdir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return;
  }

  // 3. Spawn `claude -p PROMPT` headless. Modo print: sin TUI, sin escape
  //    codes raw, exit code claro. Salida fluye a stdout línea por línea.
  //
  // SECURITY (F-05 2026-05-06): construimos `env` explícitamente, NO con
  // spread `...process.env`. Antes el spread copiaba GITHUB_TOKEN, AWS_*,
  // NPM_TOKEN, DATABASE_URL, OPENAI_API_KEY, LD_PRELOAD, NODE_OPTIONS, etc.
  // y solo HOME/PATH/ANTHROPIC_API_KEY se reasignaban — el resto quedaba
  // expuesto a `claude -p --dangerously-skip-permissions` que tiene tools
  // sin gate y puede `bash -c 'env'` para exfiltrar.
  //
  // El `env` del spawn SÍ incluye `...buildSecretEnv(safeSecrets)` — pero
  // eso NO viola F-05: no es el environment del HOST, son los `ExternalSecret`
  // del org que el backend resolvió y scopeó para ESTE claim, y que el agente
  // necesita para implementar la historia. Que el agente pueda verlos
  // (`bash -c env`) es inherente y aceptado — igual que `ANTHROPIC_API_KEY`:
  // el sandbox protege el HOST, no oculta del agente las credenciales de su
  // propia historia. La fuga real (persistencia) la cubren la redacción del
  // output por valor exacto y el gitignore + borrado del `.env` efímero.
  //
  // SECURITY (F-06 2026-05-06): wrapWithSandbox envuelve el spawn con
  // sandbox-exec (macOS) o firejail (Linux) para denegar lectura de
  // ~/.ssh, ~/.aws, ~/.config/gh, etc. Mitiga prompt injection vía
  // epic.markdown que intentara leer credenciales del worker host.
  // Sin sandbox disponible → throw, salvo FACTORY_WORKER_ALLOW_NO_SANDBOX=1.
  // ════════════════════════════════════════════════════════════════════
  // DoD — enforcement loop con retry cap configurable
  // ════════════════════════════════════════════════════════════════════
  //
  // El loop corre hasta `maxDodAttempts` pasadas. `maxDodAttempts` viene
  // del claim (`claimed.dodMaxAttempts`, configurado en AgentTokenSettings
  // → tab Factory) clampeado a [1, 3]; 1 = una sola pasada (sin retries).
  //
  // Cada attempt:
  //   1. Spawn claude (prompt del claim en el attempt 1; retry-prompt
  //      quirúrgico en los retries DoD).
  //   2. Esperar close → exitCode.
  //   3. HARD-ERROR: si claude crasheó / exit≠0 / timeout-kill / spawn-fail:
  //      - si quedan attempts → retry desde cero con el prompt ORIGINAL
  //        (un crash NO es un problema del DoD).
  //      - si es el último attempt → break: error del run.
  //      `killByBackend` NUNCA reintenta — el run ya es terminal server-side.
  //   4. Verify DoD: corre el verifier (NO bloqueante).
  //   5. DoD-WARN: si el verifier encontró criterios fallidos Y quedan
  //      attempts → re-spawn con retry-prompt quirúrgico y continúa. Si es
  //      el último attempt o no hay fallidos → el run completa: el verifier
  //      sigue siendo NO bloqueante (los fallidos remanentes son warns,
  //      exitCode 0, la historia avanza). Los retries solo le dan a claude
  //      más tiros para limpiar el DoD antes de que los warns queden fijos.
  //
  // Doom loop (red de seguridad): 2 turnos verificados seguidos sin progreso
  // —estancamiento o regresión— cortan el run y lo escalan a humano (ver el
  // bloque `evaluateDoomLoop` abajo). Defensive: un backend de versión vieja
  // podría no enviar dodCriteria en ClaimedStory (campo agregado en Tier 1).
  // Default a [] preserva el comportamiento legacy (skip verifier, run
  // termina como antes).
  //
  // Filtro 2026-05-21: el verificador del Forge SOLO revisa la solución
  // técnica. `tests-passing` (QA) se verifica en la etapa QA Testing y
  // `acceptance-criteria` en el review — etapas POSTERIORES del pipeline.
  // Se descartan acá para que el verifier de esta etapa no los evalúe.
  const maxDodAttempts = resolveMaxDodAttempts(claimed.dodMaxAttempts);
  // `clamped` = el valor crudo del claim difería del resuelto (fuera de rango
  // o fraccionario). NO es "clamped" cuando el claim no trajo el campo —
  // eso es un default, no un ajuste. Es la señal de que la config aplicada
  // NO coincide con lo que el operador puso en la UI (ej. desync de versión).
  const dodAttemptsClamped =
    typeof claimed.dodMaxAttempts === 'number' &&
    Number.isFinite(claimed.dodMaxAttempts) &&
    claimed.dodMaxAttempts !== maxDodAttempts;
  logger.info(
    {
      event: 'dod.attempts.resolved',
      runId,
      maxDodAttempts,
      claimedValue: claimed.dodMaxAttempts ?? null,
      clamped: dodAttemptsClamped,
    },
    `DoD enforcement loop: hasta ${maxDodAttempts} attempt(s)` +
      (maxDodAttempts === 1 ? ' (una sola pasada, sin retries)' : '') +
      (dodAttemptsClamped
        ? ` (⚠ claim pidió ${claimed.dodMaxAttempts}, ajustado a ${maxDodAttempts})`
        : ''),
  );
  const dodCriteriaSafe = (claimed.dodCriteria ?? []).filter(
    (c) => c.kind !== 'tests-passing' && c.kind !== 'acceptance-criteria',
  );
  const verificationLog: Array<{ attempt: number; verdicts: CriterionVerdict[] }> = [];
  // Prompt del spawn actual. Empieza con el `prompt` del claim; tras una
  // pasada con criterios fallidos, se reemplaza por un retry-prompt quirúrgico.
  let currentPrompt = prompt;
  let claudeCompletedOk = false;
  let lastVerdicts: CriterionVerdict[] = [];
  let totalAttempts = 0;
  let dodFailureReason: string | null = null;
  // Doom loop — `doomLoopState` acarrea el baseline del passedCount y el
  // contador de turnos malos entre attempts verificados (forma definida en
  // dod-retry.ts). `doomLooped` marca que el run se cortó por estancamiento/
  // regresión (fuerza un exit code no-cero → escala a humano).
  let doomLoopState: DoomLoopState = INITIAL_DOOM_LOOP_STATE;
  let doomLooped = false;
  // exitCode + spawnError sobreviven al final del loop para reportarse en complete.
  let exitCode = -1;
  const spawnError: { value: Error | null } = { value: null };

  // Acumulador de generator usage across DoD attempts. Cada vez que el
  // stream-json emite el evento `result` final, hacemos push al perAttempt y
  // sumamos a los totales. Se manda al backend en el payload de /complete y
  // se persiste en agent_runs.generatorUsage para que getBatchDetail pueda
  // sumarlo con el verifier cost.
  const generatorPerAttempt: GeneratorAttemptUsage[] = [];

  // Running tokens del attempt EN CURSO — actualizado con cada `assistant`
  // event que el stream-json emite (un evento por turno del modelo). Permite
  // que el progress loop reporte cost LIVE cada 30s mientras claude corre,
  // sin esperar al `result` final del attempt (que solo llega al cierre).
  // Cost estimado vía price table de Haiku 4.5; al recibir `result`, se
  // reemplaza por el autoritativo del SDK en el perAttempt array.
  let runningTokens: GeneratorRunningTokens | null = null;

  // Estado para detección de agente "colgado". Comparado con runningTokens
  // en cada tick del progress timer (30s). Si in/out no cambiaron en
  // STUCK_DETECT_TOKEN_FREEZE_TICKS ticks consecutivos → WARN; si excede
  // STUCK_LIKELY_HANG_TICKS → ERROR. lastToolCall lo refresca el handler
  // de stdout cuando ve un `tool_use` en el stream-json.
  const stuckState: StuckDetectState = {
    lastInputTokens: 0,
    lastOutputTokens: 0,
    noChangeTicks: 0,
    lastToolCall: null,
  };

  // Tracking de bash tasks en background (P4). Key = hash sintético del
  // comando + startedAt. El stream-json del agente no expone un task ID
  // estable, así que usamos un counter monotónico.
  const bashTasks = new Map<number, BashTaskInfo>();
  let bashTaskCounter = 0;

  for (let attempt = 1; attempt <= maxDodAttempts; attempt++) {
    totalAttempts = attempt;

    if (attempt > 1) {
      logger.info(
        { event: 'dod.retry', runId, attempt, maxAttempts: maxDodAttempts },
        `DoD enforcement loop — attempt ${attempt}/${maxDodAttempts}`,
      );
    }

    // === Reset de los flags de error per-attempt ===
    //
    // `exitCode`, `spawnError`, `killed` y `sigkillFallbackHandle` son
    // function-scoped (sobreviven al loop para reportarse en /complete).
    // Con retries, un attempt previo pudo haberlos seteado: hay que volver
    // a su estado neutro ANTES de spawnear de nuevo, o un crash viejo se
    // arrastraría al attempt actual. `killByBackend` NO se resetea — una
    // vez que el backend declara el run terminal, lo es para siempre (el
    // loop hace break, nunca reintenta sobre killByBackend).
    if (attempt > 1) {
      exitCode = -1;
      spawnError.value = null;
      killed = false;
      if (sigkillFallbackHandle) {
        clearTimeout(sigkillFallbackHandle);
        sigkillFallbackHandle = null;
      }
      // Milestones del worker: volver `claude.spawned`/`claude.exited` a
      // 'in_progress' — un attempt previo los marcó 'completed' y, sin esto,
      // la UI mostraría "Claude terminó" mientras el retry vuelve a correr.
      markCriterion('claude.spawned', 'in_progress');
      markCriterion('claude.exited', 'in_progress');
      // Reset del estado de stuck detection y bash tasks — un attempt previo
      // pudo dejar el contador alto o tasks "stuck" que ya no aplican al spawn
      // nuevo. Sin esto, el primer tick del attempt 2 dispararía un WARN falso.
      stuckState.lastInputTokens = 0;
      stuckState.lastOutputTokens = 0;
      stuckState.noChangeTicks = 0;
      stuckState.lastToolCall = null;
      bashTasks.clear();
    }

    // === Wrap claude args con sandbox para este attempt ===
    let sandboxed;
    try {
      sandboxed = wrapWithSandbox(
        resolveClaudeBin(),
        [
          '-p',
          currentPrompt,
          '--dangerously-skip-permissions',
          '--permission-mode',
          'bypassPermissions',
          '--model',
          claudeModel,
          // Effort level — controla el thinking budget del CLI. Para Sonnet/
          // Opus, 'high' activa extended thinking automáticamente (Anthropic
          // mapea internamente a un budget de thinking tokens). Para Haiku
          // 'high' es no-op (Haiku no soporta extended thinking).
          // Ver `claudeEffort` arriba para descripción de los niveles.
          '--effort',
          claudeEffort,
          // Streaming: stream-json emite eventos JSON conforme claude avanza.
          // Sin esto, modo `-p` bufferea todo hasta el final y el iframe queda
          // vacío durante el run. `--verbose` requerido para eventos intermedios.
          // `--include-partial-messages` habilita content_block_delta.
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
        ],
        workdir,
      );
    } catch (err) {
      const sandboxErr = err as Error;
      logger.error(
        { event: 'run.sandbox.unavailable', runId, attempt, error: sandboxErr.message },
        'Sandbox unavailable — aborting run before spawn',
      );
      spawnError.value = sandboxErr;
      dodFailureReason = `Sandbox unavailable: ${sandboxErr.message.slice(0, 500)}`;
      break;
    }

    // === Spawn claude ===
    // FACTORY_WORKER_USE_USER_SESSION=1 — modo dev: NO pasar API key.
    // Pasamos `CLAUDE_CODE_OAUTH_TOKEN` en su lugar (token long-lived
    // generado con `claude setup-token`). Esta es la API OFICIAL de
    // Anthropic para automation con suscripción Pro/Max — documentada en
    // https://code.claude.com/docs/en/authentication.md.
    //
    // Por qué un token explícito y no la sesión local: el subprocess
    // hereda env limpio (sin shell session), entonces no puede leer
    // automáticamente el Keychain (~/.claude/.credentials.json). El token
    // explícito es la forma soportada de pasar la sesión OAuth al subprocess.
    //
    // Setup (una vez por dev machine):
    //   claude setup-token   # genera token long-lived
    //   export CLAUDE_CODE_OAUTH_TOKEN=<output>   # en tu shell
    //
    // Trade-off vs API key:
    //   - Cuota se descuenta del plan Pro/Max (no API credits)
    //   - Rate limit de 5h se comparte con uso interactivo del developer
    //   - Desde Jun 15, 2026: nueva cuota "Agent SDK credit" separada
    const useUserSession = process.env.FACTORY_WORKER_USE_USER_SESSION === '1';
    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (useUserSession && !oauthToken) {
      logger.error(
        { event: 'run.spawn.user_session.no_token', runId, attempt },
        '❌ FACTORY_WORKER_USE_USER_SESSION=1 pero CLAUDE_CODE_OAUTH_TOKEN no está set. ' +
          'Genera el token con `claude setup-token` y exportalo en tu shell antes de arrancar el worker. ' +
          'Sin el token, el CLI no puede autenticarse desde el subprocess y aborta silenciosamente.',
      );
    }

    // === FORENSIC AUDIT: credenciales que llegan al CLI ===
    // Esta auditoría existe porque hay un escenario observado donde el CLI
    // cobra a la API pese al flag activo. Los logs aquí permiten distinguir
    // entre causas: token malformado, key fantasma del Keychain, conflicto
    // de env vars, etc. NUNCA logueamos el valor real — solo metadata.
    const tokenPrefix = oauthToken ? oauthToken.slice(0, 13) : null; // sk-ant-oat01 = 12 chars + '-'
    const tokenIsValidShape = tokenPrefix === 'sk-ant-oat01-';
    const apiKeyInSecrets = safeSecrets.some((s) => s.name === 'ANTHROPIC_API_KEY');
    const apiKeyInParentEnv = !!process.env.ANTHROPIC_API_KEY;
    const childEnvKeys = [
      ...safeSecrets.map((s) => s.name),
      'HOME', 'PATH', 'USER', 'LANG',
      ...(useUserSession
        ? (oauthToken ? ['CLAUDE_CODE_OAUTH_TOKEN'] : [])
        : ['ANTHROPIC_API_KEY']),
    ];
    logger.warn(
      {
        event: 'run.spawn.credential_audit',
        runId,
        attempt,
        useUserSession,
        hasOauthToken: !!oauthToken,
        oauthTokenLength: oauthToken?.length ?? 0,
        oauthTokenPrefix: tokenPrefix,
        oauthTokenShapeValid: tokenIsValidShape,
        apiKeyFromBackendLength: anthropicApiKey?.length ?? 0,
        apiKeyInOrgSecrets: apiKeyInSecrets,
        apiKeyInParentEnv,
        childEnvKeys,
        expectedAuthSource: useUserSession
          ? (oauthToken ? 'oauth_token' : 'NONE_will_fail')
          : 'api_key',
      },
      `[credential_audit] useUserSession=${useUserSession} authSource=${useUserSession ? (oauthToken ? 'oauth' : 'NONE') : 'api_key'} ` +
        `tokenShape=${tokenIsValidShape ? 'ok' : 'INVALID'} apiKeyLeak=${apiKeyInSecrets || apiKeyInParentEnv ? 'WARN' : 'clean'}`,
    );
    if (useUserSession && oauthToken && !tokenIsValidShape) {
      logger.error(
        {
          event: 'run.spawn.oauth_token.invalid_shape',
          runId,
          attempt,
          tokenPrefix,
          expectedPrefix: 'sk-ant-oat01-',
        },
        '❌ CLAUDE_CODE_OAUTH_TOKEN no tiene el formato esperado (sk-ant-oat01-...). ' +
          'El CLI puede silenciosamente caer a otra credencial (Keychain). ' +
          'Regenerá con `claude setup-token` y exportá el valor exacto que imprime.',
      );
    }
    if (useUserSession && apiKeyInSecrets) {
      logger.error(
        { event: 'run.spawn.api_key_leak.org_secrets', runId, attempt },
        '🚨 ANTHROPIC_API_KEY está en los secretos externos del org. ' +
          'buildSecretEnv la va a inyectar al child ANTES que el OAuth token, ' +
          'lo que anula el flag. Borrá la entrada del org en la UI.',
      );
    }

    let child: ChildProcess;
    try {
      child = spawn(sandboxed.bin, sandboxed.args, {
        cwd: workdir,
        env: {
          // Secretos externos del org PRIMERO en el spread. Las env vars
          // fijas van DESPUÉS para que SIEMPRE las pisen — defensa final
          // contra un nombre que, pese a `sanitizeExternalSecrets`, colida
          // con una var fija. Ver el bloque SECURITY F-05 arriba para por
          // qué este spread no es el `...process.env` prohibido.
          ...buildSecretEnv(safeSecrets),
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
          USER: process.env.USER ?? '',
          LANG: process.env.LANG ?? 'en_US.UTF-8',
          // Si useUserSession está activo, pasamos el OAuth token (no API key).
          // El CLI usa CLAUDE_CODE_OAUTH_TOKEN para autenticar via OAuth
          // contra el plan Pro/Max del developer. Si NO está activo (default
          // = producción), pasamos la API key normalmente.
          ...(useUserSession
            ? (oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {})
            : { ANTHROPIC_API_KEY: anthropicApiKey }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (useUserSession) {
        logger.warn(
          { event: 'run.spawn.user_session', runId, attempt, pid: child.pid, hasToken: !!oauthToken },
          oauthToken
            ? '⚠️  Spawned with CLAUDE_CODE_OAUTH_TOKEN — using Pro/Max quota. Dev only — NOT for production.'
            : '⚠️  Spawned WITHOUT API key AND WITHOUT OAuth token — CLI will likely fail. Run `claude setup-token` first.',
        );
      }
    } catch (err) {
      const e = err as Error;
      logger.error(
        { event: 'run.spawn.fail', runId, attempt, error: e.message },
        'Failed to spawn claude',
      );
      spawnError.value = e;
      dodFailureReason = `Spawn failed: ${e.message.slice(0, 500)}`;
      break;
    }

    // Cada attempt marca el milestone — con retries, el spawn del attempt
    // 2+ también debe reflejarse (el reset de arriba lo volvió a 'in_progress').
    markCriterion('claude.spawned', 'completed');
    logger.info(
      {
        event: 'run.spawn',
        runId,
        attempt,
        sandboxMode: sandboxed.mode,
        ttydPort: session.port,
        ttydUrl: session.ttydUrl,
        pid: child.pid,
      },
      `claude spawned (attempt ${attempt}, sandbox=${sandboxed.mode}, pid=${child.pid})`,
    );

    // Safety net armado SOLO cuando el CLI emite un `result` terminal
    // (subtype: success/error). Si tras 30s de ese punto el exit aún no
    // llegó, mandamos SIGKILL — el CLI ya hizo su trabajo, no hay razón
    // para que siga vivo. Ver el bloque `child.stdin.close` abajo.
    let postTerminalKillTimer: NodeJS.Timeout | null = null;

    // === Hook stdout/stderr al log file (mismo log compartido entre attempts) ===
    child.on('error', (err) => {
      spawnError.value = err;
      logger.error(
        { event: 'run.child.error', runId, attempt, error: err.message },
        'claude emitted error event',
      );
    });

    let stdoutPartial = '';
    const appendFormattedToLog = (formatted: string): void => {
      if (!formatted) return;
      // Redactamos UNA SOLA VEZ acá y pasamos el resultado a ambos sinks.
      // Antes pasábamos `formatted` (sin redactar) a appendToBuffer y dependíamos
      // de que appendToBuffer redactara internamente — invariante frágil: si un
      // refactor futuro removía la redacción de appendToBuffer (que conceptualmente
      // solo debería gestionar el ring buffer), outputBuffer quedaría con secretos.
      // BUG-01 fix: caller pre-redacta, appendToBuffer asume input ya redactado.
      // `redact` redacta tanto los patrones por prefijo como el valor literal
      // de cada secreto externo del org — cubre el log file, el outputBuffer
      // y por ende todos los `lastOutput` que van al backend.
      const redacted = redact(formatted);
      appendToBuffer(outputBuffer, redacted);
      fs.appendFile(logFilePath, redacted, 'utf-8').catch((err) => {
        logger.warn(
          { event: 'run.log_file.append.fail', runId, error: (err as Error).message },
          'Append a log file falló (non-fatal)',
        );
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutPartial += chunk.toString('utf-8');
      const lines = stdoutPartial.split('\n');
      stdoutPartial = lines.pop() ?? '';
      for (const line of lines) {
        // Captura tokens del attempt EN CURSO. Cada `assistant` event reporta
        // un SNAPSHOT del usage acumulado hasta ese turno (running totals,
        // NO per-call deltas — verificado empíricamente 2026-05-13 con runs
        // 47c475df/52664864/3a97bb87 donde sumar daba 1.4x-2.9x el cost real).
        //
        // Decisión: SOBRESCRIBIR en vez de sumar. Tomamos el running máximo
        // de cada campo (Math.max defensivo en caso de un event "viejo" que
        // llegue out-of-order o el último event reporta menos por razones del
        // SDK). El cost se recalcula con el snapshot, NO con suma acumulativa.
        const assistantTokens = parseAssistantUsage(line);
        if (assistantTokens) {
          if (!runningTokens || runningTokens.attempt !== attempt) {
            runningTokens = {
              attempt,
              inputTokens: 0,
              outputTokens: 0,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
              estimatedCostUsd: 0,
            };
          }
          // Math.max porque algunos campos (output_tokens) sí pueden ser
          // monotónicamente crecientes mientras otros (cache_read) pueden
          // fluctuar entre turnos. Tomar el max preserva el peak observado.
          runningTokens.inputTokens = Math.max(runningTokens.inputTokens, assistantTokens.inputTokens);
          runningTokens.outputTokens = Math.max(runningTokens.outputTokens, assistantTokens.outputTokens);
          runningTokens.cacheCreationInputTokens = Math.max(
            runningTokens.cacheCreationInputTokens,
            assistantTokens.cacheCreationInputTokens,
          );
          runningTokens.cacheReadInputTokens = Math.max(
            runningTokens.cacheReadInputTokens,
            assistantTokens.cacheReadInputTokens,
          );
          runningTokens.estimatedCostUsd = estimateHaikuCost(runningTokens);
        }

        // Captura tool_use del agente para tracking de forensics (stuck) y
        // bash tasks en background (long-running / watch-mode detection).
        // Se evalúa por línea ANTES de parseResultUsage para que el ÚLTIMO
        // tool_call quede registrado aunque el attempt esté por cerrar.
        const toolUse = parseToolUse(line);
        if (toolUse) {
          stuckState.lastToolCall = {
            name: toolUse.toolName,
            inputPreview: toolUse.inputPreview,
          };
          // P4 — bash task tracking (solo para Bash con run_in_background=true).
          // El stream-json no nos da un task ID estable, así que generamos uno
          // sintético (counter monotónico) y trackeamos por command + startedAt.
          if (
            toolUse.bashCommand !== null &&
            toolUse.runInBackground
          ) {
            const taskId = ++bashTaskCounter;
            bashTasks.set(taskId, {
              command: toolUse.bashCommand,
              startedAt: Date.now(),
              longRunningLogged: false,
              watchModeLogged: false,
            });
            const watchHit = WATCH_MODE_PATTERNS.find((p) =>
              p.regex.test(toolUse.bashCommand!),
            );
            logger.info(
              {
                event: 'bash.task.spawned',
                runId,
                attempt,
                taskId,
                command: redactSecrets(toolUse.bashCommand.slice(0, 500)),
                watchModeMatch: watchHit?.label ?? null,
              },
              `Bash task ${taskId} spawned in background: ${toolUse.bashCommand.slice(0, 80)}`,
            );
            // Si el comando es claramente watch-mode, escalamos el WARN ya —
            // sin esperar a que pasen 60s. La heurística es conservadora,
            // los patterns están muy acotados (vitest sin --run, etc).
            if (watchHit) {
              const task = bashTasks.get(taskId);
              if (task) task.watchModeLogged = true;
              logger.warn(
                {
                  event: 'bash.task.likely_watch_mode',
                  runId,
                  attempt,
                  taskId,
                  command: redactSecrets(toolUse.bashCommand.slice(0, 500)),
                  watchModePattern: watchHit.label,
                },
                `Bash task ${taskId} parece estar en watch mode (${watchHit.label}) — el agente puede colgarse esperando que termine. Considerar kill manual si los tokens se congelan.`,
              );
            }
          }
        }

        // Captura el evento `result` con cost/usage ANTES del formatting.
        // Solo viene UNO por spawn de claude (al cierre del run), pero el
        // DoD loop puede re-spawnear; cada attempt mete su entry al array.
        const usage = parseResultUsage(line, attempt);
        if (usage) {
          generatorPerAttempt.push(usage);
          // Reset running — el attempt cerró con cost autoritativo del SDK.
          // El próximo attempt (si hay retry) empieza con runningTokens=null.
          runningTokens = null;
          logger.info(
            {
              event: 'generator.usage',
              runId,
              attempt: usage.attempt,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationInputTokens: usage.cacheCreationInputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
              totalCostUsd: usage.totalCostUsd,
              durationMs: usage.durationMs,
              numTurns: usage.numTurns,
              subtype: usage.subtype,
              serviceTier: usage.serviceTier,
            },
            `[generator.cost] attempt=${usage.attempt} cost=$${usage.totalCostUsd.toFixed(4)} ` +
              `tier=${usage.serviceTier ?? 'unknown'} ` +
              `tokens(in/out/cw/cr)=${usage.inputTokens}/${usage.outputTokens}/` +
              `${usage.cacheCreationInputTokens}/${usage.cacheReadInputTokens} ` +
              `turns=${usage.numTurns} duration=${(usage.durationMs / 1000).toFixed(1)}s`,
          );

          // === FORENSIC ASSERT: si el flag está activo pero el tier es
          // "standard", el OAuth falló silenciosamente y el CLI cayó a una
          // API key fantasma. Loggeamos LOUD con contexto suficiente para
          // diagnosticar la fuente (Keychain / helper / env leak).
          if (useUserSession && usage.serviceTier === 'standard' && usage.totalCostUsd > 0) {
            logger.error(
              {
                event: 'run.spawn.oauth_bypass_detected',
                runId,
                attempt: usage.attempt,
                serviceTier: usage.serviceTier,
                totalCostUsd: usage.totalCostUsd,
                oauthTokenPresent: !!oauthToken,
                oauthTokenShapeValid: tokenIsValidShape,
                apiKeyInOrgSecrets: apiKeyInSecrets,
                apiKeyInParentEnv,
                possibleSources: [
                  apiKeyInSecrets && 'org_secrets',
                  apiKeyInParentEnv && 'parent_env_inherit',
                  !tokenIsValidShape && 'oauth_token_invalid_shape',
                  'macos_keychain_residual',
                  'claude_settings_api_key_helper',
                ].filter(Boolean),
              },
              `🚨 [oauth_bypass] flag=USER_SESSION pero el CLI usó tier="standard" y cobró $${usage.totalCostUsd.toFixed(4)} — ` +
                'el OAuth fue ignorado. Revisar Keychain (security find-generic-password -s "Claude Code-credentials"), ' +
                'apiKeyHelper en ~/.claude/settings.json, o secretos del org con nombre ANTHROPIC_API_KEY.',
            );
          } else if (useUserSession && usage.serviceTier && usage.serviceTier !== 'standard') {
            logger.info(
              {
                event: 'run.spawn.oauth_confirmed',
                runId,
                attempt: usage.attempt,
                serviceTier: usage.serviceTier,
                totalCostUsd: usage.totalCostUsd,
              },
              `✅ [oauth_confirmed] flag activo y tier="${usage.serviceTier}" — el OAuth está funcionando, sin cobro API.`,
            );
          }

          // BUG FIX 2026-05-25 (incident: stream-json never closes stdin):
          // El CLI Claude Code emite `result` event con subtype="success" cuando
          // termina su trabajo, PERO mantiene stdin abierto esperando potencial
          // input para un siguiente turno (modo interactive stream-json). El
          // proceso NO termina por sí solo — el worker queda esperando
          // `child.on('exit')` que nunca llega.
          //
          // Síntoma observado: 6+ min de silencio post-`generator.usage`,
          // resuelto solo al recibir SIGINT del operador (que mata al child).
          //
          // Fix: cerrar explícitamente stdin del child cuando recibimos un
          // result terminal. Esto le indica al CLI "no hay más input, termina".
          // El CLI cierra sus streams, emite 'exit', el worker resuelve y
          // avanza al DoD verify.
          if (
            usage.subtype === 'success' ||
            usage.subtype === 'error_during_execution' ||
            usage.subtype === 'error_max_turns'
          ) {
            logger.info(
              {
                event: 'child.stdin.close',
                runId,
                attempt: usage.attempt,
                subtype: usage.subtype,
                reason: 'agent emitted terminal result — closing stdin so CLI exits',
              },
              `[child.stdin.close] subtype=${usage.subtype} — signaling CLI to exit by closing stdin`,
            );
            try {
              child.stdin?.end();
            } catch (err) {
              logger.warn(
                { event: 'child.stdin.close.fail', runId, error: (err as Error).message },
                'Failed to close child stdin (non-fatal — exit safety net still active)',
              );
            }
            // Safety net: si tras 30s del result terminal el CLI sigue vivo
            // (zombie/deadlock en kernel), mandamos SIGKILL. El trabajo ya
            // terminó — no hay razón para seguir esperando. Solo se arma una
            // vez; reintentos en el mismo attempt sobre-escriben el handle.
            if (postTerminalKillTimer) clearTimeout(postTerminalKillTimer);
            postTerminalKillTimer = setTimeout(() => {
              if (!child.killed) {
                logger.warn(
                  {
                    event: 'child.post_terminal.kill',
                    runId,
                    attempt: usage.attempt,
                    pid: child.pid,
                  },
                  'CLI didn\'t exit 30s after terminal result — sending SIGKILL',
                );
                try {
                  child.kill('SIGKILL');
                } catch (err) {
                  logger.warn(
                    { event: 'child.post_terminal.kill.fail', runId, error: (err as Error).message },
                    'SIGKILL failed (non-fatal)',
                  );
                }
              }
            }, 30_000);
          }
          // Real-time cost: post el summary parcial a /progress INMEDIATAMENTE
          // (no esperar al /complete final). El UI pollea cada N segundos y
          // ve el cost subir attempt-por-attempt. Fire-and-forget — si falla
          // el POST, el /complete final lo reintenta con el summary completo.
          const partialSummary = buildGeneratorSummary(generatorPerAttempt);
          if (partialSummary) {
            const liveBuildCriteriaPayload = buildCriteriaPayload();
            client
              .post(`/factory/workers/runs/${runId}/progress`, {
                criteriaProgress: liveBuildCriteriaPayload,
                generatorUsage: partialSummary,
              })
              .catch((err) => {
                logger.warn(
                  {
                    event: 'progress.cost_live.fail',
                    runId,
                    error: (err as Error).message,
                  },
                  'Failed to post live cost — /complete will retry with full summary',
                );
              });
          }
        }
        const formatted = formatStreamEvent(line);
        if (formatted) appendFormattedToLog(formatted);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      appendFormattedToLog(chunk.toString('utf-8'));
    });

    // === Reportar progress inmediato (solo primer attempt — ttydUrl es estable) ===
    if (attempt === 1) {
      try {
        await client.post(`/factory/workers/runs/${runId}/progress`, {
          ttydUrl: session.ttydUrl,
          criteriaProgress: buildCriteriaPayload(),
        });
      } catch (err) {
        logger.warn(
          { event: 'progress.ttyd_url.fail', runId, error: (err as Error).message },
          'Failed to report ttydUrl (non-fatal — siguiente progress reintenta)',
        );
      }
    }

    // === Kill helper para este attempt ===
    const killClaude = () => {
      try {
        if (child.killed || child.exitCode !== null) return;
        child.kill('SIGTERM');
        sigkillFallbackHandle = setTimeout(() => {
          try {
            if (!child.killed && child.exitCode === null) {
              child.kill('SIGKILL');
            }
          } catch {
            // proceso ya muerto
          }
        }, 5000);
        sigkillFallbackHandle.unref();
      } catch (err) {
        logger.warn({ event: 'kill.fail', runId, error: (err as Error).message });
      }
    };

    // === Timeout per attempt + progress timer ===
    const timeoutHandle = setTimeout(() => {
      killed = true;
      logger.error(
        { event: 'run.timeout', runId, attempt, durationMs: maxRunDurationMs },
        'Killing claude after max duration',
      );
      killClaude();
    }, maxRunDurationMs);

    const refreshOutputFromFile = async () => {
      try {
        const tail = await readOutputTail(session.outputLogPath, MAX_OUTPUT_BYTES);
        outputBuffer.length = 0;
        outputBuffer.push(tail);
      } catch (err) {
        logger.warn(
          { event: 'output.read.fail', runId, error: (err as Error).message },
          'Failed to read output log file',
        );
      }
    };

    const progressTimer = setInterval(() => {
      if (killed) return;
      void (async () => {
        // P3 — detección de agente colgado. Comparamos runningTokens contra el
        // snapshot anterior. Si NO cambiaron → incrementa contador; si cambiaron
        // → resetea. Loggeamos WARN al cruzar STUCK_DETECT_TOKEN_FREEZE_TICKS y
        // ERROR al cruzar STUCK_LIKELY_HANG_TICKS. No matamos automáticamente —
        // operator decide. El log incluye lastToolCall + cpu/mem del proceso
        // para diagnosticar sin ssh al worker.
        if (runningTokens && child.pid !== undefined) {
          const curIn = runningTokens.inputTokens;
          const curOut = runningTokens.outputTokens;
          const tokensFrozen =
            curIn === stuckState.lastInputTokens &&
            curOut === stuckState.lastOutputTokens;
          if (tokensFrozen) {
            stuckState.noChangeTicks += 1;
          } else {
            stuckState.noChangeTicks = 0;
            stuckState.lastInputTokens = curIn;
            stuckState.lastOutputTokens = curOut;
          }

          // Threshold WARN — primera vez que cruzamos. Reportamos UNA vez por
          // ventana de freeze; si los tokens se mueven y vuelven a congelarse,
          // el contador empieza de cero y volverá a disparar.
          if (stuckState.noChangeTicks === STUCK_DETECT_TOKEN_FREEZE_TICKS) {
            const stats = await getProcessStats(child.pid);
            const frozenSeconds =
              STUCK_DETECT_TOKEN_FREEZE_TICKS * (PROGRESS_INTERVAL_MS / 1000);
            logger.warn(
              {
                event: 'agent.stuck.detect',
                runId,
                attempt,
                pid: child.pid,
                frozenSeconds,
                runningTokens: {
                  in: curIn,
                  out: curOut,
                },
                lastToolCall: stuckState.lastToolCall
                  ? {
                      name: stuckState.lastToolCall.name,
                      inputPreview: redactSecrets(
                        stuckState.lastToolCall.inputPreview,
                      ),
                    }
                  : null,
                cpuPercent: stats?.cpuPercent ?? null,
                rssKb: stats?.rssKb ?? null,
                comm: stats?.comm ?? null,
              },
              `WARN: agent stuck — no token activity for ${frozenSeconds}s. lastTool=${stuckState.lastToolCall?.name ?? 'unknown'} pid=${child.pid} cpu=${stats?.cpuPercent ?? '?'}%`,
            );
          }

          // Threshold ERROR — likely hang. Loggea con recomendación de kill.
          if (stuckState.noChangeTicks === STUCK_LIKELY_HANG_TICKS) {
            const stats = await getProcessStats(child.pid);
            const frozenSeconds =
              STUCK_LIKELY_HANG_TICKS * (PROGRESS_INTERVAL_MS / 1000);
            logger.error(
              {
                event: 'agent.stuck.likely_hang',
                runId,
                attempt,
                pid: child.pid,
                frozenSeconds,
                runningTokens: {
                  in: curIn,
                  out: curOut,
                },
                lastToolCall: stuckState.lastToolCall
                  ? {
                      name: stuckState.lastToolCall.name,
                      inputPreview: redactSecrets(
                        stuckState.lastToolCall.inputPreview,
                      ),
                    }
                  : null,
                cpuPercent: stats?.cpuPercent ?? null,
                rssKb: stats?.rssKb ?? null,
                comm: stats?.comm ?? null,
                recommendation: 'manual_kill',
              },
              `ERROR: agent.stuck.likely_hang — ${frozenSeconds}s sin actividad de tokens, último tool=${stuckState.lastToolCall?.name ?? 'unknown'}. Considerar kill manual: kill ${child.pid}`,
            );
          }
        }

        // P4 — bash tasks long-running detection. Recorremos las tareas activas
        // y, si alguna superó BASH_LONG_RUNNING_THRESHOLD_MS sin haber sido
        // marcada, loguamos WARN. El re-match de watch-mode patterns acá cubre
        // el caso donde una task NO matcheó al inicio (heurística estricta)
        // pero superó el threshold de cualquier modo.
        for (const [taskId, task] of bashTasks) {
          const elapsedMs = Date.now() - task.startedAt;
          if (
            elapsedMs >= BASH_LONG_RUNNING_THRESHOLD_MS &&
            !task.longRunningLogged
          ) {
            task.longRunningLogged = true;
            const watchHit = WATCH_MODE_PATTERNS.find((p) =>
              p.regex.test(task.command),
            );
            logger.warn(
              {
                event: 'bash.task.long_running',
                runId,
                attempt,
                taskId,
                elapsedMs,
                command: redactSecrets(task.command.slice(0, 500)),
                watchModeMatch: watchHit?.label ?? null,
              },
              `Bash task ${taskId} long_running (${(elapsedMs / 1000).toFixed(0)}s): ${task.command.slice(0, 80)}`,
            );
            // Si el comando coincide con un pattern watch-mode y no se había
            // logueado todavía, escalamos ahora.
            if (watchHit && !task.watchModeLogged) {
              task.watchModeLogged = true;
              logger.warn(
                {
                  event: 'bash.task.likely_watch_mode',
                  runId,
                  attempt,
                  taskId,
                  command: redactSecrets(task.command.slice(0, 500)),
                  watchModePattern: watchHit.label,
                },
                `WARN: command likely in watch mode — will never exit. Consider killing. (${watchHit.label})`,
              );
            }
          }
        }

        await refreshOutputFromFile();
        const lastOutput = outputBuffer.join('').slice(-MAX_OUTPUT_BYTES);
        const criteriaProgress = buildCriteriaPayload();
        // Cost LIVE: combinamos attempts ya cerrados (autoritativos del SDK)
        // + running tokens del attempt actual (estimate via price table). Esto
        // permite que la UI muestre el cost SUBIENDO mientras claude está
        // generando — no esperar al cierre del attempt para refresh.
        const liveGeneratorSummary = buildLiveGeneratorSummary(
          generatorPerAttempt,
          runningTokens,
        );
        try {
          await client.post(`/factory/workers/runs/${runId}/progress`, {
            lastOutput,
            ttydUrl: session.ttydUrl,
            criteriaProgress,
            ...(liveGeneratorSummary ? { generatorUsage: liveGeneratorSummary } : {}),
          });
          if (liveGeneratorSummary && runningTokens) {
            // Nivel info (no debug) para que sea visible en los logs default
            // del operador — este es el log que confirma que el cost LIVE
            // se está enviando al backend cada 30s mientras claude corre.
            logger.info(
              {
                event: 'generator.cost.live',
                runId,
                attempt: runningTokens.attempt,
                runningTokens: {
                  in: runningTokens.inputTokens,
                  out: runningTokens.outputTokens,
                  cw: runningTokens.cacheCreationInputTokens,
                  cr: runningTokens.cacheReadInputTokens,
                },
                estimatedCostUsd: runningTokens.estimatedCostUsd,
                totalCostUsd: liveGeneratorSummary.totalCostUsd,
              },
              `[generator.cost.live] attempt=${runningTokens.attempt} ` +
                `running_estimate=$${runningTokens.estimatedCostUsd.toFixed(4)} ` +
                `total_so_far=$${liveGeneratorSummary.totalCostUsd.toFixed(4)}`,
            );
          }
        } catch (err) {
          if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
            if (!killByBackend) {
              killByBackend = true;
              killed = true;
              logger.warn(
                { event: 'progress.backend_terminal', runId, status: err.status },
                'Backend says run is terminal — killing claude',
              );
              killClaude();
            }
            return;
          }
          logger.warn(
            { event: 'progress.fail', runId, error: (err as Error).message },
            'Progress report failed (non-fatal)',
          );
        }
      })();
    }, PROGRESS_INTERVAL_MS);

    // === Wait exit ===
    // Capturamos también `signal` (qa-validation 2026-05-11) — SIGKILL/SIGTERM
    // revelan kills externos vs. exits "naturales" del proceso. Antes solo
    // teníamos code y crashes silenciosos no daban pistas.
    //
    // BUG FIX 2026-05-25: usar 'exit' en lugar de 'close'. El evento 'close' se
    // emite cuando TODOS los streams stdio del child cierran — si algún
    // listener retiene referencia al pipe (caso observado con stuck detect +
    // bash tracking + tmux+ttyd attachados al log), 'close' nunca dispara y el
    // worker queda en deadlock indefinido post-agente.
    // 'exit' se emite cuando el process termina independiente del estado de
    // los streams. Es el patrón idiomático para "el subprocess murió".
    //
    // Esperamos exit sin timeout aquí. Defensa en profundidad:
    //   1. `postTerminalKillTimer` arma SIGKILL si subtype:success llegó pero
    //      el CLI no cerró en 30s (definido en el handler de stdout arriba).
    //   2. `timeoutHandle` (MAX_RUN_DURATION_MS) mata el run entero si nunca
    //      llega ni subtype:success ni exit — defensa última contra hangs.
    // Anti-patrón previo: un setTimeout(30s) acá arrancaba al spawn y mataba
    // runs legítimos que tomaban > 30s en producir output. Removido 2026-05-26.
    const { exitCode: rawExitCode, signal: claudeSignal } = await new Promise<{
      exitCode: number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on('exit', (code, sig) => {
        resolve({ exitCode: code ?? -1, signal: sig });
      });
    });
    exitCode = rawExitCode;

    clearTimeout(timeoutHandle);
    clearInterval(progressTimer);
    if (sigkillFallbackHandle) clearTimeout(sigkillFallbackHandle);
    if (postTerminalKillTimer) clearTimeout(postTerminalKillTimer);

    // Detectamos un fallo DURO de claude (crash, exit≠0, timeout-kill,
    // spawn-fail) para decidir abajo si reintentamos o cerramos. Lo
    // computamos ANTES de marcar el milestone porque el marcado depende
    // de si este es el attempt FINAL.
    const claudeHardError =
      !!spawnError.value || killByBackend || killed || exitCode !== 0;
    // `killByBackend` nunca reintenta — el run ya es terminal server-side
    // (un re-spawn + /complete posterior chocaría con 409/410). El resto
    // de los fallos duros sí reintentan si quedan attempts.
    const willRetryHardError =
      claudeHardError && !killByBackend && attempt < maxDodAttempts;

    // Marcamos `claude.exited` SOLO cuando NO va a haber otro spawn:
    //  - exit limpio (exitCode === 0) → no hay retry posible por crash;
    //    el DoD-warn retry re-spawnea pero el milestone se re-marcará igual.
    //  - es el attempt final (`attempt === maxDodAttempts`).
    //  - fallo duro que NO va a reintentar (killByBackend, o sin budget).
    // Si va a reintentar por crash, dejamos el milestone como está — el
    // próximo attempt lo marcará. Evita que el badge UI muestre 'failed'
    // en un run que después se recupera en el retry.
    const isFinalAttempt =
      attempt === maxDodAttempts || exitCode === 0 || (claudeHardError && !willRetryHardError);
    if (isFinalAttempt) {
      markCriterion('claude.exited', exitCode === 0 ? 'completed' : 'failed');
    }

    await refreshOutputFromFile();

    // === Si claude falló (no exit limpio): retry-desde-cero o abort ===
    if (claudeHardError) {
      // Log estructurado del crash con TODO el contexto disponible para forensics
      // (qa-validation 2026-05-11). Anteriormente el reason text era el único
      // registro — sin signal ni tail del output, debugar crashes silenciosos
      // de claude requería ssh al worker y revisar el log file a mano.
      const logFilePath = `/tmp/cenzontle-run-${runId}.log`;
      const lastOutputTail = outputBuffer.join('').slice(-1000);
      logger.error(
        {
          event: 'claude.exit_nonzero',
          runId,
          attempt,
          exitCode,
          signal: claudeSignal,
          killed,
          killByBackend,
          spawnError: spawnError.value?.message ?? null,
          willRetry: willRetryHardError,
          logFilePath,
          lastOutputTail,
        },
        `claude attempt ${attempt} terminó código=${exitCode}${claudeSignal ? ` signal=${claudeSignal}` : ''}${killed ? ' (killed by timeout)' : ''}${killByBackend ? ' (killed by backend)' : ''}${willRetryHardError ? ' — reintentando desde cero' : ''}`,
      );
      // === HARD-ERROR retry: un crash NO es un problema del DoD ===
      //
      // Si quedan attempts, reintentamos la corrida desde cero con el
      // prompt ORIGINAL (no el retry-prompt quirúrgico: ese asume que
      // claude completó y dejó trabajo parcial; un crash puede no haber
      // dejado nada usable). El reset de flags al inicio del próximo
      // attempt limpia `exitCode`/`spawnError`/`killed`.
      if (willRetryHardError) {
        logger.info(
          { event: 'dod.retry.hard_error', runId, attempt, nextAttempt: attempt + 1 },
          `claude falló duro en attempt ${attempt} — retry desde cero con el prompt original (attempt ${attempt + 1}/${maxDodAttempts})`,
        );
        currentPrompt = prompt;
        // Un crash NO es un "turno malo" del DoD — no produjo verdicts.
        // Reinicia el baseline del doom loop: el próximo attempt verificado
        // arranca una cadena nueva (no se compara a través del crash).
        doomLoopState = INITIAL_DOOM_LOOP_STATE;
        continue;
      }
      // Último attempt (o killByBackend) — fail como hasta hoy.
      dodFailureReason =
        dodFailureReason ??
        (killByBackend
          ? 'Killed by backend signal'
          : killed
            ? `Killed after ${maxRunDurationMs}ms`
            : `claude attempt ${attempt} exited with code ${exitCode}${claudeSignal ? ` (signal=${claudeSignal})` : ''}`);
      break;
    }

    // === Sin DoD configurado → trust + break ===
    if (dodCriteriaSafe.length === 0) {
      claudeCompletedOk = true;
      logger.info(
        { event: 'dod.skip', runId, reason: 'no criteria configured' },
        'DoD skipped (catálogo vacío)',
      );
      break;
    }

    // === Verify DoD ===
    logger.info(
      { event: 'dod.verify.start', runId, attempt, criteriaCount: dodCriteriaSafe.length },
      `DoD verification empieza (attempt ${attempt})`,
    );
    // Layer 3 (verifier agent) necesita contexto extra: la story, branch, y
    // ANTHROPIC_API_KEY para spawn de claude separado con modelo Sonnet.
    //
    // UX progressive (2026-05-11): pasamos `onProgress` para que el verifier
    // dispare un POST /progress al backend DESPUÉS DE CADA criterio. El
    // backend persiste `dodVerification` parcial → el polling del frontend
    // muestra checkmarks incrementales (1/N, 2/N, ...) en vez del salto
    // 0/N → N/N al final del attempt completo.
    //
    // El shape que enviamos coincide exactamente con el que persiste
    // /complete: `Array<{ attempt, verdicts }>`. Para el attempt actual,
    // mandamos `verdicts: partialVerdicts` (acumulado in-progress); los
    // attempts previos vienen completos del `verificationLog`.
    const verdicts = await verifyDoDCriteria(
      workdir,
      dodCriteriaSafe,
      {
        storyTitle,
        storyMarkdown,
        acceptanceCriteria: claimed.acceptanceCriteria ?? [],
        qaTestCases: claimed.qaTestCases ?? [],
        technicalRequirements: claimed.technicalRequirements ?? [],
        branch,
        // Base branch para el security-scan diferencial (audita origin/<base>
        // vs HEAD y solo falla por advisories nuevos). null en runs local-only.
        baseBranch,
        anthropicApiKey,
        // Secretos externos del org — el verifier los inyecta en el env de
        // `pnpm test`/`lint`/etc. y en sus propios spawns (paridad con el
        // coder: los tests del repo pueden tocar el servicio externo).
        externalSecrets: safeSecrets,
        // Forward del modelo/effort del DoD verifier desde el claim del backend
        // (configurados en /factory/settings → Factory). Si no vienen (claim
        // legacy o desync de versiones), el verifier cae a env vars.
        dodVerifierModel: claimed.dodVerifierModel,
        dodVerifierEffort: claimed.dodVerifierEffort,
        // Manifests de componentes UX/UI del bundle de diseño de la épica
        // (Stream A). Los usa el Layer 1 check `design-coverage-check` para
        // verificar que el coder no se haya saltado ningún componente. Si
        // el claim viene de un backend desactualizado o la épica es
        // backend-only, el check degrada a `skipped`.
        componentManifests: claimed.componentManifests,
      },
      async (partialVerdicts) => {
        // Sync storyCriteria con verdicts emitidos. Para los tres tipos de
        // verdict per-item (acceptance-criteria, tests-passing, technical-
        // design), cada `verdict.label` coincide con un `storyCriterion.label`
        // construido arriba desde el mismo seed input — match por label →
        // marca el milestone individual en `criteriaProgress` que se reporta
        // al backend en el mismo POST de progress.
        //
        // El verifier del Forge solo emite verdicts `technical-design`
        // (los kinds `acceptance-criteria` y `tests-passing` se filtran de
        // `dodCriteriaSafe`). El sync por label marca los milestones
        // `story.tl-*` progresivamente conforme Sonnet emite cada verdict.
        const SYNCABLE_KINDS = new Set(['technical-design']);
        for (const v of partialVerdicts) {
          if (!v.kind || !SYNCABLE_KINDS.has(v.kind)) continue;
          const target = storyCriteria.find((sc) => sc.label === v.label);
          if (!target) continue;
          if (v.status === 'passed' && target.status !== 'completed') {
            markCriterion(target.id, 'completed');
          } else if (v.status === 'failed' && target.status !== 'failed') {
            markCriterion(target.id, 'failed');
          }
        }

        const partialLog = [
          ...verificationLog,
          { attempt, verdicts: partialVerdicts },
        ];
        const partialPassed = partialVerdicts.filter((v) => v.status === 'passed').length;
        logger.debug(
          {
            event: 'dod.progress.partial',
            runId,
            attempt,
            verdictsEmitted: partialVerdicts.length,
            partialPassed,
            totalCriteria: dodCriteriaSafe.length,
          },
          `POST partial: ${partialVerdicts.length}/${dodCriteriaSafe.length} emitted, ${partialPassed} passed`,
        );
        try {
          await client.post(`/factory/workers/runs/${runId}/progress`, {
            dodVerification: partialLog,
            // Incluimos criteriaProgress fresco para que la UI vea checkmarks
            // de los storyCriteria a medida que el verifier los marca.
            criteriaProgress: buildCriteriaPayload(),
          });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
            // Run terminal en el backend — silente; el complete final
            // captura el 410. Cancelar el verifier acá complicaría el flujo
            // y la verificación dura pocos segundos.
            return;
          }
          // Loggear backendErrorBody si es 400 (validation fail) — útil para
          // diagnosticar DTO mismatches entre worker payload y RunProgressDto.
          logger.warn(
            {
              event: 'dod.progress.partial.fail',
              runId,
              attempt,
              error: (err as Error).message,
              status: err instanceof ApiError ? err.status : null,
              backendErrorBody: err instanceof ApiError && err.status === 400 ? err.body : undefined,
            },
            'POST partial dodVerification falló (non-fatal)',
          );
        }
      },
    );
    verificationLog.push({ attempt, verdicts });
    lastVerdicts = verdicts;

    const passedCount = verdicts.filter((v) => v.status === 'passed').length;
    const failedCount = verdicts.filter((v) => v.status === 'failed').length;
    const skippedCount = verdicts.filter((v) => v.status === 'skipped').length;
    logger.info(
      {
        event: 'dod.verify.done',
        runId,
        attempt,
        passed: passedCount,
        failed: failedCount,
        skipped: skippedCount,
      },
      failedCount > 0
        ? `DoD review: ${failedCount} criterio(s) con observaciones (warn, NO bloqueante) — ${passedCount} ok, ${skippedCount} saltados`
        : `DoD review: ${passedCount} ok, ${skippedCount} saltados`,
    );

    // === Doom loop — 2 turnos seguidos sin progreso cortan el run ===
    //
    // La policy pura vive en `dod-retry.ts:evaluateDoomLoop` (testeada en
    // aislamiento, sin stubs). Acá solo se acarrea el estado (`doomLoopState`),
    // se emite la observabilidad y se decide el `break`.
    //
    // "Turno malo" = el passedCount NO subió respecto al attempt previo:
    // estancamiento (delta === 0) o regresión (delta < 0 — el agente rompió
    // criterios que ya pasaban). 2 turnos malos CONSECUTIVOS → el agente está
    // atorado: se corta el loop y el run escala a humano (NO es
    // completar-con-warns — `doomLooped` fuerza un exit code no-cero).
    //
    // Requiere 2 comparaciones de passedCount → con cap=3 evalúa tras el
    // attempt 3 (si los attempts 2 y 3 fueron malos); con cap<=2 nunca
    // dispara; con cap=1 ni siquiera hay loop.
    //
    // ORDEN CRÍTICO: este bloque va ANTES del retry DoD-warn de abajo. El
    // doom loop tiene precedencia — si dispara, el `break` corta el run; un
    // turno estancado con criterios fallidos NO debe degradar a un retry
    // ordinario. No reordenar estos dos bloques.
    const prevPassedForLog = doomLoopState.previousPassedCount;
    const doomEval = evaluateDoomLoop(doomLoopState, passedCount);
    doomLoopState = doomEval.state;

    // Debug: traza del delta de CADA turno verificado. Sin esto, un run que
    // NO dispara el doom loop no deja registro de cuánto avanzó cada attempt
    // — es el log que responde "¿por qué no se cortó este run atorado?" y
    // "¿el retry sirvió de algo?". Nivel debug: ruidoso en prod, oro en una
    // sesión de diagnóstico (LOG_LEVEL=debug / --verbose).
    logger.debug(
      {
        event: 'dod.turn.delta',
        runId,
        attempt,
        passedCount,
        previousPassedCount: prevPassedForLog,
        delta: doomEval.delta,
        consecutiveBadTurns: doomLoopState.consecutiveBadTurns,
        doomLoopThreshold: DOOM_LOOP_THRESHOLD,
      },
      doomEval.delta === null
        ? `DoD turn ${attempt}: passed=${passedCount} (baseline, sin turno previo)`
        : `DoD turn ${attempt}: passed ${prevPassedForLog} → ${passedCount} ` +
          `(Δ${doomEval.delta >= 0 ? '+' : ''}${doomEval.delta}, ` +
          `badTurns=${doomLoopState.consecutiveBadTurns}/${DOOM_LOOP_THRESHOLD})`,
    );

    if (doomEval.doomLooped) {
      const kindEs =
        doomEval.kind === 'regression' ? 'REGRESIÓN' : 'ESTANCAMIENTO';
      doomLooped = true;
      dodFailureReason =
        `Doom loop detectado en attempt ${attempt}: 2 turnos seguidos ` +
        `sin progreso (${kindEs}) — passedCount ${prevPassedForLog} → ` +
        `${passedCount}. El agente está atorado; se corta el run y ` +
        `escala a revisión humana.`;
      logger.error(
        {
          event: 'dod.doom_loop',
          runId,
          attempt,
          kind: doomEval.kind,
          previousPassedCount: prevPassedForLog,
          passedCount,
          consecutiveBadTurns: doomLoopState.consecutiveBadTurns,
        },
        dodFailureReason,
      );
      break;
    }

    // === DoD-WARN retry: hay criterios fallidos y queda budget ===
    //
    // El verifier sigue siendo NO BLOQUEANTE: un criterio 'failed' es
    // "la solución técnica no se cumplió del todo" — deuda visible en
    // `dodVerification` que la UI pinta como warn. Pero si quedan attempts,
    // le damos a claude un tiro más para limpiar esos warns ANTES de que
    // queden fijos: re-spawn con un retry-prompt QUIRÚRGICO enfocado solo
    // en lo que falló (lista lo que ya pasa como "preservar"). Si es el
    // último attempt o no hay fallidos, el run completa con los warns que
    // hayan quedado — sin doom loop, sin skip-regression: solo un cap N.
    if (hasFailedCriteria(verdicts) && attempt < maxDodAttempts) {
      const failedThisAttempt = extractFailedCriteria(verdicts);
      const passedThisAttempt = extractPassedCriteria(verdicts);
      currentPrompt = buildRetryPrompt({
        storyTitle,
        failedVerdicts: failedThisAttempt,
        passedVerdicts: passedThisAttempt,
        attemptNumber: attempt + 1,
        maxAttempts: maxDodAttempts,
      });
      logger.info(
        {
          event: 'dod.retry.prompt_built',
          runId,
          nextAttempt: attempt + 1,
          failedCount,
          passedCount: passedThisAttempt.length,
          promptChars: currentPrompt.length,
        },
        `DoD con ${failedCount} criterio(s) fallido(s) — retry quirúrgico (attempt ${attempt + 1}/${maxDodAttempts}): ${passedThisAttempt.length} preservados, ${failedCount} a fixear`,
      );
      continue;
    }

    // Último attempt, o todos los criterios OK: el run procede al push +
    // complete. Los verdicts 'failed' remanentes son deuda visible (warn),
    // NO un fallo del run — el verifier permanece no-bloqueante.
    claudeCompletedOk = true;
    break;
  }

  // === Cleanup tmux/ttyd después del loop ===
  await cleanupSession(session);

  // ════════════════════════════════════════════════════════════════════
  // Cost tracking — resumen del verifier agent (Layer 3) por run completo
  // ════════════════════════════════════════════════════════════════════
  //
  // Suma usage de TODOS los criterios verificados a lo largo del loop —
  // incluye retries de múltiples attempts. Permite ver de un vistazo cuánto
  // costó este run en tokens y dólares, y dónde se fue cada peso (qué
  // criterio consumió más).
  //
  // IMPORTANTE: `totalCostUsd` es client-side estimate (Anthropic SDK price
  // table bundleada). Para billing autoritativo, usar Usage & Cost API.
  // Este log sirve para budgeting/forensics/optimización local.
  const verifierUsageSummary = (() => {
    type CriterionCost = {
      label: string;
      attempt: number;
      tokens: { in: number; out: number; cw: number; cr: number };
      costUsd: number;
      durationMs: number;
    };
    const perCriterion: CriterionCost[] = [];
    let totalIn = 0;
    let totalOut = 0;
    let totalCacheWrite = 0;
    let totalCacheRead = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;

    for (const attemptLog of verificationLog) {
      for (const v of attemptLog.verdicts) {
        if (!v.usage) continue;
        totalIn += v.usage.inputTokens;
        totalOut += v.usage.outputTokens;
        totalCacheWrite += v.usage.cacheCreationInputTokens;
        totalCacheRead += v.usage.cacheReadInputTokens;
        totalCostUsd += v.usage.totalCostUsd;
        totalDurationMs += v.usage.durationMs;
        perCriterion.push({
          label: v.label,
          attempt: attemptLog.attempt,
          tokens: {
            in: v.usage.inputTokens,
            out: v.usage.outputTokens,
            cw: v.usage.cacheCreationInputTokens,
            cr: v.usage.cacheReadInputTokens,
          },
          costUsd: v.usage.totalCostUsd,
          durationMs: v.usage.durationMs,
        });
      }
    }

    return {
      callsCount: perCriterion.length,
      totalCostUsd,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      totalCacheWriteTokens: totalCacheWrite,
      totalCacheReadTokens: totalCacheRead,
      totalDurationMs,
      perCriterion,
    };
  })();

  if (verifierUsageSummary.callsCount > 0) {
    // Log estructurado para parsing programático posterior (dashboards, alertas).
    logger.info(
      {
        event: 'dod.verifier.run_summary',
        runId,
        storyTitle,
        callsCount: verifierUsageSummary.callsCount,
        totalCostUsd: verifierUsageSummary.totalCostUsd,
        totalInputTokens: verifierUsageSummary.totalInputTokens,
        totalOutputTokens: verifierUsageSummary.totalOutputTokens,
        totalCacheWriteTokens: verifierUsageSummary.totalCacheWriteTokens,
        totalCacheReadTokens: verifierUsageSummary.totalCacheReadTokens,
        totalDurationMs: verifierUsageSummary.totalDurationMs,
        perCriterion: verifierUsageSummary.perCriterion,
      },
      `[verifier.cost.run_summary] runId=${runId.slice(0, 8)} calls=${verifierUsageSummary.callsCount} tokens(in/out/cw/cr)=${verifierUsageSummary.totalInputTokens}/${verifierUsageSummary.totalOutputTokens}/${verifierUsageSummary.totalCacheWriteTokens}/${verifierUsageSummary.totalCacheReadTokens} TOTAL_COST=$${verifierUsageSummary.totalCostUsd.toFixed(4)} duration=${(verifierUsageSummary.totalDurationMs / 1000).toFixed(1)}s`,
    );
  }

  const durationMs = Date.now() - startedAt;
  const finalOutput = outputBuffer.join('').slice(-MAX_OUTPUT_BYTES);
  // El worker NUNCA crea PRs ni manda `prNumber` en el payload de /complete:
  // el backend abre el PR vía Octokit con `headBranch: run.branch` trusted
  // y persiste el `prNumber` autoritativo desde la respuesta. El campo está
  // removido del DTO desde el security fix de 2026-05-22 (CWE-639 / CWE-863).
  let prBranchPushed = false;
  // Q5 (2026-05-21): un fallo del push al remote —o un abort por fuga de
  // secretos pre-push— es un ERROR del run. Este flag lo propaga al
  // `reportedExitCode` (74 = EX_IOERR) para que el backend marque la story
  // 'blocked' en vez de tratarla como completada sin PR.
  let pushFailed = false;
  let commitSha: string | undefined;
  let errorMessage: string | undefined;
  // Count de archivos modificados en el diff base..HEAD tras push. Se calcula
  // después del push exitoso. Visible en el AgentCard como métrica de alcance.
  // undefined = sandbox mode sin git o push falló (caemos a "—" en UI).
  let filesModified: number | undefined;
  // Paths exactos producidos en el diff. Se envían al backend en `/complete`
  // para que `materializeClaim` pueda inyectarlos al prompt del próximo
  // agente del DAG. Cap a 200 paths (mismo que el DTO) para defender contra
  // runs accidentalmente masivos (e.g., agente regenerando node_modules).
  let filesModifiedPaths: string[] | undefined;

  // ════════════════════════════════════════════════════════════════════════
  // DEBUG: snapshot del estado de decisión DESPUÉS del loop DoD y ANTES del
  // path de push/PR creation. Permite responder "¿por qué la story quedó
  // atascada?" mirando un solo log line. Si claudeCompletedOk=true entramos al if;
  // si no, vamos al else con dodFailureReason.
  // ════════════════════════════════════════════════════════════════════════
  const passedCriteriaCount = lastVerdicts.filter((v) => v.status === 'passed').length;
  const failedCriteriaCount = lastVerdicts.filter((v) => v.status === 'failed').length;
  const skippedCriteriaCount = lastVerdicts.filter((v) => v.status === 'skipped').length;
  logger.info(
    {
      event: 'run.outcome.decision',
      runId,
      claudeCompletedOk,
      cloneSucceeded,
      baseBranch,
      rawExitCode: exitCode,
      totalAttempts,
      maxAttempts: maxDodAttempts,
      passedCriteriaCount,
      failedCriteriaCount,
      skippedCriteriaCount,
      lastVerdictsSummary: lastVerdicts.map((v) => ({
        criterionId: v.criterionId,
        label: v.label,
        status: v.status,
      })),
      dodFailureReason: dodFailureReason ?? null,
      spawnError: !!spawnError.value,
      killByBackend,
      killed,
    },
    `[outcome] claudeCompletedOk=${claudeCompletedOk} passed=${passedCriteriaCount}/${lastVerdicts.length} attempts=${totalAttempts}/${maxDodAttempts} clone=${cloneSucceeded} exitCode=${exitCode}${dodFailureReason ? ` reason="${dodFailureReason.slice(0, 100)}"` : ''}`,
  );

  if (spawnError.value) {
    errorMessage = `Spawn failed: ${spawnError.value.message}`;
  } else if (killByBackend) {
    errorMessage = `Killed by backend signal (run was already terminal)`;
  } else if (killed) {
    errorMessage = `Killed after ${durationMs}ms (exceeded forgeWorkerMaxRunDurationMs=${maxRunDurationMs}ms)`;
  } else if (claudeCompletedOk) {
    logger.info(
      { event: 'run.claude_ok', runId, attempts: totalAttempts, durationMs },
      `claude terminó limpio — procediendo al push (el verifier del DoD es no-bloqueante)`,
    );

    // ════════════════════════════════════════════════════════════════════
    // HITO 4 — git push de la story branch al remote
    // ════════════════════════════════════════════════════════════════════
    //
    // Si el clone fue exitoso (estamos en git mode, no sandbox), validamos
    // que haya cambios producidos por claude y los pusheamos. El backend,
    // al recibir prBranchPushed=true, abrirá el PR via Octokit (HITO 5).
    if (cloneSucceeded && baseBranch !== null) {
      try {
        // Borra el `.env` efímero ANTES de cualquier inspección git: ya
        // cumplió su función (alimentar a claude + al verifier). Está
        // gitignoreado vía `.git/info/exclude`, pero borrarlo garantiza
        // que no entre al commit por ninguna vía. Solo se borra si ESTE
        // worker lo escribió — si el repo target ya trackeaba un `.env`,
        // `wroteEphemeralDotenv` es false y no se toca el archivo del repo.
        if (wroteEphemeralDotenv) {
          await fs.unlink(join(workdir, '.env')).catch(() => undefined);
        }

        // GARANTÍA determinista del harness: colapsar el trabajo del agente a
        // UN commit limpio que respeta .gitignore. Cubre dos fallas reales
        // observadas del agente (2026-05-27):
        //   A) deja node_modules/builds untracked → `git add -A` los agarraría.
        //   B) commitea node_modules en SU PROPIO commit → el diff explota
        //      (37k archivos) y el escaneo pre-push aborta por maxBuffer.
        // El worker NO confía en que el agente haya creado .gitignore — el
        // principio es no delegar invariantes deterministas al LLM.
        markCriterion('auto.commit', 'in_progress');

        // 1. Garantizar .gitignore robusto ANTES de cualquier staging.
        const gitignoreAdded = await ensureGitignorePatterns(workdir, runId);

        // 2. Colapsar TODOS los commits que el agente haya hecho sobre la
        //    baseBranch a un estado limpio en staging. `--soft` preserva los
        //    cambios. Si el agente NO commiteó (caso A), HEAD ya ES
        //    origin/baseBranch → no-op inofensivo.
        await git(['reset', '--soft', `origin/${baseBranch}`], workdir).catch((err) => {
          logger.warn(
            { event: 'git.autocommit.reset_soft_failed', runId, error: (err as Error).message },
            `reset --soft a origin/${baseBranch} falló (no bloqueante) — sigo con el staging actual`,
          );
        });

        // 3. Sacar del índice cualquier artefacto de build/deps que el agente
        //    haya stageado o commiteado (escenario B). `--ignore-unmatch`
        //    evita error si el path no estaba tracked. maxBuffer alineado al
        //    del diff scan (500MB): node_modules con 37k archivos genera
        //    stdout masivo y un buffer chico abortaría EL paso que limpia el
        //    bug que estamos arreglando (qa-reviewer #3). NO silenciamos el
        //    error — lo logueamos para que el paso 5 de verificación decida.
        await git(
          ['rm', '-r', '--cached', '-q', '--ignore-unmatch', ...BUILD_ARTIFACT_DIRS],
          workdir,
          500 * 1024 * 1024,
        ).catch((err) => {
          logger.warn(
            { event: 'git.autocommit.rm_cached_failed', runId, error: (err as Error).message },
            `git rm --cached de artefactos falló — el paso de verificación reintentará`,
          );
        });

        // 4. Re-stage TODO el working tree — ahora respeta el .gitignore.
        await git(['add', '-A'], workdir);

        // 5. RED DE SEGURIDAD (qa-reviewer #1/#2/#3): tras la limpieza, verificar
        //    que NINGÚN artefacto siguió tracked. Si el reset o el rm --cached
        //    fallaron silenciosamente, acá lo detectamos. Reintentamos el rm
        //    una vez más y re-stageamos. Esta verificación es lo que garantiza
        //    la invariante incluso si los pasos 2-3 fallaron parcialmente.
        const trackedArtifacts = await git(
          ['ls-files', '--', ...BUILD_ARTIFACT_DIRS],
          workdir,
          500 * 1024 * 1024,
        ).catch(() => ({ stdout: '', stderr: '' }));
        if (trackedArtifacts.stdout.trim().length > 0) {
          const stillTracked = trackedArtifacts.stdout.trim().split('\n').length;
          logger.warn(
            { event: 'git.autocommit.artifacts_still_tracked', runId, count: stillTracked },
            `${stillTracked} artefacto(s) AÚN tracked tras limpieza — segundo intento de rm --cached`,
          );
          await git(
            ['rm', '-r', '--cached', '-q', '--ignore-unmatch', ...BUILD_ARTIFACT_DIRS],
            workdir,
            500 * 1024 * 1024,
          ).catch((err) => {
            // Si el segundo intento también falla, abortamos el commit: es
            // preferible NO pushear a pushear node_modules (que rompería el
            // scan pre-push de todos modos). El run queda como error revisable.
            logger.error(
              { event: 'git.autocommit.rm_cached_retry_failed', runId, error: (err as Error).message },
              `Segundo rm --cached falló — abortando auto-commit para no pushear artefactos`,
            );
          });
          await git(['add', '-A'], workdir);
        }

        // 6. Confirmar que ningún artefacto sobrevivió a los dos intentos. Si
        //    sobrevivió, NO commiteamos: marcar failed y dejar que el flujo de
        //    push lo trate como run con error (workdir preservado para debug).
        const finalArtifactCheck = await git(
          ['ls-files', '--', ...BUILD_ARTIFACT_DIRS],
          workdir,
          500 * 1024 * 1024,
        ).catch(() => ({ stdout: '', stderr: '' }));
        if (finalArtifactCheck.stdout.trim().length > 0) {
          markCriterion('auto.commit', 'failed');
          pushFailed = true;
          errorMessage =
            'Auto-commit abortado: artefactos de build (node_modules/.next/...) ' +
            'no pudieron removerse del índice tras 2 intentos. Revisar el workdir.';
          logger.error(
            { event: 'git.autocommit.aborted_dirty_index', runId },
            errorMessage,
          );
        } else {
          // 7. Commit limpio sólo si quedó algo staged tras la limpieza.
          const staged = await git(
            ['diff', '--cached', '--name-only'],
            workdir,
            500 * 1024 * 1024,
          );
          const stagedFiles = staged.stdout.trim().split('\n').filter(Boolean);
          if (stagedFiles.length > 0) {
            logger.info(
              {
                event: 'git.autocommit.start',
                runId,
                stagedFiles: stagedFiles.length,
                gitignorePatternsAdded: gitignoreAdded,
              },
              `Auto-commit limpio: ${stagedFiles.length} archivo(s), .gitignore +${gitignoreAdded} patrón(es)`,
            );
            await git(
              [
                'commit',
                '-m',
                `Forge: ${storyTitle}\n\nAuto-commit by CENZONTLE Forge worker (run ${runId.slice(0, 8)})`,
              ],
              workdir,
            );
            markCriterion('auto.commit', 'completed');
          } else {
            // Índice limpio Y vacío: el agente no produjo cambios válidos (todo
            // era artefacto, o no tocó nada). El push posterior detecta
            // aheadCount=0 y skipea. Logueamos el contexto para distinguir este
            // caso de un fallo de staging (qa-reviewer #4).
            logger.warn(
              {
                event: 'git.autocommit.empty_after_clean',
                runId,
                gitignorePatternsAdded: gitignoreAdded,
              },
              `Sin archivos válidos para commitear tras limpieza (índice limpio, 0 staged)`,
            );
            markCriterion('auto.commit', 'completed');
          }
        }

        // 2. Verificar que hay al menos 1 commit ahead de baseBranch.
        //    Si claude no produjo nada, no hay sentido pushear (PR vacío).
        const log = await git(
          ['log', '--oneline', `origin/${baseBranch}..HEAD`],
          workdir,
        );
        const aheadCount = log.stdout.trim().split('\n').filter(Boolean).length;

        // Escaneo de seguridad pre-push. La redacción del output NO cubre el
        // CONTENIDO de los archivos que el agente escribe: si el agente
        // incrustó el valor literal de un secreto en un archivo commiteado
        // (en vez de leerlo de `process.env`), ese archivo iría al PR.
        // Escaneamos el diff `origin/<base>..HEAD` por los valores literales.
        // Fail-closed: si el diff no se puede leer, NO pusheamos — mejor
        // bloquear un PR legítimo que filtrar una credencial al remote.
        let secretLeak: string | null = null;
        if (aheadCount > 0 && safeSecrets.length > 0) {
          try {
            // `--text` fuerza el diff de archivos binarios como texto — así
            // un secreto incrustado en un blob binario (ej. una DB SQLite)
            // también se escanea. maxBuffer ampliado a 500MB tras el
            // incidente real del 2026-05-25 (run 162dc9f9 abortado por
            // `stdout maxBuffer length exceeded` con un diff legítimo que
            // excedía los 50MB previos). 500MB es el techo razonable para
            // diffs patológicos pero recuperables; arriba de eso un humano
            // debe revisar (probable bug del agente — node_modules,
            // builds, etc.). Sigue siendo fail-closed por encima del cap.
            const diff = await git(
              ['diff', '--text', `origin/${baseBranch}..HEAD`],
              workdir,
              500 * 1024 * 1024,
            );
            const diffBytes = Buffer.byteLength(diff.stdout, 'utf-8');
            // Visibilidad operativa: un diff > 100MB es señal fuerte de que
            // el agente está generando output anormal (commit accidental
            // de node_modules, dist/, etc.). NO bloqueamos — solo emitimos
            // WARN para que el operador investigue por qué creció tanto.
            if (diffBytes > 100 * 1024 * 1024) {
              logger.warn(
                {
                  event: 'git.diff.scan.large_diff',
                  runId,
                  branch,
                  baseBranch,
                  diffBytes,
                  diffMegabytes: Math.round((diffBytes / (1024 * 1024)) * 10) / 10,
                  aheadCount,
                },
                `git.diff.scan.large_diff: el diff pre-push supera 100MB (${Math.round((diffBytes / (1024 * 1024)) * 10) / 10}MB) — probable bug del agente (¿commiteo node_modules/dist/build?). Revisar el contenido del PR antes de mergear.`,
              );
            }
            const leakedNames = scanDiffForSecrets(diff.stdout, safeSecrets);
            if (leakedNames.length > 0) {
              secretLeak = `un archivo commiteado contiene el valor de: ${leakedNames.join(', ')}`;
            }
          } catch (scanErr) {
            secretLeak = `no se pudo escanear el diff pre-push (${(scanErr as Error).message})`;
          }
        }

        if (pushFailed) {
          // El auto-commit abortó por artefactos no removibles del índice
          // (pushFailed ya seteado arriba). Si el agente había dejado commits
          // propios que el `reset --soft` no pudo deshacer, aheadCount > 0 —
          // pero ESOS commits contienen node_modules. NUNCA los pusheamos.
          // Early-skip explícito antes de tocar el remote (qa-reviewer re-review
          // HIGH: el abort seteaba pushFailed pero el flujo caía igual al push).
          logger.error(
            { event: 'git.push.skip.dirty_index', runId, branch, aheadCount },
            `Push omitido — el auto-commit abortó por artefactos no removibles. ` +
              `El commit NO llega al remote aunque aheadCount=${aheadCount}.`,
          );
        } else if (aheadCount === 0) {
          logger.warn(
            { event: 'git.push.skip.empty', runId, branch },
            `No hay commits ahead de ${baseBranch} — claude no produjo cambios. Skip push.`,
          );
        } else if (secretLeak) {
          // Fuga detectada (o diff no verificable) — NO pusheamos. El secreto
          // no debe llegar al remote. El run termina sin PR y escala a humano
          // vía `errorMessage`.
          markCriterion('branch.pushed', 'failed');
          pushFailed = true;
          errorMessage = `Pre-push secret scan abort: ${secretLeak}`;
          logger.error(
            {
              event: 'git.push.abort.secret_leak',
              runId,
              branch,
              // Solo el motivo (nombres) — NUNCA el valor del secreto.
              reason: secretLeak,
            },
            `Push abortado por el escaneo de secretos: ${secretLeak}. El branch ` +
              `NO se pusheó — revisar la historia manualmente.`,
          );
        } else {
          // 3. Captura el SHA del HEAD para reportar al backend
          const rev = await git(['rev-parse', 'HEAD'], workdir);
          commitSha = rev.stdout.trim();

          // 4. Push de la story branch al remote. -u set upstream para que
          //    futuros pulls/pushes desde este workdir (si lo preserváramos
          //    para debug) funcionen sin args.
          //
          // P1 — observabilidad detallada del flujo de push. Estructura:
          //  - git.push.start: contexto pre-comando (branch, base, aheadCount, sha).
          //  - git.push.attempt: timing start del comando git push concreto.
          //  - git.push.ok: timing end, stdout/stderr summary del comando.
          //  - git.push.fail: en el catch (más abajo), con stderr + exitCode.
          //  - git.push.verify: post-push `git ls-remote` para CONFIRMAR que el
          //    branch existe en el remote. Si falla, `pushFailed=true` y el
          //    branch NO se reporta como pushed.
          markCriterion('branch.pushed', 'in_progress');

          // OBS — Preflight pre-push: verificar que el remote `origin` sigue
          // configurado. Si el agente corrió `git init`, `create-next-app`
          // o equivalente durante el run, el `.git/` pudo haber sido
          // reescrito y `origin` puede haber desaparecido. Sin este check,
          // el push falla con "fatal: 'origin' does not appear to be a git
          // repository" y el operador no entiende la causa.
          //
          // Si detectamos que falta `origin`, intentamos AUTO-RECOVERY
          // re-agregando el remote con el `repoUrl` original. El push
          // posterior debería funcionar. Si el recovery falla, el push
          // explotará con el error original — y al menos tenemos el log
          // explícito de qué pasó.
          try {
            const remoteCheck = await git(['remote', '-v'], workdir);
            const remoteLines = remoteCheck.stdout.split('\n').filter(Boolean);
            const originPresent = remoteLines.some((l) => l.startsWith('origin'));
            if (!originPresent) {
              logger.error(
                {
                  event: 'git.push.preflight.no_origin',
                  runId,
                  branch,
                  remotesFound: remoteLines.length,
                },
                `Preflight pre-push: el workdir NO tiene remote 'origin' configurado. ` +
                  `Causa típica: el agente reescribió el .git/ durante el run ` +
                  `(corrió 'git init', 'npx create-next-app', o equivalente que ` +
                  `regenera el repo). Intentando recovery: re-agregar origin.`,
              );
              try {
                await git(['remote', 'add', 'origin', repoUrl!], workdir);
                logger.info(
                  { event: 'git.push.preflight.recovery_applied', runId, branch },
                  `Recovery aplicado: 'origin' re-agregado. Reintentando push.`,
                );
              } catch (recoveryErr) {
                logger.error(
                  {
                    event: 'git.push.preflight.recovery_failed',
                    runId,
                    error: (recoveryErr as Error).message,
                  },
                  `Recovery falló: no se pudo re-agregar 'origin'. El push va a explotar.`,
                );
              }
            } else {
              logger.info(
                {
                  event: 'git.push.preflight.ok',
                  runId,
                  remotesCount: remoteLines.length,
                },
                `Preflight pre-push OK: origin presente (${remoteLines.length} remote(s) configurados).`,
              );
            }
          } catch (preErr) {
            logger.warn(
              {
                event: 'git.push.preflight.check_failed',
                runId,
                error: (preErr as Error).message,
              },
              `Preflight pre-push no se pudo ejecutar (no bloqueante; el push real igual va a intentar)`,
            );
          }

          logger.info(
            {
              event: 'git.push.start',
              runId,
              branch,
              baseBranch,
              remote: 'origin',
              commitSha,
              commitShaShort: commitSha.slice(0, 7),
              aheadCount,
            },
            `git push origin ${branch} (${aheadCount} commits, sha=${commitSha.slice(0, 7)})`,
          );

          const pushStartedAt = Date.now();
          logger.info(
            {
              event: 'git.push.attempt',
              runId,
              branch,
              remote: 'origin',
              startedAt: new Date(pushStartedAt).toISOString(),
            },
            `Ejecutando: git push -u origin ${branch}`,
          );
          const pushResult = await git(['push', '-u', 'origin', branch], workdir);
          const pushDurationMs = Date.now() - pushStartedAt;
          // Stdout/stderr del push pueden contener URLs con token embebido si
          // git las imprime — pasamos por `redactRepoUrlCredentials` defensivo.
          const pushStdoutRedacted = redactRepoUrlCredentials(
            pushResult.stdout ?? '',
            repoUrl,
          );
          const pushStderrRedacted = redactRepoUrlCredentials(
            pushResult.stderr ?? '',
            repoUrl,
          );
          // Heurística de bytes uploaded: git push imprime " ... KiB | ... KiB/s"
          // en stderr cuando hay transferencia. Capturamos la primera ocurrencia
          // como evidencia de upload — si NO aparece, puede ser un push de un
          // branch vacío o pre-existente y reportamos null (no error).
          const bytesMatch = pushStderrRedacted.match(/(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|bytes)/);
          const bytesUploaded = bytesMatch ? `${bytesMatch[1]} ${bytesMatch[2]}` : null;
          logger.info(
            {
              event: 'git.push.ok',
              runId,
              branch,
              commitSha,
              commitShaShort: commitSha.slice(0, 7),
              durationMs: pushDurationMs,
              bytesUploaded,
              commitsPushed: aheadCount,
              // stdout suele ser vacío en pushes exitosos; stderr es donde git
              // pone "Writing objects: ...", el `remote: ` y el "main -> main".
              stdoutPreview: pushStdoutRedacted.slice(0, 500),
              stderrPreview: pushStderrRedacted.slice(0, 1000),
            },
            `Push exitoso (${pushDurationMs}ms, ${bytesUploaded ?? 'tamaño desconocido'}) — verificando contra el remote`,
          );

          // INVARIANTE NUEVA — confirmar que el branch EXISTE en el remote tras
          // el push. Sin esto, un `git push` con éxito aparente pero que NO
          // llegó a propagar (fast-forward sin escritura efectiva al remote
          // por un bug del servidor, push hook silencioso, etc.) marcaría el
          // run como completo y borraríamos el workdir — el bug del incidente
          // real del 2026-05-25. `git ls-remote origin {branch}` retorna 0
          // líneas si el branch NO existe; verificamos que aparezca y que el
          // SHA coincida con el commitSha local.
          let verifyOk = false;
          let verifyRemoteSha: string | null = null;
          try {
            const lsRemote = await git(
              ['ls-remote', '--exit-code', '--heads', 'origin', branch],
              workdir,
            );
            // Output: "SHA<TAB>refs/heads/BRANCH". Si --exit-code y el branch
            // no existe, git retorna 2 → throw → catch abajo. Si existe,
            // tenemos al menos una línea con el SHA del HEAD remoto.
            const remoteLine = lsRemote.stdout.trim().split('\n').find(Boolean);
            if (remoteLine) {
              verifyRemoteSha = remoteLine.split(/\s+/)[0] ?? null;
            }
            if (verifyRemoteSha && verifyRemoteSha === commitSha) {
              verifyOk = true;
              logger.info(
                {
                  event: 'git.push.verify.ok',
                  runId,
                  branch,
                  remoteSha: verifyRemoteSha,
                  remoteShaShort: verifyRemoteSha.slice(0, 7),
                  localShaShort: commitSha.slice(0, 7),
                },
                `Push verificado: branch ${branch} existe en origin con sha=${verifyRemoteSha.slice(0, 7)}`,
              );
            } else {
              // Branch EXISTE pero el SHA NO coincide — push no propagó el
              // commit nuevo (force-push del lado remoto?, hook?). Severidad
              // ERROR.
              logger.error(
                {
                  event: 'git.push.verify.mismatch',
                  runId,
                  branch,
                  localCommitSha: commitSha,
                  remoteSha: verifyRemoteSha,
                  remoteShaShort: verifyRemoteSha?.slice(0, 7) ?? null,
                  localShaShort: commitSha.slice(0, 7),
                },
                `git.push.verify.mismatch: el remote tiene sha=${verifyRemoteSha?.slice(0, 7) ?? 'desconocido'} pero el local commiteó ${commitSha.slice(0, 7)} — el push no propagó el commit esperado`,
              );
            }
          } catch (verifyErr) {
            const rawVerifyErr = verifyErr as Error & { stderr?: string };
            const verifyErrCombined = `${rawVerifyErr.message ?? ''}${rawVerifyErr.stderr ? ` :: ${rawVerifyErr.stderr}` : ''}`.trim();
            const verifyErrMsg = redactRepoUrlCredentials(
              verifyErrCombined,
              repoUrl,
            );
            logger.error(
              {
                event: 'git.push.verify.fail',
                runId,
                branch,
                error: verifyErrMsg,
              },
              `git.push.verify.fail: ls-remote no encontró ${branch} en origin (push silenciosamente perdido). El run se marcará como push-failed.`,
            );
          }

          // Aplica la invariante: si la verificación falló, NO marques el
          // branch como pushed. Esto fuerza el run a exit code 74 (EX_IOERR)
          // → el backend marca la story 'blocked' para revisión humana y
          // el workdir se preservará (P5 abajo) para recuperación.
          if (!verifyOk) {
            pushFailed = true;
            markCriterion('branch.pushed', 'failed');
            errorMessage =
              errorMessage ??
              `Push verification failed: branch ${branch} no encontrado en remote o sha mismatch. Local sha=${commitSha.slice(0, 7)}, remote sha=${verifyRemoteSha?.slice(0, 7) ?? 'ausente'}`;
          } else {
            prBranchPushed = true;
            markCriterion('branch.pushed', 'completed');
            logger.info(
              {
                event: 'git.push.ok.confirmed',
                runId,
                branch,
                commitShaShort: commitSha.slice(0, 7),
              },
              `Push confirmado — backend abrirá PR via Octokit`,
            );
          }

          // 5. Count de archivos modificados en el diff base..HEAD. Visible
          //    en el AgentCard como "X files". Comparamos contra origin/<base>
          //    (que sí existe local — lo trajimos en el `git clone -b`) para
          //    obtener el delta neto del trabajo del agente. `--name-only` da
          //    1 path por línea; filtramos vacíos para no inflar el count.
          try {
            const diffNames = await git(
              ['diff', '--name-only', `origin/${baseBranch}..HEAD`],
              workdir,
            );
            const allPaths = diffNames.stdout
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            filesModified = allPaths.length;
            // Cap a 200 paths para alinear con el DTO del backend y defender
            // contra runs accidentalmente masivos (e.g., agente regenerando
            // package-lock.json + node_modules entries). Si el count excede,
            // truncamos y loggeamos para forensics — el agente del DAG
            // dependiente aún recibe los primeros 200 (típicamente los más
            // relevantes alfabéticamente).
            filesModifiedPaths = allPaths.slice(0, 200);
            logger.info(
              {
                event: 'git.files.counted',
                runId,
                filesModified,
                pathsTruncated: allPaths.length > 200,
                pathsKept: filesModifiedPaths.length,
              },
              `Diff stats: ${filesModified} archivos modificados (${filesModifiedPaths.length} paths persistidos)`,
            );
          } catch (diffErr) {
            // No-fatal: si el diff falla por alguna razón rara, dejamos el
            // campo como undefined → UI muestra "—" en lugar de "0 files".
            logger.warn(
              {
                event: 'git.files.count.fail',
                runId,
                error: (diffErr as Error).message,
              },
              `Failed to count modified files — UI dejará el campo en —`,
            );
          }
        }
      } catch (err) {
        // Q5 (2026-05-21): el push al remote falló (auth, conflict, red).
        // claude terminó limpio pero su trabajo NO llegó al remote — sin
        // push no hay PR ni merge. Es un ERROR del run: `pushFailed` lo
        // convierte en exit code 74 → el backend marca la story 'blocked'.
        markCriterion('branch.pushed', 'failed');
        pushFailed = true;
        // git imprime la URL del remote (origin = repoUrl, con token) en los
        // errores de auth del push. Redactar antes de loguear / reportar.
        // `execFile` puede vaciar la URL en `.message`, `.stderr` o ambos;
        // concatenamos los dos para que el redactor cubra los dos canales.
        // Aplicamos AMBOS redactores: `redactRepoUrlCredentials` cubre el
        // formato URL exacto del clone; `redactSecrets` cubre patrones por
        // prefijo (sk-ant-, ghp_, etc.) por si stderr trae otros tokens.
        const rawPushErr = err as Error & {
          stderr?: string;
          code?: number;
          signal?: NodeJS.Signals;
        };
        const pushErrCombined = `${rawPushErr.message ?? ''}${rawPushErr.stderr ? ` :: ${rawPushErr.stderr}` : ''}`.trim();
        const pushErrMsg = redactSecrets(
          redactRepoUrlCredentials(pushErrCombined, repoUrl),
        );
        const pushStderrFull = redactSecrets(
          redactRepoUrlCredentials(rawPushErr.stderr ?? '', repoUrl),
        );
        logger.error(
          {
            event: 'git.push.fail',
            runId,
            branch,
            attempt: 1, // git push no retry-internal — un único attempt acá
            exitCode: rawPushErr.code ?? null,
            signal: rawPushErr.signal ?? null,
            error: pushErrMsg.slice(0, 2000),
            // stderr completo (post-redacción) — útil para forensics. Cap a
            // 4000 chars para evitar logs gigantes.
            stderr: pushStderrFull.slice(0, 4000),
          },
          `Push falló — run marcado como error. Los cambios quedaron solo en el workdir local (P5 lo preserva si pushFailed=true).`,
        );
        errorMessage = `Push failed: ${pushErrMsg.slice(0, 500)}`;
      }
    }
    // Nota: ya NO existe la rama `else if (repoUrl !== null)` que antes caía
    // a sandbox mode cuando el clone fallaba con repoUrl válido — desde
    // 2026-05-21 el fallo de clone aborta el run en línea ~487 con exit 69
    // y `return`, así que llegar acá con `cloneSucceeded=false &&
    // repoUrl !== null` es imposible. El único camino al else implícito es
    // sandbox legítimo (`repoUrl === null`), donde no hay nada que pushear.
  } else {
    // claudeCompletedOk=false ⇒ claude NO terminó limpio. El verifier es
    // no-bloqueante, así que la única vía a este branch es un fallo DURO
    // del agente en el ÚLTIMO attempt: crash, exit≠0, sandbox/spawn fail
    // (los attempts intermedios con fallo duro se reintentaron). Los kills
    // por timeout/backend ya se ramificaron arriba. `dodFailureReason` lo
    // setea el `break` del loop con el detalle del crash.
    errorMessage = dodFailureReason ?? `claude terminó con error (exitCode=${exitCode})`;
    logger.error(
      {
        event: 'run.failed',
        runId,
        exitCode,
        durationMs,
        attempts: totalAttempts,
        reason: errorMessage,
      },
      `Run falló: ${errorMessage}`,
    );
  }

  // Reporta complete al backend. Si esto falla, el sweeper marcará abandoned
  // después de 10min — graceful degradation.
  // Variables del payload se declaran FUERA del try porque el catch necesita
  // accederlas para persistir el `pending-complete` a disco (P2 — recovery).
  let reportedExitCode = 0;
  let completePayload: Record<string, unknown> = {};
  try {
    // Reportar exitCode semánticamente correcto (qa-reviewer F-A):
    //  - 127: spawn falló (binario no encontrado, exec error) — POSIX convention
    //  - 143: backend mató el run administrativamente (128 + SIGTERM=15)
    //  - 124: timeout MAX_RUN_DURATION_MS (timeout(1) convention)
    //  - exitCode real: claude terminó por su cuenta
    //
    // F-E clamp: si todos los flags son false y exitCode es -1 (close
    // recibió null code, p.ej. SIGKILL del OS), `Math.max(0, ...)` evita
    // que el DTO `@Min(0)` rechace el payload con HTTP 400 y nos deje
    // colgados sin reportar.
    // exitCode semánticamente correcto:
    //  - 127: spawn falló (binario no encontrado, exec error) — POSIX convention
    //  - 143: backend mató el run administrativamente (128 + SIGTERM=15)
    //  - 124: timeout MAX_RUN_DURATION_MS (timeout(1) convention)
    //  - 74:  push al remote falló o se abortó por fuga de secretos (EX_IOERR)
    //  - 65:  doom loop — 2 turnos seguidos sin progreso (EX_DATAERR). El run
    //         se cortó; el backend marca la story 'blocked' y escala a humano.
    //  - exitCode real de claude: terminó por su cuenta
    //
    // NOTA: un criterio del DoD sin cumplir tras agotar los intentos NO es
    // error — es deuda (warn en `dodVerification`), exit 0. El código 65 es
    // SOLO para el doom loop (agente atorado), nunca para warns normales.
    reportedExitCode = spawnError.value
      ? 127
      : killByBackend
        ? 143
        : killed
          ? 124
          : pushFailed
            ? 74
            : doomLooped
              ? 65
              : Math.max(0, exitCode);

    const finalCriteriaProgress = buildCriteriaPayload();
    // Dev-only: en mock mode, le pedimos al backend que marque la story
    // como 'done' inmediatamente en vez de 'in_review' aunque haya PR. Sin
    // esto, el DAG se atora porque las stories quedan esperando merge
    // manual del PR (no hay webhook de GitHub aún). Solo aplica cuando
    // el verifier está mockeado — en prod el flag es siempre false.
    const forceCompletion = process.env.DOD_VERIFIER_MOCK === '1';

    // ════════════════════════════════════════════════════════════════════
    // DEBUG: predicción del outcome del backend. El backend computa
    // `movedToReview` y `movedToDoneSandbox` con la misma lógica que aquí
    // documentamos. Si AMBOS son false → story queda atascada (caso bug).
    //
    // Desde el security fix de 2026-05-22 el worker NUNCA envía `prNumber`
    // (campo removido del DTO). El backend abre el PR vía Octokit cuando
    // recibe `prBranchPushed=true` con `exitCode=0`, así que la predicción
    // se simplifica: si exitedClean && prBranchPushed, el backend abrirá
    // PR (estado "PENDING_BACKEND_PR_CREATION", NO stuck).
    // ════════════════════════════════════════════════════════════════════
    const predExitedClean = reportedExitCode === 0;
    const predWillBackendOpenPr = predExitedClean && prBranchPushed;
    const predEffectivePrNumber = predWillBackendOpenPr ? 'expected' : 'none';
    const predMovedToReview =
      predExitedClean && predEffectivePrNumber === 'expected' && !forceCompletion;
    const predMovedToDoneSandboxSandboxOnly =
      predExitedClean && !prBranchPushed;
    const predMovedToDoneViaMockMerge =
      predExitedClean && predEffectivePrNumber === 'expected' && forceCompletion;
    const predMovedToDoneSandbox =
      predMovedToDoneSandboxSandboxOnly || predMovedToDoneViaMockMerge;
    const predStuck =
      predExitedClean && !predMovedToReview && !predMovedToDoneSandbox;
    const predExpected = predMovedToReview
      ? 'in_review (asumiendo PR creation OK)'
      : predMovedToDoneViaMockMerge
        ? 'done (asumiendo PR creation + auto-merge OK)'
        : predMovedToDoneSandboxSandboxOnly
          ? 'done (sandbox sin push)'
          : predExitedClean
            ? 'no_transition (revisar lógica)'
            : 'failed_no_transition';
    logger.info(
      {
        event: 'run.complete.payload',
        runId,
        payload: {
          exitCode: reportedExitCode,
          prBranchPushed,
          commitSha: commitSha?.slice(0, 7) ?? null,
          attempts: totalAttempts,
          forceCompletion,
          hasDodVerification: verificationLog.length > 0,
        },
        predictedBackendOutcome: {
          exitedClean: predExitedClean,
          willBackendOpenPr: predWillBackendOpenPr,
          movedToReview: predMovedToReview,
          movedToDoneSandbox: predMovedToDoneSandbox,
          stuck: predStuck,
          expected: predExpected,
        },
      },
      predStuck
        ? `[complete.predict] ⚠ STORY PUEDE QUEDAR ATASCADA: exitedClean=true pero prBranchPushed=${prBranchPushed} forceCompletion=${forceCompletion}. Revisar push/PR creation upstream.`
        : `[complete.predict] esperado=${predExpected}`,
    );

    // Summary del generator usage agregado across attempts (mismo cálculo que
    // se hace en vivo dentro del stdout handler — extraído a `buildGeneratorSummary`
    // por DRY). Si el array está vacío (caso edge: claude crasheó antes de emitir
    // result), retorna undefined y el backend lo trata como ausente.
    const generatorSummary = buildGeneratorSummary(generatorPerAttempt);
    if (generatorSummary) {
      logger.info(
        {
          event: 'generator.cost.run_summary',
          runId,
          ...generatorSummary,
          perAttempt: undefined, // pino-friendly: el detalle ya está en eventos generator.usage
        },
        `[generator.cost.run_summary] runId=${runId.slice(0, 8)} ` +
          `attempts=${generatorSummary.callsCount} ` +
          `tokens(in/out/cw/cr)=${generatorSummary.totalInputTokens}/` +
          `${generatorSummary.totalOutputTokens}/${generatorSummary.totalCacheCreationInputTokens}/` +
          `${generatorSummary.totalCacheReadInputTokens} ` +
          `TOTAL_COST=$${generatorSummary.totalCostUsd.toFixed(4)} ` +
          `duration=${(generatorSummary.totalDurationMs / 1000).toFixed(1)}s`,
      );
    }

    // P2 — observabilidad del /complete. El payload final que vamos a postear,
    // construido una sola vez para permitir el fallback de "pending complete"
    // si todos los retries del ApiClient fallan. Asignamos a la `let` outer
    // para que el catch tenga acceso al payload completo.
    completePayload = {
      exitCode: reportedExitCode,
      // `prNumber` NO se envía: el campo fue removido del DTO en el security
      // fix de 2026-05-22 — el backend lo abre vía Octokit con `headBranch`
      // trusted y persiste el número autoritativo desde la respuesta.
      prBranchPushed,
      commitSha,
      errorMessage,
      lastOutput: finalOutput,
      criteriaProgress: finalCriteriaProgress,
      // Tier 1 Harness — total attempts del DoD loop + log estructurado de
      // verdicts por attempt. Backend persiste para visibility en UI.
      attempts: totalAttempts,
      dodVerification: verificationLog.length > 0 ? verificationLog : undefined,
      generatorUsage: generatorSummary,
      filesModified,
      filesModifiedPaths,
      ...(forceCompletion ? { forceCompletion: true } : {}),
    };

    logger.info(
      {
        event: 'complete.report.start',
        runId,
        summary: {
          exitCode: reportedExitCode,
          prBranchPushed,
          commitShaShort: commitSha?.slice(0, 7) ?? null,
          attempts: totalAttempts,
          hasDodVerification: verificationLog.length > 0,
          pushFailed,
          forceCompletion,
        },
      },
      `[complete.report.start] reportando /complete al backend (exitCode=${reportedExitCode} pushed=${prBranchPushed} attempts=${totalAttempts})`,
    );

    // El ApiClient ya hace retry exponencial (3 intentos sobre 5xx + network).
    // Loguamos `complete.report.attempt` UNA vez con el comienzo del request:
    // el ApiClient internamente emite `api.retry` por cada retry adicional, así
    // que el operador ve el flow completo en los logs sin duplicación.
    const completeStartedAt = Date.now();
    logger.info(
      {
        event: 'complete.report.attempt',
        runId,
        endpoint: `/factory/workers/runs/${runId}/complete`,
        startedAt: new Date(completeStartedAt).toISOString(),
      },
      `POST /complete iniciado (el ApiClient hará hasta 3 retries en network/5xx)`,
    );

    await client.post(`/factory/workers/runs/${runId}/complete`, completePayload);
    logger.info(
      {
        event: 'run.complete',
        runId,
        rawExitCode: exitCode,
        reportedExitCode,
        durationMs,
        complete_request_ms: Date.now() - completeStartedAt,
        prBranchPushed,
        commitSha: commitSha?.slice(0, 7),
        killed,
        killByBackend,
        spawnError: !!spawnError.value,
        claudeCompletedOk,
        totalAttempts,
        passedCriteriaCount,
        failedCriteriaCount,
        forceCompletion,
      },
      `Run reported complete: claudeCompletedOk=${claudeCompletedOk} exitCode=${reportedExitCode} pushed=${prBranchPushed} (PR opening delegated to backend)`,
    );
  } catch (err) {
    if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
      // Backend ya en terminal — esperado si killByBackend=true. No es error.
      logger.info(
        { event: 'run.complete.already_terminal', runId, status: err.status },
        'Backend already had this run terminal — skip complete report',
      );
    } else if (err instanceof ApiError && err.status === 400) {
      // Bad Request — validation failed en el backend. Loggear el BODY del
      // response para diagnóstico exacto del campo que falló (e.g.
      // MaxLength violation, enum mismatch, missing required field).
      // Sin esto el 400 es opaco y debugging tiene que ser por adivinación.
      //
      // Tras el incidente del 2026-05-25 (run 162dc9f9 perdido por
      // criterionId > 200 chars): PERSISTIMOS el payload a disco con flag
      // `recovery_blocked_by_dto=true`. Reintentar daría el mismo 400, así
      // que `recoverOnePendingComplete` NO lo reintenta automáticamente —
      // queda esperando intervención humana (arreglar el DTO, redeployar
      // backend, luego renombrar el archivo o limpiar la marca para que
      // el próximo boot lo reintente). Sin esto el código del run se pierde.
      logger.error(
        {
          event: 'complete.report.fail.dto_validation',
          runId,
          status: 400,
          backendErrorBody: err.body,
        },
        `Backend rejected /complete with 400 (DTO validation) — see backendErrorBody. Escribiendo pending-complete con recovery_blocked_by_dto=true; revisar el DTO y limpiar la marca manualmente para reintentar.`,
      );
      const pendingPath = await writePendingComplete(
        runId,
        completePayload,
        3,
        true,
        err.body,
      );
      if (pendingPath) {
        logger.warn(
          {
            event: 'complete.report.fail.dto_validation.queued',
            runId,
            pendingPath,
            exitCode: reportedExitCode,
            prBranchPushed,
          },
          `[recovery] /complete diferido a ${pendingPath} con recovery_blocked_by_dto=true — NO se reintenta automáticamente`,
        );
      }
    } else {
      // P2 — diferenciar fallo de red (recuperable, vale persistir para boot
      // recovery) vs fallo persistente (5xx tras los retries del ApiClient, o
      // un crash inesperado). En ambos casos persistimos el payload — la
      // distinción de severidad ayuda al operador pero la acción es la misma:
      // dejar el archivo para el próximo boot.
      const apiErr = err instanceof ApiError ? err : null;
      const isNetworkError = apiErr?.status === 0;
      const eventName = isNetworkError
        ? 'complete.report.fail.network'
        : 'complete.report.fail.persistent';
      logger.error(
        {
          event: eventName,
          runId,
          error: (err as Error).message,
          status: apiErr ? apiErr.status : null,
          backendErrorBody: apiErr ? apiErr.body : null,
          // ApiClient ya agotó sus 3 retries internos antes de throwear.
          attemptsCount: 3,
        },
        isNetworkError
          ? `Failed to report complete (network error after 3 retries) — escribiendo pending-complete para boot recovery`
          : `Failed to report complete (persistent error) — escribiendo pending-complete; si es un bug del backend, el próximo boot reintenta`,
      );

      // Persistimos el payload a disco para boot-time recovery. Si el write
      // mismo falla, el sweeper backend marcará abandoned tras 10min — fail
      // open al peor caso conocido.
      const pendingPath = await writePendingComplete(runId, completePayload, 3);
      if (pendingPath) {
        logger.info(
          {
            event: 'complete.report.fail.persistent.queued',
            runId,
            pendingPath,
            exitCode: reportedExitCode,
            prBranchPushed,
          },
          `[recovery] /complete diferido a ${pendingPath} — boot recovery del worker lo retomará`,
        );
      }
    }
  }

  // Cleanup: borra el workdir temporal. P5 — guard defensivo POSITIVO:
  // SOLO borramos el workdir si CONFIRMAMOS que el branch llegó al remote
  // (`prBranchPushed === true`, que solo se setea tras `git.push.verify.ok`).
  // Cualquier otro path preserva el workdir para recovery manual. El
  // operador entra al directorio, inspecciona el estado de git, y
  // manualmente pushea o copia el código. Sin esto, un fallo silencioso
  // de push perdería todo el trabajo del agente al borrar /tmp/factory-run-{uuid}/.
  //
  // Los 3 paths de no-push que esta guard cubre — TODOS terminan con
  // `prBranchPushed=false` y `pushFailed=true` salvo el sandbox legítimo:
  //   (1) push fail (try/catch del git push): `pushFailed=true`, `prBranchPushed=false`
  //   (2) secret leak abort:                  `pushFailed=true`, `prBranchPushed=false`
  //   (3) push verify mismatch (ls-remote):   `pushFailed=true`, `prBranchPushed=false`
  // Plus:
  //   (4) aheadCount === 0 (agente no commiteó nada): `pushFailed=false`,
  //       `prBranchPushed=false` — preservamos por defensa (puede haber
  //       cambios uncommitted que el operador quiera revisar).
  //
  // En sandbox mode (repoUrl === null) NO hay nada que preservar y siempre
  // borramos. En git mode con push confirmado, happy-path inalterado.
  const shouldPreserveWorkdir =
    repoUrl !== null && cloneSucceeded && prBranchPushed !== true;
  if (shouldPreserveWorkdir) {
    logger.warn(
      {
        event: 'cleanup.workdir.skip.unverified_push',
        runId,
        workdir,
        branch,
        pushFailed,
        prBranchPushed,
        cloneSucceeded,
        commitSha: commitSha ?? null,
      },
      `workdir preserved for recovery: ${workdir} (pushFailed=${pushFailed}, prBranchPushed=${prBranchPushed}). Inspeccionar manualmente: cd ${workdir} && git log -1 && git push origin ${branch}`,
    );
  } else {
    try {
      await fs.rm(workdir, { recursive: true, force: true });
      logger.info(
        { event: 'cleanup.workdir.ok', runId, workdir },
        `workdir limpiado: ${workdir}`,
      );
    } catch (err) {
      logger.warn(
        { event: 'workdir.cleanup.fail', runId, error: (err as Error).message },
        'Workdir cleanup failed (non-fatal)',
      );
    }
  }
}

/**
 * Parsea una línea de output de `claude --output-format stream-json` y la
 * convierte a texto humano-readable para escribir al log file.
 *
 * El CLI emite eventos JSON tipo:
 *   - `stream_event` con `content_block_delta` → token-by-token streaming del LLM
 *   - `assistant` con `message.content[]` → mensaje completo (texto o tool_use)
 *   - `user` con `tool_result` → resultado de una tool ejecutada
 *   - `result` → summary final del run (cost, duration, turns)
 *   - `system` → init / tool init (suprimimos — ruido)
 *
 * Si la línea no es JSON parseable (caso edge — ej. error pre-streaming
 * del CLI), devolvemos la línea raw + newline para no perder visibilidad.
 *
 * Devuelve `null` cuando el evento debe ser suprimido.
 */
/**
 * Usage capturado del evento `result` final del generator (claude -p con
 * --output-format stream-json). Shape derivado de la doc oficial del Claude
 * Agent SDK (SDKResultMessage). Captura **por attempt** porque el DoD loop
 * puede re-spawnear claude hasta `maxDodAttempts` veces (retry por crash o
 * por criterios del DoD sin cumplir).
 *
 * Decisión de diseño 2026-05-13: separamos generator usage del verifier usage
 * porque son modelos distintos (Haiku vs Sonnet) con price tables diferentes.
 * El backend agrega ambos en `getBatchDetail.totalCostUsd` pero los persiste
 * por separado para forensics y cost optimization futura.
 */
export interface GeneratorAttemptUsage {
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  isError: boolean;
  subtype: string;
  // service_tier reportado por el CLI. Valores observados:
  //   "standard"     → autenticación vía API key (cobra créditos)
  //   "priority"     → autenticación vía OAuth subscription (Pro/Max — no cobra)
  //   null/undefined → response truncada o stream incompleto
  // Esta es la sonda forense más confiable para detectar si el OAuth ganó
  // o si el CLI cayó silenciosamente a una API key fantasma (Keychain/helper).
  serviceTier: string | null;
}

/**
 * Parsea una línea del stream-json output del generator. Si la línea es el
 * evento `result` final con cost/usage, retorna el usage capturado. Si no
 * (texto regular, assistant message, etc.), retorna null.
 *
 * Fields según SDKResultMessage:
 *   - total_cost_usd (NO `cost_usd` — bug previo en formatStreamEvent)
 *   - duration_ms, duration_api_ms, num_turns, is_error, subtype
 *   - usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}
 */
/**
 * Summary del generator agregado across attempts. Lo que se manda al backend
 * en /progress y /complete. Definido aquí (no en un .d.ts) porque sirve como
 * shape contract entre el accumulator del runOnce y el JSON payload del POST.
 */
export interface GeneratorUsageSummary {
  callsCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCacheReadInputTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalDurationApiMs: number;
  totalNumTurns: number;
  perAttempt: GeneratorAttemptUsage[];
}

/**
 * Construye el summary agregado a partir del array per-attempt. Helper
 * extraído porque se invoca en DOS lugares:
 *   1. Real-time post a /progress después de cada `result` event capturado
 *   2. Final post a /complete con el summary completo del run
 * Devuelve undefined si no hay attempts (caso edge: spawn falló antes del
 * primer `result`).
 */
function buildGeneratorSummary(
  perAttempt: GeneratorAttemptUsage[],
): GeneratorUsageSummary | undefined {
  if (perAttempt.length === 0) return undefined;
  return {
    callsCount: perAttempt.length,
    totalInputTokens: perAttempt.reduce((s, a) => s + a.inputTokens, 0),
    totalOutputTokens: perAttempt.reduce((s, a) => s + a.outputTokens, 0),
    totalCacheCreationInputTokens: perAttempt.reduce(
      (s, a) => s + a.cacheCreationInputTokens,
      0,
    ),
    totalCacheReadInputTokens: perAttempt.reduce(
      (s, a) => s + a.cacheReadInputTokens,
      0,
    ),
    totalCostUsd: perAttempt.reduce((s, a) => s + a.totalCostUsd, 0),
    totalDurationMs: perAttempt.reduce((s, a) => s + a.durationMs, 0),
    totalDurationApiMs: perAttempt.reduce((s, a) => s + a.durationApiMs, 0),
    totalNumTurns: perAttempt.reduce((s, a) => s + a.numTurns, 0),
    perAttempt,
  };
}

/**
 * Construye el summary LIVE combinando attempts ya cerrados (cost autoritativo
 * del SDK) + tokens running del attempt actual en curso (cost estimado via
 * price table). Retorna undefined si no hay ningún data point todavía (claude
 * recién spawneado, antes del primer `assistant` event).
 *
 * Diferencia clave vs `buildGeneratorSummary`: este incluye el `runningTokens`
 * del attempt en curso como una entry SINTÉTICA en `perAttempt`. La entry
 * sintética se reemplaza cuando llegue el `result` event real del attempt.
 *
 * Usado SOLO en el progress loop (live cost). El /complete final usa
 * `buildGeneratorSummary` con solo los attempts cerrados.
 */
function buildLiveGeneratorSummary(
  closedAttempts: GeneratorAttemptUsage[],
  running: GeneratorRunningTokens | null,
): GeneratorUsageSummary | undefined {
  if (closedAttempts.length === 0 && !running) return undefined;
  // Entry sintética para el attempt en curso. Cuando llegue el `result`
  // event real, esta entry se descarta y el closedAttempts gana la entry
  // autoritativa via parseResultUsage.
  const runningSynthetic: GeneratorAttemptUsage[] = running
    ? [
        {
          attempt: running.attempt,
          inputTokens: running.inputTokens,
          outputTokens: running.outputTokens,
          cacheCreationInputTokens: running.cacheCreationInputTokens,
          cacheReadInputTokens: running.cacheReadInputTokens,
          totalCostUsd: running.estimatedCostUsd,
          durationMs: 0, // no disponible hasta el `result`
          durationApiMs: 0,
          numTurns: 0,
          isError: false,
          subtype: 'in_progress',
          serviceTier: null, // no disponible hasta el `result`
        },
      ]
    : [];
  const allAttempts = [...closedAttempts, ...runningSynthetic];
  return {
    callsCount: allAttempts.length,
    totalInputTokens: allAttempts.reduce((s, a) => s + a.inputTokens, 0),
    totalOutputTokens: allAttempts.reduce((s, a) => s + a.outputTokens, 0),
    totalCacheCreationInputTokens: allAttempts.reduce(
      (s, a) => s + a.cacheCreationInputTokens,
      0,
    ),
    totalCacheReadInputTokens: allAttempts.reduce(
      (s, a) => s + a.cacheReadInputTokens,
      0,
    ),
    totalCostUsd: allAttempts.reduce((s, a) => s + a.totalCostUsd, 0),
    totalDurationMs: allAttempts.reduce((s, a) => s + a.durationMs, 0),
    totalDurationApiMs: allAttempts.reduce((s, a) => s + a.durationApiMs, 0),
    totalNumTurns: allAttempts.reduce((s, a) => s + a.numTurns, 0),
    perAttempt: allAttempts,
  };
}

function parseResultUsage(line: string, attempt: number): GeneratorAttemptUsage | null {
  if (!line.trim()) return null;
  let evt: unknown;
  try {
    evt = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof evt !== 'object' || evt === null) return null;
  const e = evt as Record<string, unknown>;
  if (e.type !== 'result') return null;
  const usage = (e.usage as Record<string, unknown> | undefined) ?? {};
  return {
    attempt,
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    cacheCreationInputTokens:
      typeof usage.cache_creation_input_tokens === 'number'
        ? usage.cache_creation_input_tokens
        : 0,
    cacheReadInputTokens:
      typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0,
    totalCostUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : 0,
    durationMs: typeof e.duration_ms === 'number' ? e.duration_ms : 0,
    durationApiMs: typeof e.duration_api_ms === 'number' ? e.duration_api_ms : 0,
    numTurns: typeof e.num_turns === 'number' ? e.num_turns : 0,
    isError: typeof e.is_error === 'boolean' ? e.is_error : false,
    subtype: typeof e.subtype === 'string' ? e.subtype : 'unknown',
    serviceTier: typeof usage.service_tier === 'string' ? usage.service_tier : null,
  };
}

/**
 * Tokens running totals capturados de eventos `assistant` durante un attempt
 * en curso. A diferencia de `GeneratorAttemptUsage` (que viene del `result`
 * final), esto refleja el progreso en VIVO del attempt — se actualiza con
 * cada turno del modelo y se resetea cuando el `result` event marca el cierre
 * del attempt.
 *
 * Cost en USD estimado client-side con price table de Haiku 4.5 (modelo default
 * del Forge). Cuando llega el `result` event, ese cost reemplaza el estimate
 * con el valor autoritativo del SDK.
 */
export interface GeneratorRunningTokens {
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  estimatedCostUsd: number;
}

/**
 * Price table de Haiku 4.5 — modelo default del Forge según run.model logs.
 * USD per 1M tokens. Usado SOLO para el estimate live mientras claude corre;
 * el cost final del attempt lo provee el SDK en el `result` event.
 *
 * Fuente: https://platform.claude.com/docs/about-claude/pricing (Haiku 4.5)
 * Si se cambia el modelo default del worker, actualizar este table.
 */
const HAIKU_45_PRICES_USD_PER_1M = {
  input: 1.0,
  output: 5.0,
  cacheCreationInput: 1.25,
  cacheReadInput: 0.1,
};

function estimateHaikuCost(tokens: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}): number {
  return (
    (tokens.inputTokens * HAIKU_45_PRICES_USD_PER_1M.input +
      tokens.outputTokens * HAIKU_45_PRICES_USD_PER_1M.output +
      tokens.cacheCreationInputTokens * HAIKU_45_PRICES_USD_PER_1M.cacheCreationInput +
      tokens.cacheReadInputTokens * HAIKU_45_PRICES_USD_PER_1M.cacheReadInput) /
    1_000_000
  );
}

/**
 * Parsea una línea del stream-json. Si la línea es un evento `assistant` con
 * `message.usage` (un turno del modelo durante la conversación), retorna los
 * tokens incrementales de ESE turno. Si no aplica, retorna null.
 *
 * Cada turno (`assistant` event) tiene su propio usage per-API-call. Para
 * tener running total, el caller acumula SUMANDO los usages de todos los
 * assistant events que llegan durante un attempt.
 */
/**
 * Parsea una línea del stream-json. Si la línea es un `assistant` event que
 * contiene un `tool_use` (el agente invocó una tool), retorna información
 * estructurada: nombre de la tool y, en el caso especial de la Bash tool,
 * el comando + `run_in_background` flag (que el agente puede setear para
 * lanzar procesos en background).
 *
 * Usado por la detección de stuck/watch-mode: el `lastToolCall` del agente
 * da forensics si los tokens se congelan ("el agente lleva 90s sin actividad,
 * último tool fue Bash: vitest" → claro).
 *
 * Retorna `null` si la línea no es un assistant con tool_use, o si el shape
 * es inesperado. Tolerante a campos faltantes — esto es defensivo.
 */
export function parseToolUse(line: string): {
  toolName: string;
  inputPreview: string;
  bashCommand: string | null;
  runInBackground: boolean;
} | null {
  if (!line.trim()) return null;
  let evt: unknown;
  try {
    evt = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof evt !== 'object' || evt === null) return null;
  const e = evt as Record<string, unknown>;
  if (e.type !== 'assistant') return null;
  const msg = e.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object') return null;
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  // Tomamos el PRIMER tool_use del array (un mensaje puede tener varios; el
  // primero suele ser el comando "activo" para la heurística).
  for (const block of content) {
    if (
      typeof block !== 'object' ||
      block === null ||
      (block as Record<string, unknown>).type !== 'tool_use'
    ) {
      continue;
    }
    const b = block as Record<string, unknown>;
    const toolName = typeof b.name === 'string' ? b.name : '?';
    const input = (b.input ?? {}) as Record<string, unknown>;
    let inputPreview: string;
    try {
      inputPreview = JSON.stringify(input).slice(0, 200);
    } catch {
      inputPreview = '[unserializable]';
    }
    // Caso especial Bash: campos `command` + `run_in_background` definidos en
    // la API del Claude Agent SDK. Si la tool no es Bash, no aplica.
    const bashCommand =
      toolName === 'Bash' && typeof input.command === 'string'
        ? input.command
        : null;
    const runInBackground =
      toolName === 'Bash' && input.run_in_background === true;
    return { toolName, inputPreview, bashCommand, runInBackground };
  }
  return null;
}

function parseAssistantUsage(line: string): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
} | null {
  if (!line.trim()) return null;
  let evt: unknown;
  try {
    evt = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof evt !== 'object' || evt === null) return null;
  const e = evt as Record<string, unknown>;
  if (e.type !== 'assistant') return null;
  const msg = e.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object') return null;
  const usage = msg.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return null;
  return {
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    cacheCreationInputTokens:
      typeof usage.cache_creation_input_tokens === 'number'
        ? usage.cache_creation_input_tokens
        : 0,
    cacheReadInputTokens:
      typeof usage.cache_read_input_tokens === 'number'
        ? usage.cache_read_input_tokens
        : 0,
  };
}

export function formatStreamEvent(line: string): string | null {
  if (!line.trim()) return null;
  let evt: unknown;
  try {
    evt = JSON.parse(line);
  } catch {
    // No parsea — el CLI puede haber escrito un error humano antes del primer
    // JSON event. No queremos perderlo, así que lo dejamos visible.
    return line + '\n';
  }
  if (typeof evt !== 'object' || evt === null) return null;
  const e = evt as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type : '';

  // Token-by-token streaming del LLM (delta sin newline — concatena visualmente)
  if (type === 'stream_event') {
    const event = e.event as Record<string, unknown> | undefined;
    if (event?.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return delta.text;
      }
    }
    return null;
  }

  // Mensaje completo del assistant (texto generado o tool_use)
  if (type === 'assistant') {
    const message = e.message as Record<string, unknown> | undefined;
    const content = (message?.content ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(content) || content.length === 0) return null;
    const parts: string[] = [];
    for (const c of content) {
      if (c.type === 'text' && typeof c.text === 'string') {
        // Solo emitimos si NO viene de stream_event delta (evita doble escritura).
        // Cuando --include-partial-messages está activo, los deltas ya
        // mostraron el texto completo. El evento `assistant` final puede
        // re-enviar el texto entero — lo skippeamos para no duplicar.
        // Heurística: si el texto es corto (<10 chars) o es la única forma
        // de verlo (sin partials previas), lo emitimos. Sino skip.
        // Pragmático: lo emitimos siempre con un newline al final para
        // separar visualmente del próximo bloque.
        parts.push('\n');
      } else if (c.type === 'tool_use') {
        const name = typeof c.name === 'string' ? c.name : '?';
        // Sin inicializador inútil: el try y el catch lo asignan ambos antes
        // de cualquier lectura (ESLint no-useless-assignment).
        let inputStr: string;
        try {
          inputStr = JSON.stringify(c.input ?? {}, null, 0).slice(0, 400);
        } catch {
          inputStr = '[unserializable]';
        }
        parts.push(`\n→ [${name}] ${inputStr}\n`);
      }
    }
    return parts.length > 0 ? parts.join('') : null;
  }

  // Tool result (output de una tool ejecutada)
  if (type === 'user') {
    const message = e.message as Record<string, unknown> | undefined;
    const content = (message?.content ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(content) || content.length === 0) return null;
    const parts: string[] = [];
    for (const c of content) {
      if (c.type === 'tool_result') {
        let body = '';
        if (typeof c.content === 'string') {
          body = c.content;
        } else if (Array.isArray(c.content)) {
          // Anthropic API puede devolver content como array de blocks
          body = c.content
            .map((b) =>
              typeof b === 'object' && b !== null && 'text' in b
                ? String((b as Record<string, unknown>).text)
                : '',
            )
            .join('');
        }
        const preview = body.slice(0, 240);
        const truncated = body.length > 240 ? ` (… ${body.length - 240} more chars)` : '';
        parts.push(`← (result, ${body.length} chars)\n  ${preview}${truncated}\n`);
      }
    }
    return parts.length > 0 ? parts.join('') : null;
  }

  // Resultado final del run (summary)
  // Fix 2026-05-13: el campo correcto es `total_cost_usd`, NO `cost_usd` (que
  // no existe en SDKResultMessage según la doc oficial del Claude Agent SDK).
  // El bug previo hacía que el "[Done] ..." nunca mostrara cost al usuario,
  // y por carambola dejó claro que el generator cost JAMÁS se estaba
  // capturando para persistencia.
  if (type === 'result') {
    const cost = typeof e.total_cost_usd === 'number' ? `cost=$${e.total_cost_usd.toFixed(4)}` : '';
    const dur = typeof e.duration_ms === 'number' ? `duration=${(e.duration_ms / 1000).toFixed(1)}s` : '';
    const turns = typeof e.num_turns === 'number' ? `turns=${e.num_turns}` : '';
    const summary = [cost, dur, turns].filter(Boolean).join(' ');
    return `\n\n[Done] ${summary}\n`;
  }

  // System events (init, tool init) — ruido, suprimimos
  if (type === 'system') {
    return null;
  }

  // Tipos desconocidos: ignoramos para mantener el log limpio
  return null;
}

/**
 * Append a string al buffer aplicando REDACCIÓN antes de almacenar
 * (security-reviewer F-02). Mantiene solo las últimas N líneas que
 * quepan en MAX_OUTPUT_BYTES — evita memoria infinita en runs largos.
 */
function appendToBuffer(buffer: string[], chunk: string): void {
  // Invariante (post-BUG-01 fix): el caller PRE-REDACTA. Esta función solo
  // gestiona el ring buffer (trim a últimas N bytes para evitar OOM en runs
  // largos). NO redactamos acá — eso sería doble redacción idempotente pero
  // confunde el contrato. Si quien llama olvida pre-redactar, llegará texto
  // crudo al buffer (seguro porque el caller único — appendFormattedToLog —
  // está auditado en runner.ts:601).
  buffer.push(chunk);
  // Trim si crece demasiado: une todo, corta a últimas N bytes, vuelve a array.
  const total = buffer.join('').length;
  if (total > MAX_OUTPUT_BYTES * 2) {
    const joined = buffer.join('').slice(-MAX_OUTPUT_BYTES);
    buffer.length = 0;
    buffer.push(joined);
  }
}
