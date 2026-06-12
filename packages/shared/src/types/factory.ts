// === ENUMS ===

export enum PipelineLayer {
  Requirements = 'requirements',
  Linear = 'linear',
  Forge = 'forge',
  Staging = 'staging',
  ReleaseBoard = 'release-board',
  QAGate = 'qa-gate',
}

export enum AgentStatus {
  Idle = 'idle',
  Coding = 'coding',
  Testing = 'testing',
  CreatingPR = 'creating-pr',
  InReview = 'in-review',
  Rejected = 'rejected',
  Done = 'done',
  Error = 'error',
}

export enum TestCategory {
  Unit = 'unit',
  Integration = 'integration',
  E2E = 'e2e',
  Performance = 'performance',
}

export enum TestResult {
  Pending = 'pending',
  Running = 'running',
  Passed = 'passed',
  Failed = 'failed',
  Skipped = 'skipped',
}

export enum GateDecision {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Deferred = 'deferred',
}

export enum WaveStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

// === CORE TYPES ===

// Recortado a los campos con lectores reales (2026-06-11, ciclo 3 de
// limpieza): status/activeLayers/totalCost/uptime no tenían ningún
// consumidor en web ni api — eran inicialización vacía permanente.
export interface FactoryState {
  currentBatch: SprintBatch | null;
  activeBatches: SprintBatch[];
  queuedBatches: QueuedBatch[];
  resourcePool: ResourcePool;
  totalTokens: number;
}

export interface TrackerReference {
  provider: 'jira' | 'linear';
  externalId: string;
  externalKey: string;
  externalUrl: string;
}

export interface QueuedStory {
  key: string;
  title: string;
  pod: string | null;
  productOwner: string | null;
  storyPoints: number;
}

export interface QueuedBatch {
  id: string;
  /**
   * Epic ID interno — usado para navegación al detail page (`/proyectos/epicas/:id`)
   * cuando el batch viene de la cola interna del Forge (no del legacy mock con
   * tracker Linear). Opcional para retrocompat con mocks antiguos que solo
   * tenían `tracker.externalKey`.
   */
  epicId?: string;
  epicTitle: string;
  /**
   * Tracker externo (Linear/Jira). Opcional — desde el Forge interno (Mes 0
   * del roadmap) muchas épicas se envían a la cola sin estar publicadas en
   * un tracker externo. UI debe usar fallback (epicId/getShortId) cuando es null.
   */
  tracker?: TrackerReference | null;
  stories: number;
  storyDetails?: QueuedStory[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  queuedAt: string;
  estimatedStartAt: string | null;
  // ═════════════════════════════════════════════════════════════════════
  // Runtime data — populado por el backend cuando hay actividad del Forge.
  // El frontend usa estos campos para promover el QueuedBatch a la columna
  // "Forge" del kanban con el card formato `BatchCard` (con progress bar,
  // agents, duration) en lugar del simple `KanbanQueueCard`.
  // Todos opcionales para retrocompat con mocks legacy.
  // ═════════════════════════════════════════════════════════════════════
  /** Stories completadas (status='done'). */
  storiesDone?: number;
  /** Stories esperando merge humano del PR (status='in_review'). El Forge
   *  ya terminó su parte (claude generó, verifier validó, PR abierto) — el
   *  trabajo pendiente es del operador. El frontend cuenta estas como parte
   *  del progreso del epic en la columna FORGE (no las regresa a IN QUEUE
   *  cuando los slots se liberan), igual que `storiesDone` (2026-05-13). */
  storiesInReview?: number;
  /** Stories actualmente reclamadas/corriendo en algún worker. */
  storiesInProgress?: number;
  /** Number de AgentRuns activos en esta epic (= storiesInProgress). */
  agentCount?: number;
  /** ISO timestamp del primer run activo — anchor para el duration calc. */
  runStartedAt?: string | null;
  /** Branch de integración del Forge — link directo al GitHub para el operador. */
  forgeBranch?: string | null;
  /** True cuando todas las stories están done (storiesDone === stories) pero
   *  la épica sigue en queue. La épica completó el trabajo de agentes y está
   *  esperando approval humano antes de pasar a Staged. El frontend usa este
   *  campo en `FactoryOverview` para mantener la épica en la columna FORGE
   *  del Pipeline Board (no regresarla a IN QUEUE cuando los slots se liberan
   *  porque ya no hay agentes activos). Cuando se modele el HumanGate real
   *  en DB, este campo se derivará del gate.decision en vez de storiesDone —
   *  semántica del consumer estable. */
  awaitingHumanGate?: boolean;
  /** ISO timestamp del momento en que la última story de la épica terminó.
   *  NULL mientras hay stories sin terminar. Permite que el card congele
   *  el reloj cuando la épica completa. */
  completedAt?: string | null;
  /** Cost USD agregado del epic — generator + verifier across todos los runs.
   *  Mostrado en el card del Pipeline (KanbanBatchCard) sin tener que abrir
   *  el batch detail. */
  totalCostUsd?: number;
  /** Tokens "nuevos" agregados (input + output + cache_creation). NO incluye
   *  cache_reads. Mostrado en el card del Pipeline. */
  totalTokensNew?: number;
  /** Tokens cached agregados (cache_read), separados para transparencia. */
  totalTokensCached?: number;
  /** ISO timestamp del approval del Tech Lead del staging gate. Cuando está
   *  set, el `FactoryOverview` mueve el batch de la columna FORGE a STAGED
   *  del Pipeline Board y deriva `currentLayer = Staging` en el synthetic
   *  batch. NULL mientras el batch esté pre-approval (Forge work-in-progress
   *  o awaiting humano). */
  stagingApprovedAt?: string | null;
}

export interface ResourcePool {
  nodes: ComputeNode[];
  totalSlots: number;
  usedSlots: number;
}

export interface ComputeNode {
  id: string;
  name: string;
  type: 'local' | 'mac-mini' | 'cloud-vm' | 'gpu-instance' | 'other';
  os: string;              // "macOS 15.3 (Apple M3 Pro)", "Ubuntu 24.04 (x86_64)"
  location: string;        // "Local", "CDMX Office", "AWS us-east-1"
  ip: string;              // "100.64.0.1" (tailscale) or "192.168.1.10"
  status: 'online' | 'offline' | 'degraded';
  totalSlots: number;
  agents: { agentId: string; batchId: string; batchName: string }[];
  addedAt: string;
  lastHeartbeat: string;
}

/** @deprecated Use ComputeNode instead */
export type MacMini = ComputeNode;

export interface SprintBatch {
  id: string;
  name: string;
  epicTitle: string;
  epicId?: string;
  tracker: TrackerReference;
  stories: FactoryStory[];
  waves: Wave[];
  branch: string;
  /**
   * URL clickeable a la integration branch del Forge en GitHub. Construido
   * por el frontend como `${repoUrl}/tree/${forgeBranch}` SOLO cuando ambos
   * vienen del backend (repo writable configurado + branch persistida en
   * remote). Null cuando falta cualquiera — el frontend renderea el nombre
   * de la branch como texto sin link para evitar apuntar a 404 de GitHub.
   * Opcional por backwards compat con mocks y clients legacy.
   */
  branchUrl?: string | null;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  currentLayer: PipelineLayer;
  agentCount: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  startedAt: string;
  completedAt: string | null;
  totalCost: number;
  totalTokens: number;
  /**
   * Split de tokens: "new" = procesados por primera vez (input + output +
   * cache_creation, billable a precio completo). "cached" = re-lecturas
   * del cache ($0.10/1M, 10x más barato).
   *
   * El frontend muestra ambos en el card "Cost" para evitar el efecto
   * engañoso "1.5M tokens" cuando 90% son re-lecturas del cache (que
   * inflan el total sin reflejar el cost real). Opcionales por backwards
   * compat con clientes legacy.
   */
  totalTokensNew?: number;
  totalTokensCached?: number;
}

export interface Wave {
  id: string;
  number: number;
  status: WaveStatus;
  storyIds: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface FactoryStory {
  id: string;
  tracker: TrackerReference;
  title: string;
  description: string;
  waveNumber: number;
  dependsOn: string[]; // story IDs
  agentId: string | null;
  prNumber: number | null;
  status: AgentStatus;
  storyPoints: number;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  tokens: number;
  cost: number;
}

export interface FactoryAgent {
  id: string;
  name: string;
  storyId: string | null;
  storyKey: string | null;
  status: AgentStatus;
  worktree: string;
  tmuxSession: string;
  startedAt: string | null;
  duration: number; // seconds
  tokens: number;
  cost: number;
  lastOutput: string[]; // last 5 lines
  currentFile: string | null;
  linesWritten: number;
  testsRun: number;
  testsPassed: number;
  /** Archivos únicos modificados en el diff del commit del run. NULL si no
   *  hay push (sandbox mode o run en progreso). El AgentCard lo muestra como
   *  "X files" para indicar el alcance del cambio del agente. */
  filesModified?: number | null;
}

export interface TestSuite {
  id: string;
  category: TestCategory;
  storyId: string | null; // null for batch-level tests
  name: string;
  result: TestResult;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number; // ms
  coverage: number | null; // percentage
  startedAt: string | null;
  completedAt: string | null;
}

export interface HumanGate {
  id: string;
  type: 'staging' | 'release';
  batchId: string;
  decision: GateDecision;
  reviewer: string | null;
  notes: string | null;
  qaReport: QAReport | null;
  requestedAt: string;
  decidedAt: string | null;
}

export interface QAReport {
  id: string;
  batchId: string;
  recommendation: 'rollout' | 'rollback';
  confidence: number; // 0-100
  e2eResults: TestSuite;
  integrationResults: TestSuite;
  performanceResults: TestSuite;
  logAnalysis: LogAnalysis;
  generatedAt: string;
}

export interface LogAnalysis {
  httpErrors: number;
  latencySpikes: number;
  memoryLeaks: number;
  unexpectedErrors: number;
  anomalyScore: number; // 0-100, lower is better
  summary: string;
}

// === RELEASE BOARD ===

export enum ReleaseTriggerMode {
  Manual = 'manual',
  Scheduled = 'scheduled',
  Threshold = 'threshold',
}

export interface ReleaseBoardEpic {
  id: string;
  title: string;
  tracker: TrackerReference;
  storiesCompleted: number;
  storiesTotal: number;
  batchId: string;
  batchName: string;
  approvedAt: string; // when staging approved
  totalAdditions: number;
  totalDeletions: number;
  testPassRate: number;
  cost: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface ReleaseBoardState {
  epics: ReleaseBoardEpic[];
  triggerMode: ReleaseTriggerMode;
  scheduledAt: string | null; // e.g., "Friday 18:00"
  thresholdCount: number | null; // e.g., trigger at 5 epics
  lastReleasedAt: string | null;
  nextScheduledRelease: string | null;
}

// === TERMINAL / PTY TYPES ===

/** Configuration to spawn a Claude Code PTY session for an agent */
export interface PtySessionConfig {
  agentId: string;
  /** Initial prompt to send after spawning (optional — user can type directly) */
  initialPrompt?: string;
  /** Working directory for the Claude Code process (repo root — used to derive worktree) */
  workdir: string;
  /** Git branch name. When provided, the backend creates an isolated worktree for this agent. */
  branch?: string;
  /** Terminal dimensions */
  cols?: number;
  rows?: number;
}

// === FLEET / AGENT RUN TYPES ===

/**
 * Estados del ciclo de vida de un AgentRun. Espejea Prisma enum
 * `AgentRunStatus` (ver `apps/api/prisma/schema.prisma`).
 *
 * Transiciones legales:
 *   claimed → running → (completed | failed)
 *   claimed | running → abandoned (sweeper, sin progress por 10min)
 */
export type AgentRunStatus =
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'abandoned';

export const AGENT_RUN_TERMINAL_STATUSES: ReadonlyArray<AgentRunStatus> = [
  'completed',
  'failed',
  'abandoned',
];

export const AGENT_RUN_ACTIVE_STATUSES: ReadonlyArray<AgentRunStatus> = [
  'claimed',
  'running',
];

/**
 * Payload que el backend devuelve al worker en el response de un
 * `claim-story` exitoso. Compartido entre `apps/api` (servidor que lo
 * construye) y `apps/worker` (cliente que lo consume) para mantener
 * single source of truth.
 *
 * Sprint 3 (architecture-reviewer F-05 2026-05-06): movido aquí desde
 * `apps/api/src/modules/factory/fleet/agent-run.service.ts` y
 * `apps/worker/src/lib/runner.ts`.
 */
/**
 * Evento de criterio/milestone en la timeline de un AgentRun.
 *
 * El AgentRun tiene un array de estos en `criteriaProgress`. Los `source`
 * distinguen quién reportó:
 *  - `worker`: milestones técnicos automáticos (clone, commit, push, PR)
 *    detectados por observación. Confiables porque NO dependen del agente.
 *  - `agent`: criterios custom de la story que el agente reporta vía
 *    `/workspace/.cenzontle-criteria.json` mientras corre. El worker
 *    lee ese JSON en cada progress y mergea.
 *
 * Status `failed` se usa para criterios que NO pudieron cumplirse
 * (ej. push falló, lint rompió). El UI los muestra en rojo.
 */
export interface CriterionEvent {
  /** ID estable del criterio (ej. 'repo_cloned', 'tests_passed', o un slug
   *  custom derivado del label de la story). */
  id: string;
  /** Texto humano para mostrar en el drawer ("Repositorio clonado", etc). */
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /**
   *  - 'worker': milestone técnico hardcoded del runner (workdir, clone, spawn, etc.).
   *    Útil para diagnosis del flow del worker — visible en UI como pill secundaria.
   *  - 'story': acceptance criterion concreto extraído del vault (sección
   *    "## Criterios de aceptación" del storyMarkdown). Marcado individualmente
   *    por el verifier Sonnet Layer 3 — visible en UI como pill PRIMARIA.
   *  - 'agent': legacy self-report del generator (DEPRECATED 2026-05-13 por
   *    sycophancy; el verifier independiente reemplazó esta semántica).
   */
  source: 'worker' | 'agent' | 'story';
  /** Cuando entró a in_progress (ISO 8601). */
  startedAt?: string;
  /** Cuando entró a completed/failed (ISO 8601). */
  completedAt?: string;
}

/**
 * Un secreto externo (API key de terceros: Stripe, Twilio, Amadeus, …)
 * desencriptado para inyección runtime en el worker del Forge. Se forwardea
 * en cada `ClaimedStory` desde el almacén `ExternalSecret`, que vive
 * encriptado at-rest con AES-256-GCM.
 *
 * Contrato de seguridad:
 *  - `value` es PLAINTEXT. Nunca se persiste en disco salvo el `.env`
 *    efímero del workdir (modo 0600, gitignoreado vía `.git/info/exclude`,
 *    borrado antes del `git add -A`). Fuera de eso vive solo en RAM
 *    durante el run.
 *  - Nunca se loguea: el worker y el backend loguean `name`/`vendor`,
 *    jamás `value`.
 *  - El output del agente se redacta por el valor literal exacto antes de
 *    enviarse al backend (ver `makeRedactor` en `apps/worker/src/lib/secrets.ts`)
 *    — los secretos de terceros tienen formato arbitrario y no matchean
 *    los patrones por prefijo del worker.
 */
export interface ExternalSecretForWorker {
  /** Identificador estilo env var, ej `STRIPE_API_KEY`. Único en la org.
   *  El worker lo usa como nombre de la env var y como key en el `.env`. */
  name: string;
  /** Valor plaintext desencriptado. Ver el contrato de seguridad arriba. */
  value: string;
  /** Vendor (Stripe, Twilio, …) — solo para logs/diagnóstico, nunca
   *  afecta la inyección. Null si el secret no registró vendor. */
  vendor: string | null;
}

export interface ClaimedStory {
  /** UUID del AgentRun creado en el INSERT del claim. Identifica al run
   *  para llamadas subsiguientes de progress/complete. */
  runId: string;
  /** UUID de la historia reclamada. */
  storyId: string;
  /** Título humano de la historia (para logs y UX en el worker). */
  storyTitle: string;
  /** Markdown completo de la story (sección Producto del vault) — incluye
   *  Antecedentes, Objetivo, Historia de usuario, Criterios de aceptación,
   *  etc. Null si la story no tiene vaultPath o el read falló. El verifier
   *  Layer 3 lo usa para evaluar `acceptance-criteria` contra los criterios
   *  reales de la historia en vez de evaluar en abstracto (2026-05-12). */
  storyMarkdown: string | null;
  /** UUID de la épica padre (para correlación en dashboard / logs). */
  epicId: string;
  /** Branch git que el worker debe crear: `forge/epic-<short>/story-<short>`. */
  branch: string;
  /** Prompt completo a pasar a `claude -p` (markdown del epic + título de la historia). */
  prompt: string;
  /** Clone URL del repositorio con token embebido (`https://x-access-token:TOKEN@github.com/...`).
   *  Null = sandbox mode legacy (sin clone, sin push). Cuando está set, el
   *  worker debe clonar al workdir, hacer checkout a `branch` partiendo de
   *  `baseBranch`, y al final pushear + reportar `prBranchPushed=true`. */
  repoUrl: string | null;
  /** Branch base contra la cual se va a abrir el PR de la story (típicamente
   *  la integration branch del epic: `forge/sprint-batch-<epicId>`). El worker
   *  hace `git checkout -b <branch> origin/<baseBranch>` para que el push
   *  contenga solo los commits específicos de esta story.
   *  Null cuando `repoUrl` también es null (sandbox mode). */
  baseBranch: string | null;
  /** ANTHROPIC_API_KEY plaintext, forwarded desde OrgAnthropicConfig
   *  encriptada. El worker lo pasa al spawn de claude como env var.
   *  NUNCA se persiste en disco — solo en RAM durante el run. */
  anthropicApiKey: string;
  /** Todos los `ExternalSecret` registrados en la org, desencriptados.
   *  El worker los inyecta como env vars (para SDKs `process.env`-based:
   *  Stripe/Twilio/AWS) y como un `.env` efímero en el workdir (para
   *  frameworks file-based: Next.js/Vite), tanto en el spawn de `claude`
   *  como en los comandos del DoD verifier. Array vacío si la org no tiene
   *  secrets registrados.
   *
   *  OPCIONAL en el contrato a propósito: el backend siempre lo envía, pero
   *  durante un deploy parcial un worker nuevo puede recibir un claim de un
   *  backend viejo que no incluye el campo — el worker degrada a `[]` con
   *  `claimed.externalSecrets ?? []`. Ver el contrato de seguridad en
   *  `ExternalSecretForWorker`. */
  externalSecrets?: ExternalSecretForWorker[];
  /** Modelo del coder agent (CLI claude `--model`). Configurado desde
   *  `/factory/settings → Factory`. Worker lo usa con prioridad sobre
   *  `process.env.CLAUDE_MODEL` (que queda como fallback legacy). */
  forgeWorkerModel: string;
  /** Effort del coder agent (CLI claude `--effort`). Valores: low | medium |
   *  high | xhigh | max. Para Sonnet/Opus, high+ activa extended thinking
   *  automático. Worker prioriza esto sobre `process.env.CLAUDE_EFFORT`. */
  forgeWorkerEffort: string;
  /** Max wall-clock duration (ms) que el worker espera al CLI antes de
   *  matar el proceso. Reemplaza el MAX_RUN_DURATION_MS hardcoded del worker
   *  (runner.ts:145). Configurado desde `/factory/settings → tab Factory`,
   *  default backend 1_800_000 (30 min), rango 300_000-7_200_000 (5 min-2h).
   *  OPCIONAL: un worker nuevo con claim de backend viejo lo recibe
   *  undefined y degrada al default local 30 min. */
  forgeWorkerMaxRunDurationMs?: number;
  /** Modelo del DoD Verifier (reviewer agent CLI). Configurado desde la
   *  misma tab Factory de settings. Worker lo usa con prioridad sobre
   *  `process.env.DOD_VERIFIER_MODEL`. */
  dodVerifierModel: string;
  /** Effort del DoD Verifier (CLI `--effort`). Default 'low' — checks
   *  atómicos no requieren thinking. Prioridad sobre DOD_VERIFIER_EFFORT. */
  dodVerifierEffort: string;
  /** Tope de intentos del DoD enforcement loop del worker (AgentTokenSettings
   *  → tab Factory). 1 = una sola pasada; >1 activa reintentos ante error
   *  duro o criterios sin cumplir. OPCIONAL: un worker nuevo con un claim de
   *  un backend viejo lo recibe `undefined` → degrada a 1 (una pasada). */
  dodMaxAttempts?: number;
  /** Tier 1 Harness — catálogo de criterios DoD configurado por el operador
   *  en `/factory/settings/Definition of Done`. El worker los usa para correr
   *  verificación determinística post-claude (ver `dod-verifier.ts`). Solo
   *  los `enabled` (todos hoy por construcción del modelo nuevo). Si está
   *  vacío, el worker skipea la verificación y termina como antes. */
  dodCriteria: DodCriterionForAgent[];
  /** Lista plana de criterios de aceptación específicos de la historia,
   *  extraídos del `storyMarkdown` (sección `## Criterios de aceptación`).
   *  El worker los usa para:
   *   1. Inicializar `criteriaProgress` con entries `source: 'story'` que
   *      la UI renderiza como milestones individuales (1 pill por criterio).
   *   2. Pasarlos al verifier Layer 3 para evaluación per-criterio: el
   *      verifier emite JSON `[{index, passed, reason}]` y el worker marca
   *      cada criterio individualmente según el verdict.
   *  Array vacío si la story no tiene markdown o el parser no encontró la
   *  sección — el verifier degrada a evaluación en bloque (legacy). */
  acceptanceCriteria: string[];
  /** Casos de prueba específicos de la historia extraídos del QA markdown
   *  (secciones `## Happy path` y `## Edge cases`). El worker los usa para:
   *   1. Inicializar milestones de QA en `criteriaProgress` (UI granular).
   *   2. Pasarlos al verifier Layer 3 para evaluación per-test-case: el
   *      verifier para cada caso (a) busca con grep si hay un test que lo
   *      cubre, (b) lee el test encontrado, (c) corre el test runner del
   *      repo, (d) emite verdict per-case. Mismo patrón que
   *      `acceptanceCriteria` pero para el criterio DoD `tests-passing`.
   *  Array vacío si la story no tiene sección QA o el parser no encontró
   *  ## Happy path / ## Edge cases — el verifier degrada a evaluación en
   *  bloque (legacy "¿pasa pnpm test?"). */
  qaTestCases?: QaTestCase[];
  /** Requerimientos técnicos extraídos de la sección TL del markdown
   *  (`## Checklist de implementación`, `## Contrato`, `## Validaciones`,
   *  `## Manejo de errores`). El worker los usa para evaluación per-item
   *  del criterio DoD `technical-design`:
   *   1. Pre-flight determinístico — grep en el repo por archivos,
   *      endpoints, tipos, funciones mencionados en el item.
   *   2. LLM verifier (Haiku) evalúa que el código efectivamente
   *      implementa lo descrito (no solo que las keywords aparecen).
   *  Array vacío si la story no tiene markdown técnico o el parser no
   *  encontró ninguna sección — el verifier degrada a "no aplica". */
  technicalRequirements?: TechnicalRequirement[];
  /** Manifests de componentes extraídos del bundle de diseño UX/UI de la
   *  épica (uno por diseño). El worker los usa para el Layer 1 check
   *  `design-coverage-check`: para cada componente del manifest hace grep
   *  recursivo en `${workdir}/src` y reporta los faltantes como warn (NO
   *  bloqueante, consistente con `security-scan` y `docs-updated`).
   *
   *  Stream A (`design-bundle.service` + `story-generation.service`) emite
   *  los manifests al armar el claim. OPCIONAL en el contrato porque:
   *   - durante deploys parciales, un worker nuevo puede recibir un claim
   *     de un backend viejo que aún no extrae manifests — degrada a skip.
   *   - épicas backend-only (sin UI / `designSkipped=true`) NO traen
   *     manifests — degrada a skip.
   *
   *  Array vacío y `undefined` se tratan igual por el worker. */
  componentManifests?: ComponentManifest[];
}

/**
 * Caso de prueba individual extraído del QA markdown de una story.
 * `category` distingue happy path (debe haber al menos 1) de edge cases
 * (típicamente 3-7 por story). Lo usa el verifier para reportar verdicts
 * separados y la UI para renderizar checkmarks granulares.
 */
export interface QaTestCase {
  /** 'happy' para el flujo principal del feature; 'edge' para casos límite,
   *  errores, inputs vacíos, valores boundary, etc. */
  category: 'happy' | 'edge';
  /** Descripción del caso tal como fue escrita por el agente QA en el
   *  markdown (e.g. "input vacío debe retornar 400"). Es el `label` que
   *  ve el verifier y la UI. */
  description: string;
}

/**
 * Componente individual extraído del bundle de diseño UX/UI de una épica.
 * Cada componente representa una sección o react-component que debe estar
 * implementado en el código del workdir tras el run del coder. Lo usa el
 * Layer 1 check `design-coverage-check` del worker para verificar que el
 * agente no se haya saltado ningún componente del manifest del diseño.
 *
 * El extractor canónico vive en el backend (Stream A: epics/design-bundle
 * service) y emite estos shapes como parte del bundle de cada diseño.
 * `startLine`/`endLine` son metadata del extractor — el worker NO los usa
 * para el check, solo `name` (para el grep) y `kind` (para tracing en logs).
 */
export interface DesignManifestComponent {
  /** Nombre del componente — debe ser un identificador exportable válido
   *  (PascalCase típicamente). Usado por el worker como anchor de grep
   *  para verificar que el coder lo implementó. */
  name: string;
  /** Tipo del componente: `section` (bloque dentro de un parent file) o
   *  `react-component` (componente exportado/declarado). El worker hace el
   *  mismo grep para ambos — la distinción es solo para forensics. */
  kind: 'section' | 'react-component';
  /** Línea inicial del componente en el `primaryFilePath` original. */
  startLine: number;
  /** Línea final del componente en el `primaryFilePath` original. */
  endLine: number;
  /** Path al archivo donde se extrajo el componente (relativo al vault). */
  filePath: string;
}

/**
 * Manifest de componentes asociado a un diseño UX/UI de la épica. Lo emite
 * el extractor del backend (Stream A: `design-bundle.service`) al parsear
 * el bundle del diseño. Llega al worker como parte de `ClaimedStory` para
 * que el Layer 1 check `design-coverage-check` valide que cada componente
 * está implementado en el código del workdir tras el run del coder.
 */
export interface ComponentManifest {
  /** Lista de componentes que el diseño espera del coder. Vacío si el
   *  extractor no encontró nada parseable — el worker degrada a skip. */
  components: DesignManifestComponent[];
  /** Path al archivo principal del bundle (HTML/JSX/TSX) — usado por
   *  forensics. El check NO depende de este archivo: hace grep recursivo
   *  por nombre de componente. */
  primaryFilePath: string;
  /** Timestamp ISO de cuando el extractor emitió el manifest. Solo trazado
   *  — el worker no toma decisiones basadas en este valor. */
  extractedAt: string;
}

/**
 * Requerimiento técnico individual extraído del TL markdown de una story.
 * `category` distingue entre las 4 secciones del TL markdown que el agente
 * Tech Lead escribe en story-gen. Lo usa el verifier para reportar verdicts
 * separados y la UI para renderizar checkmarks granulares per-item del TL.
 */
export interface TechnicalRequirement {
  /** Sección del TL markdown donde apareció el item:
   *   - 'checklist': bullet de `## Checklist de implementación` (tareas técnicas).
   *   - 'contract':  bullet de `## Contrato` (endpoints, types, interfaces API).
   *   - 'validation': bullet de `## Validaciones` (input/output validation rules).
   *   - 'errors': bullet de `## Manejo de errores` (códigos, retries, fallbacks). */
  category: 'checklist' | 'contract' | 'validation' | 'errors';
  /** Descripción del item tal como fue escrita por el agente TL en el
   *  markdown (e.g. "Implementar endpoint POST /api/auth/login"). Es el
   *  `label` que ve el verifier y la UI. */
  description: string;
}

/**
 * Fuente ÚNICA de verdad de los `kind` canónicos de criterios DoD.
 *
 * Por qué existe (architecture-reviewer 2026-05-28): los kinds vivían
 * duplicados como strings libres en DOS mapas paralelos sin contrato común —
 * `DEFAULT_DOD_CRITERIA` (backend `dod.service.ts`) y `VERIFIERS`
 * (worker `dod-verifier.ts`). Un rename en uno sin el otro hacía que el
 * criterio cayera silenciosamente al path "sin spec" → escalaba a un verifier
 * Layer 3 genérico (Haiku) en vez del evaluador correcto, sin error ni warning.
 *
 * Atando ambos mapas a `DodCanonicalKind`, un typo o rename ahora es un ERROR
 * de compilación, no un drift en runtime. Los criterios CUSTOM del operador
 * tienen `kind=null` (no canónico) — por eso los campos `kind` siguen siendo
 * `DodCanonicalKind | null`, no `DodCanonicalKind` a secas.
 *
 * Al agregar un kind nuevo: agregarlo acá PRIMERO; recién entonces el backend
 * y el worker pueden referenciarlo con seguridad de tipos.
 */
export const DOD_CANONICAL_KINDS = [
  'code-written',
  'acceptance-criteria',
  'technical-design',
  'tests-passing',
  'no-errors',
  'security-scan',
  'code-security',
  'design-coverage-check',
  'pr-created',
  'docs-updated',
] as const;

/** Unión de los kinds canónicos de DoD. Custom del operador = `null` (aparte). */
export type DodCanonicalKind = (typeof DOD_CANONICAL_KINDS)[number];

/**
 * Shape mínimo del criterio DoD que el worker recibe del backend para
 * verificar. Subset del modelo de DB — solo lo que el verifier o el
 * agente necesita.
 */
export interface DodCriterionForAgent {
  /** Identificador estable del criterio estándar (code-written, tests-passing,
   *  etc.) o null para criterios custom que el operador agregó. El worker
   *  usa el `kind` para mapear a un comando determinístico de verificación. */
  kind: string | null;
  /** Texto del criterio mostrado en UI y en el prompt del agente. */
  text: string;
  /** Descripción larga inyectada en el prompt del agente para darle contexto
   *  sobre qué se espera del criterio. */
  description: string;
}

/**
 * Tier 1 Harness — veredicto del verifier para un criterio individual.
 *
 * Tipo compartido entre 3 capas (architecture-reviewer 2026-05-11):
 *  - **Worker** (productor): `dod-verifier.ts` lo emite tras correr Layer 1
 *    (subprocess determinístico) o Layer 3 (verifier agent con Sonnet).
 *  - **Backend** (persistencia): viaja en los DTOs `RunProgressDto` y
 *    `RunCompleteDto` y se almacena en `agent_runs.dodVerification` como
 *    Json column.
 *  - **Frontend** (consumidor): la página `/factory/agents/:id/terminal`
 *    extrae el último attempt y pinta checkmarks por criterio en la UI.
 *
 * Antes vivía solo en `apps/worker/src/lib/dod-verifier.ts` y los demás
 * consumidores lo duplicaban con type guards inline. Centralizado aquí
 * para que un cambio del shape sea un solo punto de edición.
 */
export interface CriterionVerdict {
  /** Identificador del criterio: kind canónico (code-written, tests-passing,
   *  etc.) o id de la entry en `.cenzontle-criteria.json` para custom. */
  criterionId: string;
  /** Label legible para UI y prompts. */
  label: string;
  /** Kind canónico (code-written, tests-passing, etc.) o null para custom. */
  kind: string | null;
  /** Comando ejecutado por el verifier; null si fue trust agent o skipped. */
  command: string | null;
  /** Exit code del subprocess; null si skipped o trust. */
  exitCode: number | null;
  /** Output capturado (últimas ~2KB, redacted by caller); null si no aplica. */
  output: string | null;
  /** Veredicto final. `skipped` no es failure (significa "no aplica al
   *  environment", ej. repo sin pnpm test). */
  status: 'passed' | 'failed' | 'skipped';
  /** Razón de skip o fail, legible — usado en UI y retry prompt. */
  reason?: string;
  /** Tier 1 Harness — usage del verifier agent (Layer 3) para cost tracking.
   *  Solo presente cuando el verdict viene de un spawn de claude verifier con
   *  `--output-format json`; ausente para Layer 1 (subprocess determinístico)
   *  y skipped (no se invocó al modelo).
   *
   *  Los valores vienen del wrapper JSON que el CLI emite al cierre de la
   *  sesión — confirmar shape en docs Anthropic Agent SDK cost-tracking.
   *  IMPORTANTE: `totalCostUsd` es un estimate client-side computado contra
   *  la price table bundleada en el SDK, NO billing autoritativo. Usar para
   *  budgeting/forensics, no para decisiones financieras. */
  usage?: {
    /** Tokens enviados al modelo en este criterio. */
    inputTokens: number;
    /** Tokens generados por el modelo (incluye thinking tokens si aplica). */
    outputTokens: number;
    /** Tokens escritos a la prompt cache (5-min TTL por default, premium write). */
    cacheCreationInputTokens: number;
    /** Tokens leídos de la prompt cache existente (precio reducido). */
    cacheReadInputTokens: number;
    /** Costo estimado de esta call. Suma de input + output + cache (rates internos del SDK). */
    totalCostUsd: number;
    /** Duración total del spawn (wall clock), incluye startup del CLI. */
    durationMs: number;
    /** Duración solo del API call al backend de Anthropic (excluye startup del CLI). */
    apiDurationMs: number;
  };
}

/**
 * Tier 1 Harness — log de UN attempt del DoD enforcement loop.
 *
 * El worker hace hasta MAX_DOD_ATTEMPTS iteraciones del loop "spawn claude
 * → verify DoD → si falla, retry con prompt enriquecido". Cada attempt
 * produce un `DodVerificationEntry`. El array completo se persiste en
 * `agent_runs.dodVerification` (Json column).
 *
 * SEMÁNTICA DE LECTURA (2026-05-11): la UI hace merge across all attempts
 * con last-wins por `criterionId` para obtener el estado actual de cada
 * criterio — ver `extractMergedVerdicts` en `apps/web/.../terminal/page.tsx`.
 * NO leer "solo el último entry"; eso produce regresión visual durante
 * POST `/progress` parciales (el último attempt arranca con verdicts
 * vacíos y descartaría los del attempt anterior).
 *
 * El backend reescribe el array completo en cada POST `/progress` durante
 * la verificación parcial (UX progressive) y en `/complete` al cierre del
 * run — idempotente por sobreescritura, no necesita lógica de merge en
 * persistencia (el merge vive en el reader).
 */
export interface DodVerificationEntry {
  /** Número de attempt (1-indexed). Útil para que la UI pinte la pestaña
   *  del último attempt y para forensics si el agente entró en doom loop. */
  attempt: number;
  /** Verdicts producidos por el verifier en este attempt. Durante POST
   *  `/progress` parciales puede tener `length < dodCriteria.length`
   *  (UX progressive); en `/complete` siempre tiene todos los criterios. */
  verdicts: CriterionVerdict[];
}

// === COST ANALYTICS (GET /factory/cost) ===
//
// Agregación read-time de los usage Json de cada AgentRun por batch (épica
// encolada) y por story. Todos los números son estimates client-side del SDK
// de Anthropic, NO billing oficial — orden de magnitud para decisiones
// operativas (¿cuánto cuesta un batch?, ¿cuánto cuestan los retries?), no para
// conciliación contable. Contrato compartido api↔web (antes duplicado en el
// service del API y en lib/api/factory del web).

/**
 * Componente del run que origina el costo: el planner descompone la story,
 * el generator (coder) la implementa y el verifier corre el DoD loop.
 */
export type CostComponentKey = 'planner' | 'generator' | 'verifier';

/** Totales de un componente: costo + split de tokens new/cached. */
export interface CostComponentTotals {
  costUsd: number;
  /** Tokens "nuevos": input + output + cache_creation (billable a precio
   *  completo, sin cache_read). */
  tokensNew: number;
  /** Tokens cached (cache_read), separados para transparencia. */
  tokensCached: number;
}

/**
 * Agregado de costo de un batch (épica encolada al Forge). El backend suma
 * across TODOS los runs de las stories del batch — retries incluidos.
 */
export interface CostAnalyticsBatch {
  batchId: string;
  epicId: string;
  epicTitle: string;
  /** ISO timestamp. Los batches vienen ordenados ASC por este campo —
   *  los charts de tendencia lo consumen tal cual, sin re-ordenar. */
  enqueuedAt: string;
  /** Max completedAt across runs del batch. NULL si ningún run completó. */
  completedAt: string | null;
  storiesCount: number;
  storiesDone: number;
  /** Stories con al menos un run que reportó costo. Denominador honesto
   *  para cost/story — storiesCount incluye stories aún sin ejecutar. */
  storiesWithCost: number;
  costUsd: number;
  tokensNew: number;
  tokensCached: number;
  byComponent: Record<CostComponentKey, CostComponentTotals>;
  /** Total de AgentRuns del batch (todos, no solo el más reciente por story). */
  runsCount: number;
  /** Runs con attempts > 1 — el DoD verifier forzó al menos un retry. */
  retriedRuns: number;
}

/** Costo agregado de una story individual del Forge. */
export interface CostAnalyticsStory {
  storyId: string;
  storyTitle: string;
  batchId: string;
  epicTitle: string;
  /** StoryStatus en el wire. */
  status: string;
  /** Suma across TODOS los runs de la story (los retries cuestan dinero real). */
  costUsd: number;
  tokensNew: number;
  /** Attempts del run más reciente (orderBy startedAt desc). NULL sin runs. */
  attempts: number | null;
}

/** Totales globales del dashboard de costos. */
export interface CostAnalyticsTotals {
  costUsd: number;
  tokensNew: number;
  tokensCached: number;
  /** Batches visibles dentro de la ventana (últimos MAX_BATCHES), hayan gastado o no. */
  batchesCount: number;
  storiesWithCost: number;
  /** Run-rate mensual real: costo de los runs de los últimos 30 días. */
  last30DaysCostUsd: number;
  byComponent: Record<CostComponentKey, CostComponentTotals>;
}

/**
 * Respuesta de `GET /factory/cost` — todo lo que el dashboard /factory/cost
 * renderiza. Cero derivaciones inventadas en el frontend: lo que no viene
 * aquí, no se muestra.
 */
export interface CostAnalyticsResponse {
  /** ISO now. */
  generatedAt: string;
  totals: CostAnalyticsTotals;
  /** Orden cronológico ASC por enqueuedAt. */
  batches: CostAnalyticsBatch[];
  /** Solo stories con costUsd > 0, orden DESC por costUsd. */
  stories: CostAnalyticsStory[];
}

// === VELOCITY TRACKER (GET /factory/velocity) ===
//
// Cruza la estimación (Story.storyPoints) contra el esfuerzo real medido de
// los AgentRuns (costo USD + duración + attempts del DoD) para responder
// "¿esta historia de 5 SP efectivamente valió 5 SP?". Derivado 100% read-time
// desde Prisma (sin tablas nuevas), mismo patrón y ventana que /factory/cost.
//
// El effort score se normaliza contra la MEDIANA de la población visible
// (historias done con costo > 0 en la ventana): effortScore = 1.0 se lee
// "esfuerzo de la historia mediana". expectedEffort = storyPoints/medianSP,
// y ratio = effortScore/expectedEffort clasifica con factor 1.5 simétrico.

/** Veredicto de calibración de una historia: ¿valió sus SP estimados? */
export type VelocityClassification = 'over' | 'calibrated' | 'under' | 'no-data';

export interface VelocityStoryBreakdown {
  storyId: string;
  storyTitle: string;
  batchId: string;
  epicId: string;
  epicTitle: string;
  /** StoryStatus en el wire (backlog|...|done|blocked). */
  status: string;
  storyPoints: number;
  /** Gasto real agregado de TODOS los runs (failed/abandoned incluidos —
   *  también costaron dinero), planner + generator + verifier. */
  costUsd: number;
  /** Σ (completedAt - startedAt) de runs con ambos timestamps. */
  durationMs: number;
  /** Σ run.attempts — ciclos del DoD loop más re-lanzamientos manuales. */
  totalAttempts: number;
  runsCount: number;
  /** Índice compuesto normalizado vs medianas; null si la historia no tiene
   *  costo medible o la población no alcanza MIN_SAMPLES. */
  effortScore: number | null;
  /** effortScore / (storyPoints / medianSP). >1 costó más de lo presupuestado. */
  ratio: number | null;
  classification: VelocityClassification;
  /** ISO — prioridad: max completedAt de runs completed > ChangelogEntry
   *  status→done (cierres humanos) > story.updatedAt si está done. */
  completedAt: string | null;
}

export interface VelocityBatch {
  batchId: string;
  epicId: string;
  epicTitle: string;
  enqueuedAt: string;
  /** Max completedAt entre las historias del batch; null si nada terminó. */
  completedAt: string | null;
  storiesCount: number;
  storiesDone: number;
  /** Σ storyPoints de todas las historias del batch. */
  pointsPlanned: number;
  /** Σ storyPoints de las historias done. */
  pointsDelivered: number;
  costUsd: number;
  durationMs: number;
  totalAttempts: number;
  /** Σ effortScore de las historias con score; null si ninguna lo tiene. */
  effortTotal: number | null;
  /** effortTotal vs puntos entregados (normalizado por medianSP). */
  ratio: number | null;
}

/** Bucket semanal para el trend de velocity (semana ISO, lunes). */
export interface VelocityWeeklyPoint {
  /** ISO date (YYYY-MM-DD) del lunes de la semana. */
  weekStart: string;
  pointsDelivered: number;
  storiesDone: number;
}

/**
 * Fila de la tabla de calibración por bucket Fibonacci. Además del dashboard,
 * esta tabla se inyecta (formateada como `<calibracion_historica>`) al prompt
 * del PO agent que estima storyPoints — el loop de aprendizaje del sistema.
 */
export interface VelocityCalibrationRow {
  /** Bucket Fibonacci: 1, 2, 3, 5, 8 o 13. */
  storyPoints: number;
  /** Historias done con costo en este bucket. Mostrar SIEMPRE en la UI —
   *  con poblaciones chicas las medianas son volátiles. */
  samples: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgAttempts: number;
  avgEffortScore: number;
  /** avgEffortScore vs esfuerzo esperado del bucket (sp/medianSP).
   *  >1 = el bucket tiende a SUB-estimarse; <1 = a SOBRE-estimarse. */
  ratioVsExpected: number | null;
}

export interface VelocityTotals {
  pointsPlanned: number;
  pointsDelivered: number;
  /** SP entregados en los últimos 30 días (por completedAt de la historia). */
  last30DaysPointsDelivered: number;
  /**
   * Promedio de pointsDelivered de las últimas 4 semanas calendario. La
   * semana en curso cuenta a peso completo en el denominador aunque esté
   * parcial — KPI conservador: al inicio de semana (o de proyecto) el
   * promedio se ve más bajo de lo que cerrará, nunca inflado.
   */
  avgWeeklyVelocity4w: number;
  /** % de historias clasificadas como 'calibrated' sobre las que tienen score. */
  calibratedPct: number;
  /** Mediana de ratio de las historias con score; null sin muestras. */
  globalRatio: number | null;
  /** Historias done con costo > 0 y SP > 0 — la población de referencia. */
  sampleSize: number;
  /** Medianas poblacionales usadas para normalizar; null si sampleSize <
   *  MIN_SAMPLES (todo se reporta como no-data). */
  medians: {
    costUsd: number;
    durationMs: number;
    attempts: number;
    storyPoints: number;
  } | null;
}

export interface VelocityAnalyticsResponse {
  generatedAt: string;
  totals: VelocityTotals;
  /** ASC por weekStart. */
  weekly: VelocityWeeklyPoint[];
  /** ASC por enqueuedAt (igual que /factory/cost). */
  batches: VelocityBatch[];
  /** Flat — el drill por batch se agrupa client-side (patrón cost). */
  stories: VelocityStoryBreakdown[];
  /** Solo buckets con samples > 0. */
  calibration: VelocityCalibrationRow[];
}

