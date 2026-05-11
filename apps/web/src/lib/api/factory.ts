import { apiFetch } from './client';

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
   *  CriterionEvent (worker milestones + agente custom). */
  criteriaProgress: unknown[] | null;
  /** Tier 1 Harness: total de attempts del DoD enforcement loop.
   *  1 = primer intento limpio. 2-3 = el agente necesitó retries tras fallar
   *  verificación determinística. */
  attempts: number;
  /** Tier 1 Harness: log estructurado del veredicto por criterio en cada
   *  attempt. Shape: array de { attempt, verdicts: CriterionVerdict[] }.
   *  Null antes del primer verifier run. La UI usa el último entry para
   *  pintar el estado actual de cada criterio del DoD. */
  dodVerification: unknown[] | null;
  storyId: string;
  storyTitle: string;
  epicId: string;
  epicTitle: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
}

export function getRunDetail(runId: string) {
  return apiFetch<RunDetailResponse>(`/factory/nodes/runs/${runId}`);
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
