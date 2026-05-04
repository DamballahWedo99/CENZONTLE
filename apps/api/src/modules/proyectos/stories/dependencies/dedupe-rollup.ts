import type {
  StoryTechnicalDependency,
  StoryTechnicalDependencySeverity,
} from '@cenzontle/shared';

/**
 * Mapa story → title para resolver `relatedStories[].storyTitle` en el dedup.
 * El controller pasa este lookup ya construido (1 query por epic) para
 * evitar N queries dentro del helper.
 */
export type StoryTitleLookup = Map<string, string>;

const SEVERITY_RANK: Record<StoryTechnicalDependencySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Strippea prefijos comunes que los agentes IA agregan al title pero que
 * representan la MISMA credencial:
 *   - "GitHub Secret: VERCEL_TOKEN" → "VERCEL_TOKEN"
 *   - "Secret: STRIPE_API_KEY" → "STRIPE_API_KEY"
 *   - "Credencial: AMADEUS_CLIENT_ID" → "AMADEUS_CLIENT_ID"
 *   - "Token: GITHUB_TOKEN" → "GITHUB_TOKEN"
 *   - "API Key: OPENAI_API_KEY" → "OPENAI_API_KEY"
 *
 * Lookahead `(?=[A-Z_])` exige que después del `:` venga un patrón de
 * credencial real (SCREAMING_SNAKE_CASE típico). Esto evita falsos
 * positivos como "Token: Bearer X" donde "Token" es parte del nombre
 * humano, no un prefijo de credencial. Excluimos `key` y `var` standalone
 * porque son palabras genéricas con muchos titles legítimos ("Key:
 * Performance Indicator", "var: env_setting") — strip silencioso ahí
 * fusionaría deps distintas.
 *
 * También colapsa whitespace y lowercases para matcheo case-insensitive
 * (ej. "vercel_token" === "VERCEL_TOKEN").
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

/**
 * Clave de agrupación para dedup. Considera dos deps "iguales" cuando
 * coinciden en (vendor normalizado, title normalizado, category). NO usa
 * severity ni isBlocking porque pueden variar entre menciones de la misma
 * credencial — el helper elige el "peor caso" (severity más alta, blocking
 * si alguno lo es) como representante del grupo.
 */
function dedupKey(dep: StoryTechnicalDependency): string {
  const vendorKey = (dep.vendor ?? '').trim().toLowerCase();
  const titleKey = normalizeTitle(dep.title);
  return `${dep.category}::${vendorKey}::${titleKey}`;
}

/**
 * Selecciona la entry "canónica" del grupo: la que vamos a mostrar como
 * representante. Reglas (en orden):
 *  1. Mayor severity (critical > high > medium > low). `?? 0` defiende
 *     contra severity null/undefined (caso edge de legacy data).
 *  2. Si alguna del grupo tiene `linkedSecretId`, esa gana (ya resuelta).
 *  3. Si alguna es bloqueante, esa gana.
 *  4. Tiebreaker: la primera por `createdAt` (la más antigua, más estable).
 *
 * Guard explícito contra grupo vacío: por construcción del helper nunca
 * debería llegar uno vacío, pero el throw documenta el invariante para
 * futuros callers que invoquen el módulo directamente.
 */
function pickCanonical(group: StoryTechnicalDependency[]): StoryTechnicalDependency {
  if (group.length === 0) {
    throw new Error('pickCanonical: group cannot be empty (caller invariant violated)');
  }
  return group.reduce((best, current) => {
    const bestRank = SEVERITY_RANK[best.severity] ?? 0;
    const currRank = SEVERITY_RANK[current.severity] ?? 0;
    if (currRank > bestRank) return current;
    if (currRank < bestRank) return best;

    // Empate de severity → preferir resuelta
    if (current.linkedSecretId && !best.linkedSecretId) return current;
    if (best.linkedSecretId && !current.linkedSecretId) return best;

    // Empate → preferir bloqueante
    if (current.isBlocking && !best.isBlocking) return current;
    if (best.isBlocking && !current.isBlocking) return best;

    // Empate total → la más antigua
    return new Date(current.createdAt).getTime() < new Date(best.createdAt).getTime()
      ? current
      : best;
  });
}

/**
 * Deduplica un array plano de `StoryTechnicalDependency` (típicamente el
 * output de `findByEpic`) agrupando por credencial conceptual y retornando
 * UNA entry por grupo con `relatedStories[]` listando todas las historias
 * que la mencionan.
 *
 * Diseño:
 *  - El dedup es VISUAL — NO toca la DB. Cada story sigue siendo dueña
 *    de sus rows; al borrar la story, sus deps se borran vía FK como antes.
 *  - El rollup es read-only: se calcula al vuelo en cada GET.
 *  - Si N=1 (la dep solo aparece en una historia), `relatedStories` queda
 *    `undefined` (no inflar el response innecesariamente).
 *  - Las legacy deps (con `storyId=''`) NO se mezclan con las fresh — viven
 *    en su propio grupo con `relatedStories=undefined` (no hay story owner).
 *
 * Complejidad: O(n) donde n = deps totales del epic. Suficiente para
 * volúmenes esperados (decenas de deps por epic).
 */
export function dedupeRollup(
  deps: StoryTechnicalDependency[],
  storyTitles: StoryTitleLookup,
): StoryTechnicalDependency[] {
  // Las legacy (storyId vacío) bypasean el dedup — no tienen story owner
  // y vienen del JSONB legacy/vault, ya deduplicadas en su origen.
  const legacy = deps.filter((d) => !d.storyId);
  const fresh = deps.filter((d) => d.storyId);

  const groups = new Map<string, StoryTechnicalDependency[]>();
  for (const dep of fresh) {
    const key = dedupKey(dep);
    const bucket = groups.get(key);
    if (bucket) bucket.push(dep);
    else groups.set(key, [dep]);
  }

  const dedupedFresh: StoryTechnicalDependency[] = [];
  for (const group of groups.values()) {
    const canonical = pickCanonical(group);
    if (group.length === 1) {
      // Sola mención — no agregamos relatedStories (mantiene shape limpio)
      dedupedFresh.push(canonical);
    } else {
      // Múltiples menciones — listamos todas (incluyendo la canónica)
      const relatedStories = group.map((d) => ({
        storyId: d.storyId,
        storyTitle: storyTitles.get(d.storyId) ?? '(historia sin título)',
      }));
      dedupedFresh.push({ ...canonical, relatedStories });
    }
  }

  // Preserva el ordering original del Prisma `orderBy: [category asc,
  // createdAt asc]`. Sort por category primero (estable a nivel sección
  // para el frontend) y dentro de category por createdAt asc usando la
  // canónica del grupo. Sin el secondary key, una canónica antigua de
  // categoría 'apis' aparecería antes que canónicas más nuevas de
  // 'secrets', invirtiendo el contrato del endpoint.
  dedupedFresh.sort((a, b) => {
    const categoryDiff = a.category.localeCompare(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return [...dedupedFresh, ...legacy];
}
