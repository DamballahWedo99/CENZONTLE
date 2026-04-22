/**
 * Algoritmos puros para validar el DAG de orden entre historias del batch
 * (`storyOrderDependencies` emitido por el agente Tech Lead).
 *
 * Extraído del `StoryGenerationService` para poder testearse unitariamente
 * sin instanciar el service completo (que requiere Prisma, Redis, Anthropic
 * SDK, etc.). Las funciones son deterministas y sin side effects — cualquier
 * logging se hace vía el callback opcional `onReject`.
 */

export type StoryOrderEdgeHardness = 'hard' | 'soft';
export type StoryOrderEdgeReason =
  | 'api_contract'
  | 'migration_order'
  | 'shared_model'
  | 'sequential_logic'
  | 'other';

export interface StoryOrderEdge {
  fromIndex: number;
  blockedByIndex: number;
  hardness: StoryOrderEdgeHardness;
  reason: StoryOrderEdgeReason;
  description: string;
}

/**
 * Detecta si el conjunto de edges forma un ciclo. DFS clásico con estados
 * WHITE/GRAY/BLACK: si durante DFS encontramos un nodo GRAY, hay back-edge
 * → ciclo.
 *
 * Interpretación: `fromIndex` depende de `blockedByIndex`; la arista
 * orientada para DFS va `from → blockedBy` (alcanzabilidad inversa).
 */
export function wouldIntroduceCycle(
  edges: ReadonlyArray<StoryOrderEdge>,
  nodeCount: number,
): boolean {
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    adjacency[edge.fromIndex]?.push(edge.blockedByIndex);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Array(nodeCount).fill(WHITE);
  const dfs = (u: number): boolean => {
    color[u] = GRAY;
    for (const v of adjacency[u]) {
      if (color[v] === GRAY) return true;
      if (color[v] === WHITE && dfs(v)) return true;
    }
    color[u] = BLACK;
    return false;
  };
  for (let i = 0; i < nodeCount; i++) {
    if (color[i] === WHITE && dfs(i)) return true;
  }
  return false;
}

const VALID_HARDNESS: ReadonlySet<StoryOrderEdgeHardness> = new Set(['hard', 'soft']);
const VALID_REASONS: ReadonlySet<StoryOrderEdgeReason> = new Set([
  'api_contract',
  'migration_order',
  'shared_model',
  'sequential_logic',
  'other',
]);

/**
 * Callback opcional para logging de rechazos. El caller (StoryGenerationService)
 * lo inyecta con `this.logger.warn` al uso real; tests lo inyectan con un
 * spy o lo omiten.
 */
export type EdgeRejectReason =
  | 'out_of_range'
  | 'self_block'
  | 'duplicate'
  | 'cycle';

export type OnRejectCallback = (
  reason: EdgeRejectReason,
  details: { from: number; to: number; outlineCount: number },
) => void;

/**
 * Convierte `rawEdges` del tool en edges validados. Descarta (con callback):
 *  - Entries sin indices numéricos o fuera de rango [0, outlineCount).
 *  - Self-bloqueo (from === blockedBy).
 *  - Hardness/reason fuera del enum → fallback a 'hard' / 'other'.
 *  - Duplicados exactos (mismo from+blockedBy).
 *  - Ciclos: si un nuevo edge introduce un ciclo en el DAG acumulado, se
 *    rechaza con callback.
 */
export function parseAndValidateStoryOrderEdges(
  raw: unknown[],
  outlineCount: number,
  onReject?: OnRejectCallback,
): StoryOrderEdge[] {
  const accepted: StoryOrderEdge[] = [];
  const seenPairs = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const from = typeof r.fromOutlineIndex === 'number' ? r.fromOutlineIndex : -1;
    const to = typeof r.blockedByOutlineIndex === 'number' ? r.blockedByOutlineIndex : -1;
    if (from < 0 || from >= outlineCount || to < 0 || to >= outlineCount) {
      onReject?.('out_of_range', { from, to, outlineCount });
      continue;
    }
    if (from === to) {
      onReject?.('self_block', { from, to, outlineCount });
      continue;
    }
    const key = `${from}->${to}`;
    if (seenPairs.has(key)) {
      onReject?.('duplicate', { from, to, outlineCount });
      continue;
    }
    const hardness = VALID_HARDNESS.has(r.hardness as StoryOrderEdgeHardness)
      ? (r.hardness as StoryOrderEdgeHardness)
      : 'hard';
    const reason = VALID_REASONS.has(r.reason as StoryOrderEdgeReason)
      ? (r.reason as StoryOrderEdgeReason)
      : 'other';
    const description = typeof r.description === 'string' ? r.description.slice(0, 500) : '';

    const candidate: StoryOrderEdge = {
      fromIndex: from,
      blockedByIndex: to,
      hardness,
      reason,
      description,
    };

    if (wouldIntroduceCycle([...accepted, candidate], outlineCount)) {
      onReject?.('cycle', { from, to, outlineCount });
      continue;
    }

    accepted.push(candidate);
    seenPairs.add(key);
  }

  return accepted;
}
