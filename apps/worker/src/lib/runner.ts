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
  extractPassedCriteria,
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
    },
    `Starting run for story "${storyTitle}" (mode=${repoUrl ? 'git' : 'sandbox'})`,
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
          exitCode: -1,
          prNumber: null,
          prBranchPushed: false,
          commitSha: null,
          attempts: 0,
          forceCompletion: true,
          error: `Invalid claimed field: ${name} is empty or invalid (length=${typeof value === 'string' ? value.length : 0})`,
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
        exitCode: -1,
        prNumber: null,
        prBranchPushed: false,
        commitSha: null,
        attempts: 0,
        forceCompletion: true,
        error: `Empty or trivial prompt (length=${prompt?.length ?? 0}) — claim contract violation`,
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

  // Story acceptance criteria (los del seed, parseados por el backend del
  // vault). Cada criterio es UNA entry con `source: 'story'`. Inicializan
  // en `pending` y el verifier Layer 3 per-criterio los marca individualmente
  // (completed/failed) según el verdict de Sonnet. Estos son los milestones
  // que el operador ve como pill PRIMARIA "acceptance" en la UI.
  const storyCriteria: CriterionEvent[] = (claimed.acceptanceCriteria ?? []).map(
    (text, i) => ({
      id: `story.ac-${i + 1}`,
      label: text,
      status: 'pending',
      source: 'story',
    }),
  );

  // Per-test-case milestones del QA markdown. Cada caso del seed (Happy
  // path o Edge case) se renderiza como pill individual en el drawer. El
  // verifier emite UN verdict por test case (kind='tests-passing') con
  // `label` que matchea uno-a-uno con `storyCriteria.label` acá — match
  // por label en el onProgress sync abajo marca cada milestone individual.
  //
  // Sin estos rows, la UI no mostraba progreso granular de los per-case
  // verdicts: el dodVerification log los registraba pero el storyCriteria
  // (pill PRIMARIA "acceptance") quedaba sin sync (qa-reviewer WARN
  // 2026-05-15).
  for (let i = 0; i < (claimed.qaTestCases ?? []).length; i++) {
    const tc = claimed.qaTestCases![i];
    const label = tc.category === 'happy'
      ? `Happy path: ${tc.description}`
      : `Edge case: ${tc.description}`;
    storyCriteria.push({
      id: `story.tc-${i + 1}`,
      label,
      status: 'pending',
      source: 'story',
    });
  }

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
    // distintos (worker: workdir.ready/repo.cloned/...; story: story.ac-N)
    // así que no hay colisión, pero priorizamos el lookup para early-exit.
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
  // doom loop (el passedCount no aumentó entre attempts — el agente está
  // atorado en los mismos criterios fallidos).
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
  let previousPassedCount: number | null = null;
  let currentPrompt = prompt;
  let dodPassed = false;
  let lastVerdicts: CriterionVerdict[] = [];
  let totalAttempts = 0;
  let dodFailureReason: string | null = null;
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
      // Redactamos UNA SOLA VEZ acá y pasamos el resultado a ambos sinks.
      // Antes pasábamos `formatted` (sin redactar) a appendToBuffer y dependíamos
      // de que appendToBuffer redactara internamente — invariante frágil: si un
      // refactor futuro removía la redacción de appendToBuffer (que conceptualmente
      // solo debería gestionar el ring buffer), outputBuffer quedaría con secretos.
      // BUG-01 fix: caller pre-redacta, appendToBuffer asume input ya redactado.
      const redacted = redactSecrets(formatted);
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
            },
            `[generator.cost] attempt=${usage.attempt} cost=$${usage.totalCostUsd.toFixed(4)} ` +
              `tokens(in/out/cw/cr)=${usage.inputTokens}/${usage.outputTokens}/` +
              `${usage.cacheCreationInputTokens}/${usage.cacheReadInputTokens} ` +
              `turns=${usage.numTurns} duration=${(usage.durationMs / 1000).toFixed(1)}s`,
          );
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

    // === Wait close ===
    // Capturamos también `signal` (qa-validation 2026-05-11) — SIGKILL/SIGTERM
    // revelan kills externos vs. exits "naturales" del proceso. Antes solo
    // teníamos code y crashes silenciosos no daban pistas.
    const { exitCode: rawExitCode, signal: claudeSignal } = await new Promise<{
      exitCode: number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on('close', (code, sig) => {
        resolve({ exitCode: code ?? -1, signal: sig });
      });
    });
    exitCode = rawExitCode;

    clearTimeout(timeoutHandle);
    clearInterval(progressTimer);
    if (sigkillFallbackHandle) clearTimeout(sigkillFallbackHandle);

    // Marcamos `claude.exited` SIEMPRE que tengamos un exitCode definitivo:
    //  - Si dodPassed=true en el attempt actual → no habrá más spawns
    //  - Si attempt === MAX_DOD_ATTEMPTS → es el último attempt, no habrá retry
    //  - Si exitCode !== 0 → claude falló, no habrá retry (los retries son por DoD fail con exitCode=0)
    // Esto evita el bug donde el milestone queda 'pending' aunque el run
    // termine exitosamente (badge UI mostraba "10/12" en runs que pasaron OK).
    const isFinalAttempt = attempt === MAX_DOD_ATTEMPTS || dodPassed || exitCode !== 0;
    if (isFinalAttempt) {
      markCriterion('claude.exited', exitCode === 0 ? 'completed' : 'failed');
    }

    await refreshOutputFromFile();

    // === Si claude falló (no exit limpio), abortamos sin verificar DoD ===
    if (spawnError.value || killByBackend || killed || exitCode !== 0) {
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
          logFilePath,
          lastOutputTail,
        },
        `claude attempt ${attempt} terminó código=${exitCode}${claudeSignal ? ` signal=${claudeSignal}` : ''}${killed ? ' (killed by timeout)' : ''}${killByBackend ? ' (killed by backend)' : ''}`,
      );
      dodFailureReason =
        dodFailureReason ??
        (killByBackend
          ? 'Killed by backend signal'
          : killed
            ? `Killed after ${MAX_RUN_DURATION_MS}ms`
            : `claude attempt ${attempt} exited with code ${exitCode}${claudeSignal ? ` (signal=${claudeSignal})` : ''}`);
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
      {
        storyTitle,
        storyMarkdown,
        acceptanceCriteria: claimed.acceptanceCriteria ?? [],
        qaTestCases: claimed.qaTestCases ?? [],
        technicalRequirements: claimed.technicalRequirements ?? [],
        branch,
        anthropicApiKey,
        // Forward del modelo/effort del DoD verifier desde el claim del backend
        // (configurados en /factory/settings → Factory). Si no vienen (claim
        // legacy o desync de versiones), el verifier cae a env vars.
        dodVerifierModel: claimed.dodVerifierModel,
        dodVerifierEffort: claimed.dodVerifierEffort,
      },
      async (partialVerdicts) => {
        // Sync storyCriteria con verdicts emitidos. Para los tres tipos de
        // verdict per-item (acceptance-criteria, tests-passing, technical-
        // design), cada `verdict.label` coincide con un `storyCriterion.label`
        // construido arriba desde el mismo seed input — match por label →
        // marca el milestone individual en `criteriaProgress` que se reporta
        // al backend en el mismo POST de progress.
        //
        // SIN incluir tests-passing y technical-design (legacy, solo
        // acceptance-criteria), los verdicts per-item de esos kinds quedaban
        // sin sync — el dodVerification log los persistía pero la pill
        // PRIMARIA del drawer no se actualizaba progresivamente. La UX de
        // "checkmarks incrementales" no se cumplía para tests-passing ni
        // technical-design (qa-reviewer WARN 2026-05-15).
        const SYNCABLE_KINDS = new Set([
          'acceptance-criteria',
          'tests-passing',
          'technical-design',
        ]);
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
    // === Skip-regression detection (qa-reviewer HIGH 2026-05-11) ===
    //
    // El verifier emite `skipped` cuando le falta tooling (ej. no encuentra
    // `package.json` para `pnpm test`). Eso es honesto cuando el environment
    // NUNCA tuvo la tooling. Pero si en attempt N el criterio reportó
    // `failed` (el environment SÍ tenía tooling, solo falló la verificación)
    // y en attempt N+1 el MISMO criterio reporta `skipped`, eso significa
    // que el agente eliminó las precondiciones — descalificando al juez en
    // vez de pasar la prueba. Tratamos esa "regresión skipped" como `failed`
    // para que `hasFailedCriteria` y el doom loop la cuenten correctamente.
    // Sin esta protección, el agente puede marcar el run como exitoso
    // simplemente borrando `package.json`.
    //
    // SOLO aplica a criterios con `kind !== null` (verifiers determinísticos:
    // tests-passing, lint, type-check, etc.) — su `criterionId` es estable
    // entre attempts. Para `kind === null` (custom criteria) el `criterionId`
    // viene del texto del criterio en `.cenzontle-criteria.json`, que el
    // agente puede legítimamente renombrar/reorganizar entre attempts;
    // tratarlo como bypass sería false positive de cleanup legítimo
    // (qa-reviewer Q3).
    //
    // Ejecutamos ANTES del `verificationLog.push` para que (a) el log
    // persistido nunca contenga el `skipped` espurio (elimina ventana
    // de crash que dejaría DB inconsistente — qa-reviewer Q1), y (b) la
    // semántica de "el bloque muta el array local, después se pushea"
    // sea lineal sin action-at-distance (qa-reviewer Q4).
    if (verificationLog.length >= 1) {
      const previousByCriterion = new Map(
        verificationLog[verificationLog.length - 1].verdicts.map(
          (v) => [v.criterionId, v.status] as const,
        ),
      );
      const degraded: Array<{
        criterionId: string;
        kind: string | null;
        originalReason: string;
      }> = [];
      for (const v of verdicts) {
        if (
          v.kind !== null &&
          v.status === 'skipped' &&
          previousByCriterion.get(v.criterionId) === 'failed'
        ) {
          const originalReason = v.reason ?? '(sin reason)';
          degraded.push({
            criterionId: v.criterionId,
            kind: v.kind,
            originalReason,
          });
          v.status = 'failed';
          v.reason = `Skip regresión — criterio era 'failed' en attempt ${attempt - 1} y ahora reporta 'skipped'. El agente eliminó las precondiciones del verifier. Razón original del skip: "${originalReason}". Tratado como fallo para evitar bypass del DoD.`;
        }
      }
      if (degraded.length > 0) {
        logger.warn(
          {
            event: 'dod.skip_regression',
            runId,
            attempt,
            degradedCount: degraded.length,
            degraded,
          },
          `${degraded.length} criterio(s) degradado(s) de 'skipped' a 'failed' por skip regresión: ${degraded.map((d) => d.criterionId).join(', ')}`,
        );
      }
    }

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

    // === Doom loop detection — el agente está atorado si passedCount no aumenta ===
    //
    // Heurística (2026-05-11): comparamos passedCount entre attempts. Si N+1
    // no pasó más criterios que N, el agente está girando en círculos sobre
    // los mismos criterios fallidos — escalamos a humano. Reemplaza la
    // heurística anterior "mismos archivos modificados" que daba falso
    // positivo en tasks one-file (crear FORGE_TEST.md → ambos attempts
    // tocan el mismo archivo aunque progresen). El passedCount captura
    // progreso real del DoD, no churn de filenames.
    //
    // Asimetría regresión vs estancamiento (qa-validation 2026-05-11):
    //   - REGRESIÓN (delta < 0): el agente rompió criterios que antes
    //     pasaban — señal categórica de daño activo. Dispara SIN grace
    //     desde attempt 2 porque darle más retries deja que destruya
    //     más cosas. Validado empíricamente: run que mostró delta=-1 en
    //     attempt 2 también crasheó claude en attempt 3 (la "grace" no
    //     rescató, solo aplazó).
    //   - ESTANCAMIENTO (delta === 0): puede ser legítimo en criterios
    //     non-deterministic (Layer 3 que no puede confirmar). Aplicamos
    //     grace: solo dispara desde attempt 3 si sigue estancado, dando
    //     al agente 1 retry adicional para encontrar un camino distinto.
    //   - PROGRESO (delta > 0): continúa siempre, sin doom loop.
    //
    // Exempt parse failures (2026-05-16 post run 3e84db29): verdicts con
    // `verifierError: 'verdict.parse.failed'` NO son regresión real del
    // agente — son fallos del verifier mismo (batch JSON drift). Si la
    // "regresión" desaparece tras sumar de vuelta esos verdicts como
    // "indeterminados", continuamos con el retry porque el agente puede
    // estar OK y el problema es del verifier. Logueamos warning específico
    // para detectar parse_fail recurrente como bug del verifier.
    const parseFailureCount = verdicts.filter(
      (v) =>
        v.status === 'failed' &&
        typeof v.reason === 'string' &&
        v.reason.includes('verdict.parse.failed'),
    ).length;
    // "Effective passedCount" = passedCount + parseFailureCount. Trata los
    // parse failures como indeterminados (no como fails legítimos) para el
    // cálculo de la regresión.
    const effectivePassedCount = passedCount + parseFailureCount;
    const isRegression =
      previousPassedCount !== null && effectivePassedCount < previousPassedCount;
    const isStagnation =
      attempt >= 3 &&
      previousPassedCount !== null &&
      effectivePassedCount === previousPassedCount;
    // Si HABRÍA sido regresión sin el exempt, logueamos para detectar bug
    // recurrente del verifier (parse_fail > 0 repetido en runs distintos =
    // señal de que el batch JSON parser sigue drift-eando con cierto prompt).
    if (
      previousPassedCount !== null &&
      passedCount < previousPassedCount &&
      parseFailureCount > 0 &&
      !isRegression
    ) {
      logger.warn(
        {
          event: 'dod.doom_loop.exempt_parse_failures',
          runId,
          attempt,
          passedBefore: previousPassedCount,
          passedRaw: passedCount,
          parseFailureCount,
          effectivePassedCount,
          rawDelta: passedCount - previousPassedCount,
          effectiveDelta: effectivePassedCount - previousPassedCount,
        },
        `Regresión aparente (raw delta=${passedCount - previousPassedCount}) explicada por ${parseFailureCount} verdict.parse.failed — NO es regresión del agente, es bug del batch verifier. Continuando con attempt ${attempt + 1}.`,
      );
    }
    if (isRegression || isStagnation) {
      const kind: 'regression' | 'stagnation' = isRegression ? 'regression' : 'stagnation';
      const delta = effectivePassedCount - (previousPassedCount ?? 0);
      dodFailureReason = isRegression
        ? `Doom loop detectado en attempt ${attempt} — REGRESIÓN: passedCount efectivo bajó de ${previousPassedCount} a ${effectivePassedCount} (delta=${delta}, raw=${passedCount}, parse_failures=${parseFailureCount}). El agente rompió criterios que antes pasaban. Escalando a humano sin grace porque la regresión es señal de daño activo.`
        : `Doom loop detectado en attempt ${attempt} — ESTANCAMIENTO: passedCount efectivo no aumentó (${previousPassedCount} → ${effectivePassedCount}). El agente está atorado en los mismos criterios fallidos. Escalando a humano.`;
      logger.error(
        {
          event: 'dod.doom_loop',
          runId,
          attempt,
          kind,
          passedBefore: previousPassedCount,
          passedAfter: passedCount,
          effectivePassedAfter: effectivePassedCount,
          parseFailureCount,
          delta,
        },
        dodFailureReason,
      );
      break;
    }
    logger.info(
      {
        event: 'dod.attempt.progress',
        runId,
        attempt,
        passedBefore: previousPassedCount,
        passedAfter: passedCount,
        delta: previousPassedCount !== null ? passedCount - previousPassedCount : null,
      },
      `DoD attempt ${attempt}: passed ${previousPassedCount ?? 0} → ${passedCount}`,
    );
    previousPassedCount = passedCount; // baseline para el doom loop check del próximo attempt

    // === Hay budget para retry → build retry-prompt QUIRÚRGICO ===
    //
    // Surgical retry (2026-05-17): pasamos AMBOS failed Y passed verdicts +
    // storyTitle. El nuevo buildRetryPrompt construye un prompt enfocado solo
    // en lo que falló, listando lo que ya pasa como "preservar". NO reenvía
    // el `originalPrompt` completo — el agente lee el filesystem (`git log`)
    // si necesita re-contexto. Esto evita la regresión que causaba doom loop.
    if (attempt < MAX_DOD_ATTEMPTS) {
      const failedThisAttempt = extractFailedCriteria(verdicts);
      const passedThisAttempt = extractPassedCriteria(verdicts);
      currentPrompt = buildRetryPrompt({
        storyTitle,
        failedVerdicts: failedThisAttempt,
        passedVerdicts: passedThisAttempt,
        attemptNumber: attempt + 1,
        maxAttempts: MAX_DOD_ATTEMPTS,
      });
      logger.info(
        {
          event: 'dod.retry.prompt_built',
          runId,
          nextAttempt: attempt + 1,
          failedCount,
          passedCount: passedThisAttempt.length,
          surgical: true,
          promptChars: currentPrompt.length,
        },
        `Surgical retry prompt: ${passedThisAttempt.length} preserved, ${failedCount} to fix`,
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
  // atascada?" mirando un solo log line. Si dodPassed=true entramos al if;
  // si no, vamos al else con dodFailureReason.
  // ════════════════════════════════════════════════════════════════════════
  const passedCriteriaCount = lastVerdicts.filter((v) => v.status === 'passed').length;
  const failedCriteriaCount = lastVerdicts.filter((v) => v.status === 'failed').length;
  const skippedCriteriaCount = lastVerdicts.filter((v) => v.status === 'skipped').length;
  logger.info(
    {
      event: 'run.outcome.decision',
      runId,
      dodPassed,
      cloneSucceeded,
      baseBranch,
      rawExitCode: exitCode,
      totalAttempts,
      maxAttempts: MAX_DOD_ATTEMPTS,
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
    `[outcome] dodPassed=${dodPassed} passed=${passedCriteriaCount}/${lastVerdicts.length} attempts=${totalAttempts}/${MAX_DOD_ATTEMPTS} clone=${cloneSucceeded} exitCode=${exitCode}${dodFailureReason ? ` reason="${dodFailureReason.slice(0, 100)}"` : ''}`,
  );

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
        } else {
          // Claude hizo su propio commit (working tree limpio). No es bug —
          // el milestone "cambios committeados" se cumple igual, solo que
          // por el agente en vez de por el worker. Sin esto, el badge UI
          // muestra "X/12" en lugar de "X/12 done" porque auto.commit
          // queda en 'pending' aunque conceptualmente el commit existe.
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
    // documentamos. Si AMBOS son false (después de tomar en cuenta el flow
    // post-recepción del backend) → story queda atascada (caso bug).
    //
    // FIX 2026-05-13: la predicción ANTERIOR siempre dijo "STUCK" cuando
    // `prNumber=undefined && prBranchPushed=true` (caso típico del worker
    // honesto: el worker push code pero el backend abre el PR vía Octokit
    // a posteriori). Esa predicción era pesimista — no consideraba que el
    // backend va a abrir el PR. Ahora reflejamos eso con un estado
    // "PENDING_BACKEND_PR_CREATION" que NO es stuck — solo significa que
    // el outcome final depende de si Octokit/auto-merge tienen éxito.
    // ════════════════════════════════════════════════════════════════════
    const predExitedClean = reportedExitCode === 0;
    // El backend abrirá el PR si recibe prBranchPushed=true y prNumber=null.
    // Para la predicción, asumimos que esa apertura va a tener éxito.
    const predWillBackendOpenPr =
      predExitedClean && prBranchPushed && prNumber === undefined;
    const predEffectivePrNumber =
      prNumber !== undefined || predWillBackendOpenPr ? 'expected' : 'none';
    const predMovedToReview =
      predExitedClean && predEffectivePrNumber === 'expected' && !forceCompletion;
    const predMovedToDoneSandboxSandboxOnly =
      predExitedClean && !prBranchPushed && prNumber === undefined;
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
          prNumber: prNumber ?? null,
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
        ? `[complete.predict] ⚠ STORY PUEDE QUEDAR ATASCADA: exitedClean=true pero prBranchPushed=${prBranchPushed} prNumber=${prNumber ?? 'undefined'} forceCompletion=${forceCompletion}. Revisar push/PR creation upstream.`
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
      generatorUsage: generatorSummary,
      filesModified,
      filesModifiedPaths,
      ...(forceCompletion ? { forceCompletion: true } : {}),
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
        dodPassed,
        totalAttempts,
        passedCriteriaCount,
        failedCriteriaCount,
        forceCompletion,
      },
      `Run reported complete: dodPassed=${dodPassed} exitCode=${reportedExitCode} pr=${prNumber ?? 'none'} pushed=${prBranchPushed}`,
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
      logger.error(
        {
          event: 'run.complete.bad_request',
          runId,
          status: 400,
          backendErrorBody: err.body,
        },
        `Backend rejected /complete with 400 — see backendErrorBody for the specific field that failed validation. Sweeper will mark abandoned.`,
      );
    } else {
      logger.error(
        {
          event: 'run.complete.fail',
          runId,
          error: (err as Error).message,
          status: err instanceof ApiError ? err.status : null,
          backendErrorBody: err instanceof ApiError ? err.body : null,
        },
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
/**
 * Usage capturado del evento `result` final del generator (claude -p con
 * --output-format stream-json). Shape derivado de la doc oficial del Claude
 * Agent SDK (SDKResultMessage). Captura **por attempt** porque el DoD loop
 * puede re-spawnear claude hasta MAX_DOD_ATTEMPTS veces.
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
