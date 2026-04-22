/**
 * Merge con dedup de `DiscoveredDependency` emitidas por el Tech Lead y el
 * agente QA. Función pura — extraída del `StoryGenerationService` para
 * testing aislado.
 */

import type { DiscoveredDependency, DependencySeverity } from '@cenzontle/shared';

export const MAX_MERGED_DEPS = 80;

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
 *   1. `(vendor, type)` case-insensitive si hay vendor.
 *   2. Fallback a `title` case-insensitive.
 *   3. Alias: cuando una entry con vendor se agrega, también se alias por
 *      título → incoming sin vendor pero con title similar se dedup contra
 *      la entry del TL.
 *
 * Orden de merge: TL primero (tiene vendor/requiresCredential), luego QA
 * (aporta mdContent de estrategia de mock). El mdContent ganador es el
 * más largo; la severity es el máximo de ambas.
 */
export function mergeDiscoveredDependencies(
  tlDeps: ReadonlyArray<DiscoveredDependency>,
  qaDeps: ReadonlyArray<DiscoveredDependency>,
  onDedup?: (details: { input: number; output: number; tl: number; qa: number }) => void,
): DiscoveredDependency[] {
  const vendorKey = (d: DiscoveredDependency): string | null =>
    d.vendor && d.vendor.trim()
      ? `v:${d.vendor.trim().toLowerCase()}|t:${d.type}`
      : null;
  const titleKey = (d: DiscoveredDependency): string =>
    `n:${d.title.trim().toLowerCase()}`;

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
