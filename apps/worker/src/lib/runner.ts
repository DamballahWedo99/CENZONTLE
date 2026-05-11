import { execFile, spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
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
  type CriterionVerdict,
} from './dod-verifier.js';

/**
 * Tier 1 Harness — máximo de attempts del DoD enforcement loop. Cada attempt
 * incluye: spawn claude → verify DoD → si falla, retry-prompt + nuevo spawn.
 * 3 es el sweet spot: cubre casos comunes (typo de import, test edge missed,
 * lint nit) sin gastar demasiado en casos donde el agente está perdido. Más
 * de 3 típicamente indica problema de spec, no problema de implementación —
 * mejor escalate a humano.
 */
const MAX_DOD_ATTEMPTS = 3;

/**
 * Lista hardcoded de milestones técnicos que el worker tracker durante el
 * run. Se inicializan en `pending` al inicio de runStory y se marcan
 * `completed` (o `failed`) a medida que el flow avanza. Forma la base
 * de `criteriaProgress` que se reporta al backend en cada progress.
 *
 * Los criterios del AGENTE (custom de la story) se mergean encima al
 * leer `/workspace/.cenzontle-criteria.json`. La UI los pinta juntos
 * como una sola timeline.
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
    maxBuffer: 10 * 1024 * 1024, // 10MB suficiente para clone output
  });
}

// Re-export para compat con callers que importaban desde aquí.
export type { ClaimedStory } from '@cenzontle/shared';

/**
 * Threshold ms — kill el proceso `claude` si excede esta duración. Sprint
 * 3 podemos hacer configurable por nodo. 30min es generoso para historias
 * arquitecturales pero corta cost runaway.
 */
const MAX_RUN_DURATION_MS = 30 * 60 * 1000;

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
 * Patrones de redacción aplicados al output ANTES de escribirlo al log
 * file (que el frontend lee via tail -f) Y antes de enviarlo al backend
 * (security-reviewer F-02 2026-05-06). Claude rutinariamente echo'ea
 * comandos como `git push https://x-access-token:<TOKEN>@github.com/...`,
 * env dumps, etc. Sin esto, los secretos del worker host terminan en
 * `agent_runs.lastOutput` (DB), en logs del API y visibles en el iframe.
 */
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  // Anthropic / OpenAI / generic sk- keys (incluye sk-proj-AB-CD- con dashes)
  [/sk-ant-[a-zA-Z0-9_-]+/g, 'sk-ant-[REDACTED]'],
  [/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-[REDACTED]'],
  [/sk_live_[a-zA-Z0-9]{20,}/g, 'sk_live_[REDACTED]'], // Stripe live secret
  [/rk_live_[a-zA-Z0-9]{20,}/g, 'rk_live_[REDACTED]'], // Stripe restricted key
  // GitHub
  [/ghp_[A-Za-z0-9]{30,}/g, 'ghp_[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]{22,}/g, 'github_pat_[REDACTED]'],
  [/gho_[A-Za-z0-9]{30,}/g, 'gho_[REDACTED]'], // OAuth tokens
  [/ghs_[A-Za-z0-9]{30,}/g, 'ghs_[REDACTED]'], // server-to-server
  // GitLab
  [/glpat-[A-Za-z0-9_-]{20,}/g, 'glpat-[REDACTED]'],
  // AWS
  [/(AKIA|ASIA)[A-Z0-9]{16}/g, '[AWS_ACCESS_KEY_REDACTED]'],
  // Slack
  [/xox[abposr]-[A-Za-z0-9-]{10,}/g, 'xox[REDACTED]'],
  // Google API
  [/AIza[0-9A-Za-z_-]{35}/g, 'AIza[REDACTED]'],
  // Credenciales en URLs (cubre x-access-token: y user:pass@ genérico)
  [/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@'],
  [/(https?|postgres|postgresql|mongodb|redis|amqp|mysql):\/\/[^:\s]+:[^@\s]+@/g, '$1://[CREDS_REDACTED]@'],
  // Worker tokens del propio fleet
  [/worker_[a-z2-7]{20,}/g, 'worker_[REDACTED]'],
  // JWT en headers Bearer (genérico)
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
];

/**
 * Resuelve el binario `claude` del PATH. Asume que el usuario lo tiene
 * instalado (`npm i -g @anthropic-ai/claude-code` o similar). Si no, falla
 * limpio con mensaje accionable.
 */
function resolveClaudeBin(): string {
  return process.env.CLAUDE_BIN ?? 'claude';
}

/**
 * Lee el archivo `.cenzontle-criteria.json` del workdir si existe. Espera
 * un array de `{ id, label, completed }` que el agente actualiza durante
 * su run. Si el archivo no existe o está mal formado, devuelve [] sin error.
 *
 * El agente sabe escribir a este archivo porque el prompt builder le pasa
 * instrucciones explícitas. Si el agente no lo hace, los criterios "agent"
 * simplemente no aparecen — los milestones técnicos del worker SÍ siempre
 * aparecen porque los emite el worker mismo.
 */
async function readAgentCriteria(workdir: string): Promise<CriterionEvent[]> {
  try {
    const path = join(workdir, '.cenzontle-criteria.json');
    const content = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is { id: string; label: string; completed?: boolean } =>
          c &&
          typeof c === 'object' &&
          typeof c.id === 'string' &&
          typeof c.label === 'string',
      )
      .map((c) => ({
        id: `agent.${c.id}`,
        label: c.label,
        status: c.completed ? ('completed' as const) : ('in_progress' as const),
        source: 'agent' as const,
        completedAt: c.completed ? new Date().toISOString() : undefined,
      }));
  } catch {
    // Archivo no existe, o JSON inválido. Silencioso — no es un error real.
    return [];
  }
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
  const { runId, storyId, storyTitle, branch, prompt, repoUrl, baseBranch, anthropicApiKey } = claimed;

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
    },
    `Starting run for story "${storyTitle}" (mode=${repoUrl ? 'git' : 'sandbox'})`,
  );

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
  // HITO 1.6 — Tracking de criterios/milestones del run
  // ════════════════════════════════════════════════════════════════════════
  //
  // Inicializa los milestones técnicos del worker en `pending`. A medida
  // que el flow avanza, cada uno pasa a `in_progress` → `completed` (o
  // `failed`). El array completo se reporta al backend en cada progress y
  // el frontend lo pinta como timeline visual.
  //
  // Los criterios del AGENTE (custom de la story) se mergean encima al
  // leer `.cenzontle-criteria.json` del workdir — el agente puede agregar
  // los suyos durante su ejecución sin necesidad de tools MCP.
  const workerCriteria: CriterionEvent[] = WORKER_MILESTONES.map((m) => ({
    id: m.id,
    label: m.label,
    status: 'pending',
    source: 'worker',
  }));

  const markCriterion = (
    id: string,
    status: 'in_progress' | 'completed' | 'failed',
  ): void => {
    const idx = workerCriteria.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const now = new Date().toISOString();
    workerCriteria[idx] = {
      ...workerCriteria[idx],
      status,
      ...(status === 'in_progress' && !workerCriteria[idx].startedAt
        ? { startedAt: now }
        : {}),
      ...(status === 'completed' || status === 'failed'
        ? { completedAt: now }
        : {}),
    };
  };

  /**
   * Construye el array completo (worker + agente) para enviar al backend.
   * Lee `.cenzontle-criteria.json` del workdir de forma silenciosa.
   */
  const buildCriteriaPayload = async (): Promise<CriterionEvent[]> => {
    const agentCriteria = await readAgentCriteria(workdir);
    return [...workerCriteria, ...agentCriteria];
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
    } catch (err) {
      // Clone falló (network, token inválido, branch no existe, etc.). NO
      // abortamos el run — caemos a sandbox mode. La story igual avanzará
      // si claude crea archivos, pero sin push/PR. Marca explícito en logs
      // para forensics.
      markCriterion('repo.cloned', 'failed');
      logger.error(
        {
          event: 'git.clone.fail',
          runId,
          error: (err as Error).message,
        },
        `Clone failed, falling back to sandbox mode`,
      );
      // Limpia y recrea workdir vacío para que claude corra fresh.
      await fs.rm(workdir, { recursive: true, force: true });
      await fs.mkdir(workdir, { recursive: true });
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
  // Modelos disponibles (precio aprox por 1M tokens output):
  //   claude-haiku-4-5-20251001 — $5  (default — most cheap, validation)
  //   claude-sonnet-4-6         — $15 (balanced for production)
  //   claude-opus-4-7           — $75 (most capable, save for hard stories)
  const claudeModel = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  logger.info(
    { event: 'run.model', runId, model: claudeModel },
    `Spawning claude with model=${claudeModel}`,
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
  // SECURITY (F-06 2026-05-06): wrapWithSandbox envuelve el spawn con
  // sandbox-exec (macOS) o firejail (Linux) para denegar lectura de
  // ~/.ssh, ~/.aws, ~/.config/gh, etc. Mitiga prompt injection vía
  // epic.markdown que intentara leer credenciales del worker host.
  // Sin sandbox disponible → throw, salvo FACTORY_WORKER_ALLOW_NO_SANDBOX=1.
  // ════════════════════════════════════════════════════════════════════
  // Tier 1 Harness — DoD enforcement loop
  // ════════════════════════════════════════════════════════════════════
  //
  // El run NO termina hasta que TODOS los criterios determinísticos del DoD
  // pasen, O hasta que excedamos MAX_DOD_ATTEMPTS, O hasta que detectemos
  // doom loop (mismos archivos modificados en 2 attempts seguidos).
  //
  // Cada attempt:
  //   1. Spawn claude con prompt (original primer attempt; retry-prompt en
  //      retries con output literal del fallo previo)
  //   2. Esperar close → exitCode
  //   3. Si exitCode != 0, killed o killByBackend → break (no es DoD failure,
  //      es agent failure — escalate sin reintentar)
  //   4. Verify DoD: corre subprocess para criterios determinísticos
  //   5. Si todos pasan → break con success
  //   6. Si falla algún criterio:
  //      - Si attempt < MAX y no es doom loop → build retry-prompt + continúa
  //      - Sino → break con failure detallado
  // Defensive: backend de versión vieja podría no enviar dodCriteria en
  // ClaimedStory (campo agregado en Tier 1). Default a [] preserva el
  // comportamiento legacy (skip verifier, run termina como antes).
  const dodCriteriaSafe = claimed.dodCriteria ?? [];
  const verificationLog: Array<{ attempt: number; verdicts: CriterionVerdict[] }> = [];
  const fileSnapshots: Array<Set<string>> = [];
  let currentPrompt = prompt;
  let dodPassed = false;
  let lastVerdicts: CriterionVerdict[] = [];
  let totalAttempts = 0;
  let dodFailureReason: string | null = null;
  // exitCode + spawnError sobreviven al final del loop para reportarse en complete.
  let exitCode = -1;
  const spawnError: { value: Error | null } = { value: null };

  for (let attempt = 1; attempt <= MAX_DOD_ATTEMPTS; attempt++) {
    totalAttempts = attempt;

    if (attempt > 1) {
      logger.info(
        { event: 'dod.retry', runId, attempt, maxAttempts: MAX_DOD_ATTEMPTS },
        `DoD retry attempt ${attempt}/${MAX_DOD_ATTEMPTS}`,
      );
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
    let child: ChildProcess;
    try {
      child = spawn(sandboxed.bin, sandboxed.args, {
        cwd: workdir,
        env: {
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
          USER: process.env.USER ?? '',
          LANG: process.env.LANG ?? 'en_US.UTF-8',
          ANTHROPIC_API_KEY: anthropicApiKey,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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

    if (attempt === 1) {
      markCriterion('claude.spawned', 'completed');
    }
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
      const redacted = redactSecrets(formatted);
      appendToBuffer(outputBuffer, formatted);
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
          criteriaProgress: await buildCriteriaPayload(),
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
        { event: 'run.timeout', runId, attempt, durationMs: MAX_RUN_DURATION_MS },
        'Killing claude after max duration',
      );
      killClaude();
    }, MAX_RUN_DURATION_MS);

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
        await refreshOutputFromFile();
        const lastOutput = outputBuffer.join('').slice(-MAX_OUTPUT_BYTES);
        const criteriaProgress = await buildCriteriaPayload();
        try {
          await client.post(`/factory/workers/runs/${runId}/progress`, {
            lastOutput,
            ttydUrl: session.ttydUrl,
            criteriaProgress,
          });
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

    // === Wait close ===
    exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => {
        resolve(code ?? -1);
      });
    });

    clearTimeout(timeoutHandle);
    clearInterval(progressTimer);
    if (sigkillFallbackHandle) clearTimeout(sigkillFallbackHandle);

    if (attempt === MAX_DOD_ATTEMPTS || dodPassed) {
      markCriterion('claude.exited', exitCode === 0 ? 'completed' : 'failed');
    }

    await refreshOutputFromFile();

    // === Si claude falló (no exit limpio), abortamos sin verificar DoD ===
    if (spawnError.value || killByBackend || killed || exitCode !== 0) {
      dodFailureReason =
        dodFailureReason ??
        (killByBackend
          ? 'Killed by backend signal'
          : killed
            ? `Killed after ${MAX_RUN_DURATION_MS}ms`
            : `claude attempt ${attempt} exited with code ${exitCode}`);
      break;
    }

    // === Sin DoD configurado → trust + break ===
    if (dodCriteriaSafe.length === 0) {
      dodPassed = true;
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
      { storyTitle, branch, anthropicApiKey },
      async (partialVerdicts) => {
        const partialLog = [
          ...verificationLog,
          { attempt, verdicts: partialVerdicts },
        ];
        try {
          await client.post(`/factory/workers/runs/${runId}/progress`, {
            dodVerification: partialLog,
          });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
            // Run terminal en el backend — silente; el complete final
            // captura el 410. Cancelar el verifier acá complicaría el flujo
            // y la verificación dura pocos segundos.
            return;
          }
          logger.warn(
            { event: 'dod.progress.partial.fail', runId, attempt, error: (err as Error).message },
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
      `DoD verification: ${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped`,
    );

    if (!hasFailedCriteria(verdicts)) {
      dodPassed = true;
      logger.info(
        { event: 'dod.pass', runId, attempt },
        `DoD verification PASSED en attempt ${attempt}`,
      );
      break;
    }

    // === Loop detection — si modificamos los mismos archivos que el attempt previo, doom loop ===
    const currentFiles = await captureModifiedFiles(workdir);
    if (fileSnapshots.length > 0) {
      const prev = fileSnapshots[fileSnapshots.length - 1];
      if (setEquals(currentFiles, prev)) {
        dodFailureReason = `Doom loop detectado en attempt ${attempt} — modificó los mismos archivos que el attempt previo. Escalando a humano.`;
        logger.error(
          { event: 'dod.doom_loop', runId, attempt, files: [...currentFiles] },
          dodFailureReason,
        );
        break;
      }
    }
    fileSnapshots.push(currentFiles);

    // === Hay budget para retry → build retry-prompt ===
    if (attempt < MAX_DOD_ATTEMPTS) {
      currentPrompt = buildRetryPrompt({
        originalPrompt: prompt,
        failedVerdicts: extractFailedCriteria(verdicts),
        attemptNumber: attempt + 1,
        maxAttempts: MAX_DOD_ATTEMPTS,
      });
      logger.info(
        { event: 'dod.retry.prompt_built', runId, nextAttempt: attempt + 1, failedCount },
        `Retry prompt construido para attempt ${attempt + 1}`,
      );
    } else {
      dodFailureReason = `DoD verification falló después de ${MAX_DOD_ATTEMPTS} attempts. Criterios fallidos: ${extractFailedCriteria(verdicts).map((v) => v.label).join(', ')}`;
    }
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
  let prNumber: number | undefined;
  let prBranchPushed = false;
  let commitSha: string | undefined;
  let errorMessage: string | undefined;

  if (spawnError.value) {
    errorMessage = `Spawn failed: ${spawnError.value.message}`;
  } else if (killByBackend) {
    errorMessage = `Killed by backend signal (run was already terminal)`;
  } else if (killed) {
    errorMessage = `Killed after ${durationMs}ms (exceeded MAX_RUN_DURATION_MS)`;
  } else if (dodPassed) {
    logger.info(
      {
        event: 'run.dod_passed',
        runId,
        attempts: totalAttempts,
        durationMs,
      },
      `DoD verification passed después de ${totalAttempts} attempt(s)`,
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
        // 1. Verificar si hay archivos modificados sin commit (claude
        //    típicamente NO hace commit por sí mismo; los archivos quedan
        //    como working tree changes). Si los hay, auto-commit.
        const status = await git(['status', '--porcelain'], workdir);
        if (status.stdout.trim().length > 0) {
          markCriterion('auto.commit', 'in_progress');
          logger.info(
            { event: 'git.autocommit.start', runId, changedLines: status.stdout.split('\n').length },
            `Auto-commit: claude dejó cambios sin commit, agregando todos`,
          );
          await git(['add', '-A'], workdir);
          await git(
            [
              'commit',
              '-m',
              `Forge: ${storyTitle}\n\nAuto-commit by CENZONTLE Forge worker (run ${runId.slice(0, 8)})`,
            ],
            workdir,
          );
          markCriterion('auto.commit', 'completed');
        }

        // 2. Verificar que hay al menos 1 commit ahead de baseBranch.
        //    Si claude no produjo nada, no hay sentido pushear (PR vacío).
        const log = await git(
          ['log', '--oneline', `origin/${baseBranch}..HEAD`],
          workdir,
        );
        const aheadCount = log.stdout.trim().split('\n').filter(Boolean).length;
        if (aheadCount === 0) {
          logger.warn(
            { event: 'git.push.skip.empty', runId, branch },
            `No hay commits ahead de ${baseBranch} — claude no produjo cambios. Skip push.`,
          );
        } else {
          // 3. Captura el SHA del HEAD para reportar al backend
          const rev = await git(['rev-parse', 'HEAD'], workdir);
          commitSha = rev.stdout.trim();

          // 4. Push de la story branch al remote. -u set upstream para que
          //    futuros pulls/pushes desde este workdir (si lo preserváramos
          //    para debug) funcionen sin args.
          markCriterion('branch.pushed', 'in_progress');
          logger.info(
            { event: 'git.push.start', runId, branch, aheadCount, commitSha: commitSha.slice(0, 7) },
            `git push origin ${branch} (${aheadCount} commits)`,
          );
          await git(['push', '-u', 'origin', branch], workdir);
          prBranchPushed = true;
          markCriterion('branch.pushed', 'completed');
          logger.info(
            { event: 'git.push.ok', runId, branch, commitSha: commitSha.slice(0, 7) },
            `Push exitoso — backend abrirá PR via Octokit`,
          );
        }
      } catch (err) {
        // Push falló (auth, conflict, network). NO abortamos el run completo;
        // claude ya terminó limpio, los cambios están en el workdir local.
        // Reportamos exitCode=0 pero prBranchPushed=false → backend marca
        // como completed sin mover a in_review. Forensics: log con detalle.
        markCriterion('branch.pushed', 'failed');
        logger.error(
          {
            event: 'git.push.fail',
            runId,
            error: (err as Error).message,
          },
          `Push failed — run completed pero sin PR. Cambios solo en workdir local (se borrará en cleanup).`,
        );
        errorMessage = `Push failed: ${(err as Error).message.slice(0, 500)}`;
      }
    } else if (repoUrl !== null) {
      // Clone falló al inicio pero teníamos repoUrl — sandbox fallback ya
      // se logueó antes. No hay nada que pushear.
      logger.warn(
        { event: 'git.push.skip.noclone', runId },
        `Clone falló previamente — skip push, run termina en sandbox mode`,
      );
    }
  } else {
    // El loop terminó sin que dodPassed=true. Puede ser:
    //  - DoD verification falló todas las attempts (dodFailureReason set)
    //  - Doom loop detectado (dodFailureReason set)
    //  - claude exit no limpio en algún attempt (exitCode != 0)
    errorMessage = dodFailureReason ?? `Run finalizó sin pasar DoD (último exitCode=${exitCode})`;
    logger.error(
      {
        event: 'run.dod_failed',
        runId,
        exitCode,
        durationMs,
        attempts: totalAttempts,
        reason: errorMessage,
        lastFailedCriteria: extractFailedCriteria(lastVerdicts).map((v) => v.label),
      },
      `Run no pasó DoD: ${errorMessage}`,
    );
  }

  // Reporta complete al backend. Si esto falla, el sweeper marcará abandoned
  // después de 10min — graceful degradation.
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
    //  - 65: DoD verification failure (claude exit limpio pero criterios no cumplen)
    //        — usamos 65 (BSD EX_DATAERR) para distinguirlo de "agent crash"
    //  - exitCode real de claude: terminó por su cuenta sin pasar/fallar DoD
    const reportedExitCode = spawnError.value
      ? 127
      : killByBackend
        ? 143
        : killed
          ? 124
          : !dodPassed && exitCode === 0
            ? 65
            : Math.max(0, exitCode);

    const finalCriteriaProgress = await buildCriteriaPayload();
    await client.post(`/factory/workers/runs/${runId}/complete`, {
      exitCode: reportedExitCode,
      prNumber,
      prBranchPushed,
      commitSha,
      errorMessage,
      lastOutput: finalOutput,
      criteriaProgress: finalCriteriaProgress,
      // Tier 1 Harness — total attempts del DoD loop + log estructurado de
      // verdicts por attempt. Backend persiste para visibility en UI.
      attempts: totalAttempts,
      dodVerification: verificationLog.length > 0 ? verificationLog : undefined,
    });
    logger.info(
      {
        event: 'run.complete',
        runId,
        rawExitCode: exitCode,
        reportedExitCode,
        durationMs,
        prNumber,
        prBranchPushed,
        commitSha: commitSha?.slice(0, 7),
        killed,
        killByBackend,
        spawnError: !!spawnError.value,
      },
      'Run reported complete to backend',
    );
  } catch (err) {
    if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
      // Backend ya en terminal — esperado si killByBackend=true. No es error.
      logger.info(
        { event: 'run.complete.already_terminal', runId, status: err.status },
        'Backend already had this run terminal — skip complete report',
      );
    } else {
      logger.error(
        { event: 'run.complete.fail', runId, error: (err as Error).message },
        'Failed to report complete — sweeper will mark abandoned',
      );
    }
  }

  // Cleanup: borra el workdir temporal. Sprint 3 podemos preservar para
  // debugging, controlado por flag.
  try {
    await fs.rm(workdir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      { event: 'workdir.cleanup.fail', runId, error: (err as Error).message },
      'Workdir cleanup failed (non-fatal)',
    );
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
        let inputStr = '';
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
  if (type === 'result') {
    const cost = typeof e.cost_usd === 'number' ? `cost=$${e.cost_usd.toFixed(4)}` : '';
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
 * Captura el set de archivos modificados (working tree) en el workdir.
 * Usado por el DoD loop para detectar doom loop: si attempt N+1 modifica
 * exactamente el mismo set de archivos que attempt N, el agente está
 * atorado en el mismo approach — abortamos.
 *
 * Implementación: parsea `git status --porcelain`. Cada línea es
 * `XY filename` o `XY oldname -> newname` (renames). Tomamos el último
 * token de cada línea para tener el filename actual.
 */
async function captureModifiedFiles(workdir: string): Promise<Set<string>> {
  try {
    const { stdout } = await git(['status', '--porcelain'], workdir);
    const files = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        return parts[parts.length - 1];
      });
    return new Set(files);
  } catch {
    return new Set();
  }
}

/**
 * Compara dos Sets por igualdad de contenido (no por referencia).
 * Usado en doom loop detection.
 */
function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/**
 * Append a string al buffer aplicando REDACCIÓN antes de almacenar
 * (security-reviewer F-02). Mantiene solo las últimas N líneas que
 * quepan en MAX_OUTPUT_BYTES — evita memoria infinita en runs largos.
 */
function appendToBuffer(buffer: string[], chunk: string): void {
  const redacted = redactSecrets(chunk);
  buffer.push(redacted);
  // Trim si crece demasiado: une todo, corta a últimas N bytes, vuelve a array.
  const total = buffer.join('').length;
  if (total > MAX_OUTPUT_BYTES * 2) {
    const joined = buffer.join('').slice(-MAX_OUTPUT_BYTES);
    buffer.length = 0;
    buffer.push(joined);
  }
}

/**
 * Aplica todos los patrones de redacción al chunk. Mejor falsa-positiva
 * (algo legítimo redactado de más) que falsa-negativa (secreto persistido).
 *
 * Exportado para tests aunque por ahora no hay test suite — Sprint 2 MVP.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
