/**
 * Merge con dedup de `DiscoveredDependency` emitidas por el Tech Lead y el
 * agente QA. Función pura — extraída del `StoryGenerationService` para
 * testing aislado.
 */

import type { DiscoveredDependency, DependencySeverity } from '@cenzontle/shared';

export const MAX_MERGED_DEPS = 80;

/**
 * Strippea prefijos comunes que distintas fuentes usan para la misma
 * credencial. ALINEADO con `normalizeTitle` de `dedup-cross-stories.ts` —
 * sin esto, "GitHub Secret: VERCEL_TOKEN" emitido por QA y "VERCEL_TOKEN"
 * emitido por TL en la MISMA historia se persisten como duplicados.
 */
function normalizeTitle(title: string): string {
  return title
    .replace(
      /^(github\s+secret|secret|credencial|credential|token|api\s+key)\s*:\s*(?=[A-Z_])/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Severity order: critical > high > medium > low. */
export function maxSeverity(
  a: DependencySeverity,
  b: DependencySeverity,
): DependencySeverity {
  const order: Record<DependencySeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return order[a] >= order[b] ? a : b;
}

/**
 * Consolida deps del TL (arquitectura/credenciales) y QA (mocks/fixtures)
 * deduplicando por:
 *   1. `vendor` case-insensitive (sin segmento de type — AlIneado con
 *      `dedupCrossStoriesPure`. Antes el segmento de type causaba que
 *      "VERCEL_TOKEN" type='api' del TL y "GitHub Secret: VERCEL_TOKEN"
 *      type='service' del QA NO matchearan, persistiéndose como dos rows
 *      en BD para la misma credencial conceptual).
 *   2. Fallback a `normalizedTitle` (strippea prefijos como "GitHub Secret:",
 *      "Credencial:", "Token:", etc. — sin esto los aliases nominales
 *      escapan el dedup).
 *   3. Alias: cuando una entry con vendor se agrega, también se alias por
 *      título normalizado → incoming sin vendor pero con title similar se
 *      dedup contra la entry del TL.
 *
 * Orden de merge: TL primero (tiene vendor/requiresCredential), luego QA
 * (aporta mdContent de estrategia de mock). El mdContent ganador es el
 * más largo; la severity es el máximo de ambas.
 *
 * IMPORTANTE: las keys de dedup INTRA-story (este archivo) deben permanecer
 * paritarias con el dedup CROSS-story (`dedup-cross-stories.ts`). Ambos
 * usan `vendor + normalizedTitle`. Si divergen, tendremos casos donde el
 * cross-story considera dos deps iguales pero el intra-story las preserva
 * como distintas (o viceversa) — bug histórico del 2026-05.
 */
export function mergeDiscoveredDependencies(
  tlDeps: ReadonlyArray<DiscoveredDependency>,
  qaDeps: ReadonlyArray<DiscoveredDependency>,
  onDedup?: (details: { input: number; output: number; tl: number; qa: number }) => void,
): DiscoveredDependency[] {
  // Key combinada `vendor + normalizedTitle` — paritaria con
  // `dedupCrossStoriesPure`. Si la dep tiene vendor, su key es
  // `v:<vendor>|n:<normalized>`. Sin vendor, fallback a solo titleKey
  // para permitir dedup nominal (raro pero posible: el LLM emite la
  // misma cred dos veces, una con vendor y otra sin él).
  const vendorKey = (d: DiscoveredDependency): string | null =>
    d.vendor && d.vendor.trim()
      ? `v:${d.vendor.trim().toLowerCase()}|n:${normalizeTitle(d.title)}`
      : null;
  const titleKey = (d: DiscoveredDependency): string =>
    `n:${normalizeTitle(d.title)}`;

  const merged = new Map<string, DiscoveredDependency>();
  const titleAliases = new Map<string, string>();

  const resolveExisting = (d: DiscoveredDependency): DiscoveredDependency | undefined => {
    const vk = vendorKey(d);
    if (vk && merged.has(vk)) return merged.get(vk);
    const tk = titleKey(d);
    const aliased = titleAliases.get(tk);
    if (aliased && merged.has(aliased)) return merged.get(aliased);
    if (merged.has(tk)) return merged.get(tk);
    return undefined;
  };

  const keyFor = (d: DiscoveredDependency): string => vendorKey(d) ?? titleKey(d);

  for (const dep of [...tlDeps, ...qaDeps]) {
    const existing = resolveExisting(dep);
    if (!existing) {
      const key = keyFor(dep);
      merged.set(key, dep);
      if (vendorKey(dep)) titleAliases.set(titleKey(dep), key);
      continue;
    }
    const updated: DiscoveredDependency = {
      ...existing,
      vendor: existing.vendor ?? dep.vendor,
      requiresCredential: existing.requiresCredential ?? dep.requiresCredential,
      isBlocking: existing.isBlocking ?? dep.isBlocking,
      mdContent:
        (dep.mdContent?.length ?? 0) > (existing.mdContent?.length ?? 0)
          ? dep.mdContent
          : existing.mdContent,
      severity: maxSeverity(existing.severity, dep.severity),
    };
    const existingKey = vendorKey(existing) ?? titleKey(existing);
    const newKey = vendorKey(updated) ?? titleKey(updated);
    if (existingKey !== newKey) merged.delete(existingKey);
    merged.set(newKey, updated);
    if (vendorKey(updated)) titleAliases.set(titleKey(updated), newKey);
  }

  const result = Array.from(merged.values()).slice(0, MAX_MERGED_DEPS);
  const inputCount = tlDeps.length + qaDeps.length;
  if (inputCount !== result.length) {
    onDedup?.({ input: inputCount, output: result.length, tl: tlDeps.length, qa: qaDeps.length });
  }
  return result;
}
