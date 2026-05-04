import type { DiscoveredDependency } from '@cenzontle/shared';

/**
 * Result del dedup cross-stories. Devuelve el mapa filtrado + estadísticas
 * de cuántos duplicados se eliminaron, para que el caller pueda loggear.
 */
export interface DedupCrossStoriesResult {
  depsByIndex: Map<number, DiscoveredDependency[]>;
  /** Total de duplicados descartados across stories del batch actual. */
  duplicatesRemoved: number;
  /**
   * Total de deps descartadas porque colisionaban con una key ya declarada
   * en historias EXISTENTES (batches previos) — separado de
   * `duplicatesRemoved` para diagnosticar el origen del descarte.
   */
  collidedWithExisting: number;
  /**
   * Para cada credencial deduplicada (vendor + title canónico), lista los
   * outlineIndices que la mencionaban. Útil para loggear qué se consolidó.
   */
  consolidations: Array<{
    canonicalKey: string;
    /** -1 si la key viene de una historia previa (ya persistida). */
    keptInIndex: number;
    droppedFromIndices: number[];
  }>;
}

/**
 * Strippea prefijos comunes que distintas historias podrían usar para la
 * misma credencial (paritario al `normalizeTitle` del rollup helper). Sin
 * esto, "GitHub Secret: VERCEL_TOKEN" en historia 0 y "VERCEL_TOKEN" en
 * historia 1 escaparían al dedup. Usa lookahead `(?=[A-Z_])` para evitar
 * falsos positivos en titles humanos como "Token: Bearer Auth".
 *
 * EXPORTADO porque `story-generation.service.ts:loadCommonContext` lo usa
 * para construir el `globalSecretsRegistry` (cross-org dedup vía match
 * con `external_secrets.name`). Mantener UNA implementación garantiza
 * paridad — divergencia entre módulos produce los bugs históricos del
 * 2026-04-12 / 2026-05-04 donde una key se generaba distinta en intra-batch
 * vs cross-batch dedup.
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(
      /^(github\s+secret|secret|credencial|credential|token|api\s+key)\s*:\s*(?=[A-Z_])/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Misma forma que `dedupKey` pero acepta un shape mínimo del campo de
 * Prisma `StoryTechnicalDependency`. Permite construir el set de keys ya
 * tomadas por historias EXISTENTES de la épica sin tener que mapear a
 * `DiscoveredDependency` (que incluye campos extra como `severity`,
 * `requiresCredential`, etc.).
 *
 * NOTA importante sobre la elección del shape de la key: usamos SOLO
 * `vendor::normalizedTitle`, sin segmento de tipo/categoría. Razones:
 *  1. `DiscoveredDependencyType` (`'api'|'service'|'data'|'team'|'other'`,
 *     emitido por el LLM en el batch) y `StoryTechnicalDependencyCategory`
 *     (`'secrets'|'apis'|'testing'|'services'|'teams'|'knowledge'|'other'`,
 *     persistido en BD) son enums estructuralmente distintos. El persistor
 *     mapea `api→apis, service→services, data→testing, team→teams`, pero
 *     el mapeo NO es bidireccional perfecto: una credencial puede haberse
 *     editado manualmente a `'secrets'` o `'knowledge'` en BD, categorías
 *     que no tienen contraparte en `DiscoveredDependencyType`.
 *  2. El discriminador semántico real para "esta es la misma credencial
 *     conceptual" es `vendor + nombre canónico`, no la taxonomía.
 *  3. Coherente con el patrón de `dedupe-rollup.ts` que también usa
 *     `vendor + normalizedTitle` sin segmento de categoría.
 */
export function dedupKeyForPersisted(persisted: {
  vendor?: string | null;
  title: string;
}): string {
  const vendorKey = (persisted.vendor ?? '').trim().toLowerCase();
  const titleKey = normalizeTitle(persisted.title);
  return `${vendorKey}::${titleKey}`;
}

function dedupKey(dep: DiscoveredDependency): string {
  const vendorKey = (dep.vendor ?? '').trim().toLowerCase();
  const titleKey = normalizeTitle(dep.title);
  return `${vendorKey}::${titleKey}`;
}

/**
 * Dedupea deps emitidas por el agente CROSS-STORIES dentro del MISMO batch
 * y, opcionalmente, contra deps ya declaradas en historias EXISTENTES de la
 * épica (batches previos).
 *
 * Si la misma credencial aparece en N historias del batch (ej.
 * AMADEUS_CLIENT_ID en outlineIndex 0, 1 y 2), mantiene SOLO la primera
 * (menor outlineIndex que la introduce) y descarta las demás. Si además se
 * pasa `existingKeys` y la key ya estaba tomada por una historia previa,
 * descarta TODAS las apariciones del batch — la "fuente de verdad" ya
 * existe en otra historia persistida y duplicarla generaría rows nuevos en
 * `story_technical_dependencies` apuntando a la misma credencial conceptual.
 *
 * Diseño:
 *  - "Primera por outlineIndex" — determinístico y predecible.
 *  - El dedup intra-story (TL+QA en la misma historia) ya lo hace
 *    `mergeDiscoveredDependencies` (deps-merger.ts) por (vendor, type).
 *    Este helper opera SOLO cross-story.
 *  - Las deps SIN vendor matcheable (vendor='', title sin patrón claro)
 *    NO se deduplican — mejor un falso positivo de duplicación que
 *    fusionar credenciales realmente distintas.
 *  - El return preserva el shape `Map<outlineIndex, DiscoveredDependency[]>`
 *    para que el caller no tenga que cambiar nada de su flow downstream.
 *
 * Complejidad O(n) donde n = total deps en el batch.
 */
export function dedupCrossStoriesPure(
  depsByIndex: ReadonlyMap<number, ReadonlyArray<DiscoveredDependency>>,
  existingKeys?: ReadonlySet<string>,
): DedupCrossStoriesResult {
  // Agrupar globalmente por dedupKey, recordando dónde apareció primero.
  const seenKeys = new Map<string, { firstIndex: number; firstDep: DiscoveredDependency; droppedFromIndices: number[] }>();
  const indices = Array.from(depsByIndex.keys()).sort((a, b) => a - b);

  // Pass 1: descubrir keys duplicadas y registrar qué se va a descartar.
  for (const idx of indices) {
    const deps = depsByIndex.get(idx) ?? [];
    for (const dep of deps) {
      const key = dedupKey(dep);
      const existing = seenKeys.get(key);
      if (!existing) {
        seenKeys.set(key, { firstIndex: idx, firstDep: dep, droppedFromIndices: [] });
      } else if (existing.firstIndex !== idx) {
        // Otra historia ya emitió esta credencial — registramos drop.
        // (Mismo idx con misma key se permite — es duplicate intra-story
        // que el merge intra-story ya filtró antes de llegar aquí.)
        existing.droppedFromIndices.push(idx);
      }
    }
  }

  // Pass 2: construir el output filtrado.
  const out = new Map<number, DiscoveredDependency[]>();
  let duplicatesRemoved = 0;
  let collidedWithExisting = 0;
  // Tracking separado para reportar qué keys colisionaron con previas.
  const collidedKeysFromExisting = new Map<string, number[]>(); // key -> [outlineIndices]

  for (const idx of indices) {
    const deps = depsByIndex.get(idx) ?? [];
    const filtered: DiscoveredDependency[] = [];
    for (const dep of deps) {
      const key = dedupKey(dep);
      // Prioridad 1: si una historia previa ya la declaró, descartamos
      // sin importar el outlineIndex del batch. El batch NO debe re-emitirla.
      if (existingKeys?.has(key)) {
        collidedWithExisting++;
        const list = collidedKeysFromExisting.get(key) ?? [];
        list.push(idx);
        collidedKeysFromExisting.set(key, list);
        continue;
      }
      const owner = seenKeys.get(key);
      if (owner && owner.firstIndex === idx) {
        // Esta es la "primera" del batch — la mantenemos.
        filtered.push(dep);
      } else {
        duplicatesRemoved++;
      }
    }
    if (filtered.length > 0) {
      out.set(idx, filtered);
    }
  }

  // Construir el reporte de consolidaciones (solo las que tuvieron drops).
  const consolidations: DedupCrossStoriesResult['consolidations'] = [];
  for (const [key, info] of seenKeys.entries()) {
    if (info.droppedFromIndices.length > 0 && !existingKeys?.has(key)) {
      consolidations.push({
        canonicalKey: key,
        keptInIndex: info.firstIndex,
        droppedFromIndices: info.droppedFromIndices,
      });
    }
  }
  // Reportar también las colisiones contra previas con keptInIndex=-1
  // para que el caller distinga "vino de batch previo" vs "primera del batch".
  for (const [key, droppedIndices] of collidedKeysFromExisting.entries()) {
    consolidations.push({
      canonicalKey: key,
      keptInIndex: -1,
      droppedFromIndices: droppedIndices,
    });
  }

  return { depsByIndex: out, duplicatesRemoved, collidedWithExisting, consolidations };
}
