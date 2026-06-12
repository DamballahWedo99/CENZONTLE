import type { CriterionEvent, DodVerificationEntry } from '@cenzontle/shared';
import { apiFetch } from './client';

/**
 * Type guard runtime para `criteriaProgress` (viene del backend como JSON
 * crudo). Verifica que cada elemento tenga el shape mínimo de un
 * `CriterionEvent`.
 *
 * Centralizado aquí (architecture-reviewer 2026-05-11) para eliminar 3
 * redefiniciones duplicadas en `page.tsx`, `AgentRunTerminal.tsx` y
 * `AgentRunOutputViewer.tsx`. El guard sigue siendo necesario aunque el
 * TS type sea concreto — la columna `agent_runs.criteriaProgress` es Json
 * en Prisma y `unknown[]` antes de validación shallow del DTO.
 *
 * Validación por campo:
 *  - `id`, `label`, `status`: requeridos, deben ser string.
 *  - `source`: opcional para preservar compat con rows legacy pre-Tier-1
 *    donde el campo no existía (qa+arch-reviewer 2026-05-11). Items sin
 *    source caen a default 'worker' en downstream (== 'agent' comparison
 *    retorna false).
 *  - `startedAt`/`completedAt`: opcionales, deben ser string si presentes.
 *    Sin este check, un `completedAt: 123` (número) pasaría al render que
 *    hace `new Date(c.completedAt)` y produce "hace 56 años" silencioso.
 */
export function isCriterionEventArray(v: unknown): v is CriterionEvent[] {
  if (!Array.isArray(v)) return false;
  return v.every((c) => {
    if (c === null || typeof c !== 'object') return false;
    const r = c as Record<string, unknown>;
    return (
      typeof r.id === 'string' &&
      typeof r.label === 'string' &&
      typeof r.status === 'string' &&
      (r.source === undefined || typeof r.source === 'string') &&
      (r.startedAt === undefined || typeof r.startedAt === 'string') &&
      (r.completedAt === undefined || typeof r.completedAt === 'string')
    );
  });
}

// ──────────────────────────────────────────────────────────────────────
// Compute Fleet — gestión de nodos de cómputo
// ──────────────────────────────────────────────────────────────────────

export type ComputeNodeStatus = 'online' | 'offline' | 'degraded';
export type ComputeNodeType = 'local' | 'mac_mini' | 'cloud_vm' | 'gpu_instance' | 'other';

export interface ComputeNodeResponse {
  id: string;
  name: string;
  type: ComputeNodeType;
  os: string;
  location: string;
  ip: string;
  status: ComputeNodeStatus;
  /** Status derivado en runtime considerando freshness del lastHeartbeat. */
  effectiveStatus: ComputeNodeStatus;
  totalSlots: number;
  lastHeartbeat: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
}

export interface CreateComputeNodeInput {
  name: string;
  type: ComputeNodeType;
  totalSlots: number;
}

export interface UpdateComputeNodeInput {
  name?: string;
  totalSlots?: number;
}

export interface WorkerTokenResponse {
  id: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdById: string | null;
}

export interface GeneratedTokenResponse {
  /** Plaintext devuelto UNA SOLA VEZ al crear. Mostrar al user inmediatamente. */
  plaintext: string;
  prefix: string;
  id: string;
  /**
   * URL canonical del API que el worker debe usar para `--dashboard`.
   * La fuente de verdad es el backend (env `PUBLIC_API_URL`), NO el
   * frontend `window.location.origin` que apunta al Next.js. El worker
   * llama directo al NestJS sin pasar por el BFF.
   */
  dashboardUrl: string;
}

export function getComputeNodes() {
  return apiFetch<ComputeNodeResponse[]>('/factory/nodes');
}

export function createComputeNode(input: CreateComputeNodeInput) {
  return apiFetch<ComputeNodeResponse>('/factory/nodes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateComputeNode(id: string, input: UpdateComputeNodeInput) {
  return apiFetch<ComputeNodeResponse>(`/factory/nodes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteComputeNode(id: string) {
  return apiFetch<void>(`/factory/nodes/${id}`, { method: 'DELETE' });
}

/**
 * Genera un nuevo Bearer token para el nodo. El backend retorna el plaintext
 * UNA SOLA VEZ — el caller debe mostrarlo en un modal y NO persistirlo.
 */
export function createWorkerToken(nodeId: string) {
  return apiFetch<GeneratedTokenResponse>(`/factory/nodes/${nodeId}/tokens`, {
    method: 'POST',
  });
}

export function listWorkerTokens(nodeId: string) {
  return apiFetch<WorkerTokenResponse[]>(`/factory/nodes/${nodeId}/tokens`);
}

export function revokeWorkerToken(nodeId: string, tokenId: string) {
  return apiFetch<void>(`/factory/nodes/${nodeId}/tokens/${tokenId}`, {
    method: 'DELETE',
  });
}

// ──────────────────────────────────────────────────────────────────────
// Forge Queue (existente)
// ──────────────────────────────────────────────────────────────────────

/**
 * Shape de un item de la cola del Forge devuelto por `GET /factory/queue`.
 * Coincide con `EnqueuedBatch` del backend (`factory-queue.service.ts`).
 *
 * Distinto del tipo `QueuedBatch` shared — este es el contrato HTTP raw,
 * el frontend mapea a `QueuedBatch` para renderizar en el dashboard.
 */
export interface ForgeQueueItem {
  batchId: string;
  epicId: string;
  epicTitle: string;
  storiesCount: number;
  totalStoryPoints: number;
  enqueuedAt: string;
  enqueuedBy: string;
  enqueuedByName: string;
  // Runtime data del backend para que el frontend renderice el card
  // como "active in Forge" cuando hay runs activos:
  priority: 'critical' | 'high' | 'medium' | 'low';
  storiesDone: number;
  storiesInProgress: number;
  agentCount: number;
  runStartedAt: string | null;
  forgeBranch: string | null;
  /** True cuando todas las stories están done pero la épica sigue en queue —
   *  está esperando approval humano antes de pasar a Staged. */
  awaitingHumanGate: boolean;
  /** ISO timestamp del momento en que terminó la última story (NULL mientras
   *  alguna sigue en progreso). Permite que el card congele el reloj. */
  completedAt?: string | null;
  /** Cost agregado USD del epic — generator + verifier across todos los runs. */
  totalCostUsd?: number;
  /** Tokens "nuevos" agregados (input + output + cache_creation, sin cache_read). */
  totalTokensNew?: number;
  /** Tokens cached (cache_read), separados para transparencia. */
  totalTokensCached?: number;
  /** ISO timestamp del approval del Tech Lead. Cuando está set, el frontend
   *  mueve el batch de la columna Forge a Staged del Pipeline Board sin
   *  esperar el próximo poll del detail endpoint. */
  stagingApprovedAt?: string | null;
}

/**
 * Lista las épicas actualmente "in queue" del Forge. Backend filtra por
 * pod intersection automáticamente (no-AltaGerencia ven solo sus pods).
 *
 * Orden: FIFO — las más antiguas primero (las que se procesarán antes).
 *
 * Llamado por `FactoryProvider` al montar para hidratar `state.factory.
 * queuedBatches`. No tiene polling — para refresh continuo, llamar manualmente
 * desde un timer o WebSocket cuando el orquestador real (Mes 1) emita eventos.
 */
export function getForgeQueue() {
  return apiFetch<ForgeQueueItem[]>('/factory/queue');
}

/**
 * Shape detallado de un batch — usado por la página `/factory/batch/:id`.
 * Reemplaza el shape mock previo. Coincide con `BatchDetailResponse` del
 * backend (`factory-queue.service.ts`).
 */
export interface BatchDetailResponse {
  batchId: string;
  epicId: string;
  epicTitle: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  forgeBranch: string | null;
  /** URL del repo activo en GitHub (ej. `https://github.com/owner/repo`). NULL
   *  si no hay code repository forgeWritable configurado (sandbox mode). El
   *  frontend lo combina con `forgeBranch` para construir el link clickeable
   *  a la branch del Forge. */
  repoUrl: string | null;
  /** ISO timestamp del approval del Tech Lead — derivamos `currentLayer =
   *  Staging` y `gate.decision = Approved` cuando este campo está set. */
  stagingApprovedAt?: string | null;
  /** Nombre legible del aprobador (mismo valor persistido en DB). */
  stagingApprovedByName?: string | null;
  /** Número del consolidated PR a DEV — NULL si nunca se abrió. */
  consolidatedPrNumber?: number | null;
  /** ISO timestamp del merge del consolidated PR a DEV. */
  consolidatedPrMergedAt?: string | null;
  enqueuedAt: string;
  runStartedAt: string | null;
  storiesCount: number;
  storiesDone: number;
  storiesInProgress: number;
  awaitingHumanGate: boolean;
  totalCostUsd: number;
  totalTokens: number;
  // Split: "new" (input + output + cache_creation, billable a precio
  // completo) vs "cached" (cache_read, $0.10/1M). El UI los muestra por
  // separado para evitar el efecto "1.5M tokens" engañoso de re-lecturas.
  totalTokensNew?: number;
  totalTokensCached?: number;
  stories: BatchStoryDetail[];
  waveCount: number;
}

export interface BatchStoryDetail {
  id: string;
  title: string;
  status: string;
  storyPoints: number;
  waveNumber: number;
  blockedByIds: string[];
  latestRun: BatchStoryRun | null;
}

export interface BatchStoryRun {
  id: string;
  status: string;
  branch: string;
  nodeId: string;
  prNumber: number | null;
  exitCode: number | null;
  errorMessage: string | null;
  /** Null durante la ventana entre claim e inicio del run. Antes el tipo
   *  decía `string` no-nullable pero el backend SÍ devolvía null en esa
   *  ventana — el wire-type honesto es nullable (qa-reviewer 2026-05-19). */
  startedAt: string | null;
  completedAt: string | null;
  /** Cost USD del run individual (generator + verifier). */
  costUsd?: number;
  /** Tokens "nuevos" del run (input + output + cache_creation). */
  tokensNew?: number;
  /** Archivos modificados en el diff del commit. NULL si sandbox/no-push. */
  filesModified?: number | null;
  /** Attempts del DoD loop. 1=clean, 2-3=requirió retries. NULL si nunca llegó
   *  al verifier (claimed→failed por error temprano). */
  attempts?: number | null;
  /** Si abortó por doom loop, qué tipo. NULL si no fue doom loop. */
  doomLoopKind?: 'regression' | 'stagnation' | null;
  /** Checklist completa del DoD — todos los criterios con su veredicto final
   *  (passed/failed/skipped), merge-ado across attempts. El merge view la
   *  renderiza como checklist. Vacío si el run nunca llegó al verifier. */
  criteria?: Array<{
    id: string;
    label: string;
    status: 'passed' | 'failed' | 'skipped';
    reason: string;
  }>;
}

/**
 * Detalle completo de un batch del Forge. Retorna stories + agentRuns + cost
 * + DAG real (sin mocks). 404 si el batchId no existe o el user no tiene
 * acceso al pod del epic.
 */
export function getBatchDetail(batchId: string) {
  return apiFetch<BatchDetailResponse>(`/factory/queue/${batchId}/detail`);
}

// ──────────────────────────────────────────────────────────────────────
// Staging Gate Approval — TechLead aprueba merge a DEV (step-up auth)
// ──────────────────────────────────────────────────────────────────────

export interface ApproveStagingGateInput {
  /** Password actual del usuario para step-up auth (valida vs Auth0). */
  password: string;
  /** Notas opcionales — persistidas en el ChangelogEntry. */
  notes?: string;
}

export interface ApproveStagingGateResponse {
  batchId: string;
  epicId: string;
  approvedAt: string;
  approvedBy: string;
  approvedByName: string;
  consolidatedPrNumber: number | null;
  consolidatedPrMergedAt: string | null;
}

/**
 * Aprueba el staging gate de un batch — mergea el consolidated PR a DEV y
 * mueve el batch a la columna Staged del Pipeline Board. Solo TechLead (o
 * AltaGerencia admin) puede aprobar. Step-up auth con password requerido.
 *
 * Retry semantics: el endpoint permite re-llamarse cuando el approval ya
 * persistió pero el merge a DEV no se completó (ej. branch no estaba listo
 * en remote, conflict transitorio). El primer aprobador se preserva intacto
 * y solo se reintenta la parte operacional. Solo lanza 409 cuando approval
 * Y merge ya son terminales.
 *
 * Errores tipados:
 *  - 400: batch no listo (stories pendientes)
 *  - 401: password incorrecta (re-verifica también en retries)
 *  - 403: rol no autorizado
 *  - 404: batchId no existe
 *  - 409: ya aprobado Y mergeado — no hay nada que reintentar
 *  - 502/503: GitHub merge falló o Auth0 no configurado
 */
export function approveStagingGate(
  batchId: string,
  input: ApproveStagingGateInput,
) {
  return apiFetch<ApproveStagingGateResponse>(
    `/factory/queue/${batchId}/approve-staging`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// ──────────────────────────────────────────────────────────────────────
// Retry story — reintenta una story con deuda técnica (reset → backlog)
// ──────────────────────────────────────────────────────────────────────

export interface RetryStoryResponse {
  storyId: string;
  storyTitle: string;
  /** Estado de la story ANTES del retry (blocked | in_review | failed | ...). */
  previousStatus: string;
  /** Estado nuevo — siempre 'backlog' (claimable por el worker). */
  status: string;
  /** Cuántos AgentRun activos (claimed/running) se cerraron a failed. */
  abandonedRunCount: number;
}

/**
 * Reintenta una story con deuda técnica desde el merge view. La resetea a
 * backlog + claimedAt=null: el worker la re-claim en el próximo poll y
 * re-ejecuta el flujo COMPLETO del Forge (el agente la re-implementa + corre
 * el DoD). Consume tokens reales — el caller la gatea con un ConfirmDialog.
 *
 * Errores tipados:
 *  - 403: el user no tiene acceso al pod del epic
 *  - 404: batchId no existe, o la story no pertenece a ese batch
 *  - 409: la story ya está en 'done' — no hay nada que reintentar
 */
export function retryStory(batchId: string, storyId: string) {
  return apiFetch<RetryStoryResponse>(
    `/factory/queue/${batchId}/stories/${storyId}/retry`,
    { method: 'POST' },
  );
}

// ──────────────────────────────────────────────────────────────────────
// Anthropic API key — singleton config a nivel de organización
// ──────────────────────────────────────────────────────────────────────

export interface AnthropicConfigResponse {
  /** True si la API key fue setteada al menos una vez. */
  configured: boolean;
  /** Masked display (`sk-...XXXX`) — nunca el plaintext. Null si NO configurado. */
  maskedKey: string | null;
  /** ISO timestamp del último cambio. Null si NO configurado. */
  updatedAt: string | null;
  /** Auth0 sub del último user que setteó/rotó la key. Null si NO configurado. */
  updatedBy: string | null;
}

/** Un modelo del catálogo (curado + verificación en vivo) para los selectores por agente. */
export interface AnthropicModelOption {
  id: string;
  displayName: string;
  description: string;
  contextWindow: number;
  maxOutput: number;
  pricing: { inputPerMTok: number; outputPerMTok: number };
  /** Compatible con el shape de los agentes (adaptive thinking + effort). */
  agentCompatible: boolean;
  recommended?: boolean;
  legacy?: boolean;
  /** Presente en GET /v1/models de Anthropic (solo cuando source='live'). */
  availableInApi?: boolean;
}

export interface AnthropicModelsResponse {
  /** 'live' = verificado contra la API de Anthropic con la key de la org. */
  source: 'live' | 'fallback';
  models: AnthropicModelOption[];
}

/**
 * Catálogo de modelos para los selectores por agente de Tokens IA. La elección
 * por agente se persiste vía updateAgentTokenSettings. Solo Alta Gerencia.
 */
export function getAnthropicModels() {
  return apiFetch<AnthropicModelsResponse>('/factory/anthropic-config/models');
}

/** Lee metadata pública de la API key (sin plaintext). Solo Alta Gerencia. */
export function getAnthropicConfig() {
  return apiFetch<AnthropicConfigResponse>('/factory/anthropic-config');
}

/**
 * Setea/rota la API key de Anthropic. Backend encripta con AES-256-GCM.
 * El plaintext NUNCA se persiste en cleartext ni se devuelve en GET.
 * Si pierdes el plaintext después de configurarlo, debes rotar (set nuevo).
 */
export function setAnthropicKey(plaintext: string) {
  return apiFetch<void>('/factory/anthropic-config', {
    method: 'PUT',
    body: JSON.stringify({ plaintext }),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Active runs — runs en estado claimed | running, agrupables por nodo
// ──────────────────────────────────────────────────────────────────────

export interface ActiveRunResponse {
  runId: string;
  nodeId: string;
  storyId: string;
  storyTitle: string;
  epicId: string;
  epicTitle: string;
  status: 'claimed' | 'running';
  branch: string;
  startedAt: string;
  lastProgressAt: string;
}

/**
 * Lista AgentRuns en estado claimed|running. Usado por el Resource Pool
 * drawer + página /factory/agents para mostrar qué historia está corriendo
 * en cada nodo. Polling 5s (mismo que getComputeNodes).
 */
export function getActiveRuns() {
  return apiFetch<ActiveRunResponse[]>('/factory/nodes/active-runs');
}

/**
 * Detalle de un AgentRun específico — incluye `lastOutput` con lo que
 * ha escrito claude. Usado por la página `/factory/agents/:runId/terminal`
 * con polling para mostrar progreso semi-live.
 *
 * El `lastOutput` se actualiza solo cada 30s (intervalo del worker
 * progress endpoint), pero el polling del frontend a 5s da feedback
 * razonable. NO es streaming real — para Sprint 5+ podemos añadir SSE.
 */
export interface RunDetailResponse {
  runId: string;
  status: 'claimed' | 'running' | 'completed' | 'failed' | 'abandoned';
  branch: string;
  lastOutput: string;
  lastProgressAt: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  errorMessage: string | null;
  prNumber: number | null;
  /** HITO 1.5: URL del ttyd vivo del worker mientras claude corre. Null
   *  cuando el run termina o no arrancó ttyd. Cuando está set, el viewer
   *  debe renderear iframe en lugar del polling estático. */
  ttydUrl: string | null;
  /** HITO 1.6: timeline de criterios/milestones del run. Array de
   *  CriterionEvent (worker milestones + agente custom). Aunque el backend
   *  lo persiste como Json en Prisma, el shape es estable — los consumidores
   *  deben pasar por `isCriterionEventArray` antes de iterarlo. */
  criteriaProgress: CriterionEvent[] | null;
  /** Tier 1 Harness: total de attempts del DoD enforcement loop.
   *  1 = primer intento limpio. 2-3 = el agente necesitó retries tras fallar
   *  verificación determinística. */
  attempts: number;
  /** Tier 1 Harness: log estructurado del veredicto por criterio en cada
   *  attempt. Array de DodVerificationEntry. Null antes del primer verifier
   *  run. La UI hace merge across all attempts con last-wins por criterionId
   *  (ver `extractMergedVerdicts` en terminal/page.tsx) — NO leer solo el
   *  último entry (produce regresión durante POST /progress parciales). */
  dodVerification: DodVerificationEntry[] | null;
  storyId: string;
  storyTitle: string;
  epicId: string;
  epicTitle: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Duración del run en ms. Null mientras no haya completado. */
  durationMs: number | null;
  /** Cost agregado USD — generator + verifier + planner del run. */
  costUsd: number;
  /** Tokens "nuevos" del run: input + output + cache_creation (sin cache_read). */
  tokensNew: number;
  /** Archivos modificados por el run. Null si el worker no lo reportó. */
  filesModified: number | null;
  /** Story points de la historia que el run procesa. */
  storyPoints: number;
  /** Tracker key (externalKey) de la story. Null si no tiene tracker. */
  storyTrackerKey: string | null;
  /** Tracker key (externalKey) del epic. Null si no tiene tracker. */
  epicTrackerKey: string | null;
  /** Historias de las que ésta depende — `{ key, title }` de cada bloqueadora. */
  dependsOn: { key: string | null; title: string }[];
}

export function getRunDetail(runId: string) {
  return apiFetch<RunDetailResponse>(`/factory/nodes/runs/${runId}`);
}

/**
 * Subconjunto de `RunDetailResponse` que el `AgentDetailDrawer` necesita
 * para renderizar Identity / Context / Performance en run mode. Derivado
 * DRY de `RunDetailResponse` — un Pick + el conteo del DoD evaluado en el
 * frontend (`dodPassed`/`dodTotal` no vienen del backend, los computa
 * `terminal/page.tsx` desde el catálogo de criterios + los verdicts).
 *
 * Vive aquí (no en `AgentDetailDrawer.tsx`) para que `AgentTerminal.tsx`
 * pueda tiparlo sin importar un tipo desde un componente hijo
 * (architecture-reviewer 2026-05-20 — dirección de dependencia invertida).
 */
export type RunDrawerDetail = Pick<
  RunDetailResponse,
  | 'branch'
  | 'epicId'
  | 'epicTitle'
  | 'epicTrackerKey'
  | 'storyTitle'
  | 'storyPoints'
  | 'storyTrackerKey'
  | 'dependsOn'
  | 'durationMs'
  | 'tokensNew'
  | 'costUsd'
  | 'filesModified'
  | 'attempts'
> & { dodPassed: number; dodTotal: number };

// ──────────────────────────────────────────────────────────────────────
// Factory Metrics — timeseries 24h para los charts del dashboard /factory
// ──────────────────────────────────────────────────────────────────────

export interface FactoryMetricsBucket {
  /** ISO timestamp del inicio del bucket (hora redonda, UTC). */
  time: string;
  /** Slots ocupados durante el bucket — runs cuya ventana solapa con la hora.
   *  Cap a currentCapacityTotal. */
  capacityUsed: number;
  /** Tokens "nuevos" (input + output + cache_creation) sumados de los runs
   *  que reportaron usage en este bucket. */
  tokensNew: number;
  /** Tokens cached (cache_read), separados por transparencia. */
  tokensCached: number;
}

export interface FactoryMetricsResponse {
  generatedAt: string;
  bucketsCount: number;
  bucketDurationMs: number;
  /** Array ordenado ASC. buckets[0] = hace 23h, buckets[23] = hora actual. */
  buckets: FactoryMetricsBucket[];
  /** Slots ocupados ahora — count de AgentRun en status claimed|running. */
  currentCapacityUsed: number;
  /** Capacity total del fleet — sum(ComputeNode.totalSlots WHERE online). */
  currentCapacityTotal: number;
  /** Número de ComputeNodes online (no retired, heartbeat fresco). */
  onlineNodeCount: number;
}

/**
 * Timeseries 24h para los charts CapacityChart + TokenBurnChart del dashboard
 * /factory. Backend agrega desde AgentRun (generator + planner + verifier
 * usage). Polling sugerido: 30s — el backend escanea ~240 runs en buckets de
 * 1h, no es barato como /factory/nodes (5s). El polling de 30s + los charts
 * tienen granularidad horaria hacen que data más fresca no se vea reflejada.
 */
export function getFactoryMetrics() {
  return apiFetch<FactoryMetricsResponse>('/factory/metrics/timeseries');
}

// ──────────────────────────────────────────────────────────────────────
// Branch strategy — singleton config del modelo de ramas del Forge
// ──────────────────────────────────────────────────────────────────────

export interface BranchStrategyResponse {
  id: 'global';
  /** Branch destino del PR consolidado del Forge (default: "dev"). */
  devBranch: string;
  /** Branch de producción — NO se modifica desde el Forge. */
  mainBranch: string;
  /** Prefix para integration branches del Forge: `${prefix}{epicId}`. */
  forgeBranchPrefix: string;
  /** Si true, las integration branches se borran tras merge a DEV. */
  autoDeleteForgeBranch: boolean;
  /** Kill switch — cuando true, claim-story devuelve null sin importar otros estados. */
  forgePaused: boolean;
  forgePausedAt: string | null;
  forgePausedBy: string | null;
  forgePausedReason: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface UpdateBranchStrategyInput {
  devBranch?: string;
  mainBranch?: string;
  forgeBranchPrefix?: string;
  autoDeleteForgeBranch?: boolean;
}

/** Lee la configuración del modelo de branches. Auto-seed con defaults si
 *  es el primer acceso. Solo Alta Gerencia. */
export function getBranchStrategy() {
  return apiFetch<BranchStrategyResponse>('/factory/branch-strategy');
}

/** Patch parcial — solo los campos en el input cambian. Solo Alta Gerencia. */
export function updateBranchStrategy(input: UpdateBranchStrategyInput) {
  return apiFetch<BranchStrategyResponse>('/factory/branch-strategy', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Git state validation + alignment
// ──────────────────────────────────────────────────────────────────────

export interface BranchGitStateResponse {
  /** True si hay un code repository con forgeWritable configurado.
   *  Cuando es false, el frontend oculta el banner — la sección git state
   *  no aplica hasta que el operador configure un repo. */
  repoConfigured: boolean;
  devBranch: string;
  mainBranch: string;
  devExists: boolean;
  mainExists: boolean;
  devSha: string | null;
  mainSha: string | null;
  /** Status del compare main...dev en GitHub. NULL si una branch no existe. */
  compareStatus:
    | 'identical'
    | 'ahead'
    | 'behind'
    | 'diverged'
    | 'no_common_ancestor'
    | 'missing_branch'
    | null;
  /** True si dev y main comparten ancestro común (cualquier status válido). */
  sharesHistory: boolean;
  /** Mensaje accionable para el banner. NULL si todo está OK. */
  warning: string | null;
  /** True si tiene sentido ofrecer el botón "Alinear dev con main". */
  canAlignDev: boolean;
}

/**
 * Valida el git state actual: dev y main existen + comparten historia.
 * El frontend lo llama después de cargar el config para decidir si mostrar
 * el banner de "Alinear dev con main".
 */
export function getBranchGitState() {
  return apiFetch<BranchGitStateResponse>('/factory/branch-strategy/git-state');
}

export interface AlignDevBranchInput {
  /** Password del user para step-up auth contra Auth0. */
  password: string;
}

export interface AlignDevBranchResponse {
  devBranch: string;
  mainBranch: string;
  /** SHA donde apuntaba dev ANTES del force-update. NULL si dev no existía. */
  previousDevSha: string | null;
  /** SHA nuevo de dev (= mainBranch HEAD al momento del align). */
  newDevSha: string;
  alignedAt: string;
  alignedByName: string;
}

/**
 * Force-update de la branch dev para que comparta historia con main.
 * DESTRUCTIVO — descarta cualquier historia única de dev. Step-up auth
 * con password + rol TechLead o AltaGerencia es enforced en el backend.
 *
 * Errores tipados:
 *  - 401: password incorrecta
 *  - 403: rol no autorizado (no es TechLead ni AltaGerencia)
 *  - 404: no hay code repo configurado, o mainBranch no existe en remote
 *  - 502/503: GitHub API falló o Auth0 no configurado
 */
export function alignDevBranch(input: AlignDevBranchInput) {
  return apiFetch<AlignDevBranchResponse>(
    '/factory/branch-strategy/align-dev',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

// ──────────────────────────────────────────────────────────────────────
// Forge Kill Switch — pause/resume + emergency abort
// ──────────────────────────────────────────────────────────────────────

export interface ForgePausedState {
  forgePaused: boolean;
  forgePausedAt: string | null;
  forgePausedBy: string | null;
  forgePausedReason: string | null;
}

/**
 * Pausa el Forge — claim-story devuelve null hasta que se llame `resumeForge`.
 * Persistido en DB, sobrevive restarts.
 */
export function pauseForge(reason?: string) {
  return apiFetch<BranchStrategyResponse & ForgePausedState>(
    '/factory/branch-strategy/pause',
    {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? '' }),
    },
  );
}

/** Reanuda el Forge — claim-story vuelve a aceptar requests. */
export function resumeForge() {
  return apiFetch<BranchStrategyResponse & ForgePausedState>(
    '/factory/branch-strategy/resume',
    { method: 'POST' },
  );
}

/**
 * EMERGENCY: aborta TODOS los runs activos. Workers reciben 410 en próximo
 * progress (~30s) y matan claude. Combinar con `pauseForge` para detener
 * completamente (mata corriendo + bloquea futuros).
 */
export function abortAllForgeRuns(reason: string) {
  return apiFetch<{ aborted: number; reason: string }>(
    '/factory/branch-strategy/abort-all-runs',
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

// ════════════════════════════════════════════════════════════════════════
// Preview API — local dev server preview de sprint-batch branches
// ════════════════════════════════════════════════════════════════════════

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface PreviewStartResponse {
  batchId: string;
  status: PreviewStatus;
  url: string;
  port: number;
  branch: string;
}

export interface PreviewStatusResponse {
  status: PreviewStatus;
  url?: string;
  port?: number;
  branch?: string;
  projectType?: 'static' | 'node';
  startedAt?: string;
  error?: string;
  logsTail?: string[];
}

/**
 * Inicia el preview local de un sprint-batch. El backend clona la branch
 * a tmpdir + spawnea dev server (`pnpm dev` o `npx serve`) + retorna
 * inmediatamente con status='starting'. El caller debe pollear getPreviewStatus
 * hasta status='running' para abrir la URL.
 */
export function startPreview(batchId: string) {
  return apiFetch<PreviewStartResponse>(
    `/factory/batch/${batchId}/preview/start`,
    { method: 'POST' },
  );
}

/**
 * Detiene el preview (kill proceso + cleanup tmpdir). Idempotente — si no
 * hay preview activo, retorna stopped=false sin error.
 */
export function stopPreview(batchId: string) {
  return apiFetch<{ stopped: boolean }>(
    `/factory/batch/${batchId}/preview`,
    { method: 'DELETE' },
  );
}

/**
 * Estado actual del preview. Si no hay preview activo, retorna status='stopped'
 * (NO 404). Usado para polling cada 1-2s mientras status='starting' hasta
 * que se ponga 'running' o 'error'.
 */
export function getPreviewStatus(batchId: string) {
  return apiFetch<PreviewStatusResponse>(`/factory/batch/${batchId}/preview`);
}

// ──────────────────────────────────────────────────────────────────────
// Forge PRs — feed de pull requests del flujo Forge (/factory/prs)
// ──────────────────────────────────────────────────────────────────────

export interface ForgePrsResponse {
  /** URL del repo activo en GitHub (ej. `https://github.com/owner/repo`).
   *  NULL en sandbox — sin code repository forgeWritable configurado. */
  repoUrl: string | null;
  /** Rama destino del staging (`BranchStrategyConfig.devBranch`, ej. 'dev'). */
  stagingBranch: string;
  /** Todos los PRs del flujo Forge, ordenados por createdAt desc. */
  prs: ForgePrItem[];
}

/**
 * Un PR del flujo Forge. Dos variantes según `kind`:
 *  - 'story': PR de una historia individual → integration branch del epic.
 *  - 'staging': PR consolidado del epic (integration branch → devBranch).
 */
export interface ForgePrItem {
  /** `run-<runId>` para stories | `staging-<epicId>` para consolidados. */
  id: string;
  kind: 'story' | 'staging';
  number: number;
  /** Link directo al PR en GitHub. NULL en sandbox (sin repo). */
  url: string | null;
  title: string;
  batchId: string;
  epicId: string;
  epicTitle: string;
  /** NULL para staging — no pertenece a una story individual. */
  storyId: string | null;
  storyTitle: string | null;
  /** Nombre del compute node que corrió la story. NULL para staging. */
  agentName: string | null;
  /** Head branch (ej. `forge/epic-xxxx/story-yyyy`). */
  branch: string;
  /** Base branch — integration branch (stories) o stagingBranch (staging). */
  targetBranch: string;
  status: 'draft' | 'open' | 'merged' | 'closed';
  /** True = status real de GitHub; false = inferido de BD (sandbox o fallo
   *  de fetch a GitHub). Cuando es false, el diffstat viene null. */
  live: boolean;
  /** Diffstat real de GitHub. NULL cuando live=false. */
  additions: number | null;
  deletions: number | null;
  files: number | null;
  /** Veredicto del DoD verifier del run. NULL para staging. */
  dodStatus: 'pending' | 'passed' | 'failed' | null;
  /** Attempts del DoD loop (1 = clean). NULL para staging. */
  attempts: number | null;
  createdAt: string;
  mergedAt: string | null;
}

/**
 * Feed completo de PRs del Forge para el dashboard /factory/prs. Incluye
 * tanto PRs de stories (head → integration branch) como los consolidados
 * de staging (integration branch → devBranch). Polling sugerido: 15s — los
 * PRs cambian al ritmo del Forge, no necesita el polling de 5s de /nodes.
 */
export function getForgePrs() {
  return apiFetch<ForgePrsResponse>('/factory/prs');
}

// ──────────────────────────────────────────────────────────────────────
// Cost Analytics — agregados de costo del Forge (/factory/cost)
// ──────────────────────────────────────────────────────────────────────

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
  status: string;
  /** Suma across TODOS los runs de la story (retries incluidos). */
  costUsd: number;
  tokensNew: number;
  /** Attempts del DoD loop. NULL si el run nunca llegó al verifier. */
  attempts: number | null;
}

/** Totales globales del dashboard de costos. */
export interface CostAnalyticsTotals {
  costUsd: number;
  tokensNew: number;
  tokensCached: number;
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
  generatedAt: string;
  totals: CostAnalyticsTotals;
  /** ASC por enqueuedAt. */
  batches: CostAnalyticsBatch[];
  /** DESC por costUsd, solo stories con costo > 0. */
  stories: CostAnalyticsStory[];
}

/**
 * Agregados de costo del Forge para el dashboard /factory/cost. Polling
 * sugerido: 30s — el backend agrega usage across todos los AgentRuns,
 * mismo orden de costo que `/factory/metrics/timeseries` (no es un SELECT
 * barato como `/factory/nodes`).
 */
export function getCostAnalytics() {
  return apiFetch<CostAnalyticsResponse>('/factory/cost');
}
