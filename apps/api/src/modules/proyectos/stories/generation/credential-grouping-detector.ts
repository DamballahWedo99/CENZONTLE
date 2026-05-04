import type { DiscoveredDependency } from '@cenzontle/shared';

/**
 * Detector heurístico que examina títulos de `DiscoveredDependency` para
 * identificar entries que probablemente agrupan múltiples credenciales en
 * un solo registro (ej. `"GitHub Secrets: VERCEL_TOKEN, VERCEL_ORG_ID,
 * VERCEL_PROJECT_ID"`).
 *
 * El bug que ataca: el agente IA (TL/QA) emite UNA sola dependency con varios
 * secrets/tokens distintos en el title, lo que rompe la UX de
 * `/factory/settings` donde el user resuelve cada credencial por separado.
 *
 * Diseño WARN-only por ahora: la función retorna los títulos sospechosos,
 * el caller decide si solo loguear o forzar reintento del agente.
 *
 * Reglas (cualquiera dispara):
 *  R1. Lista explícita: 2+ tokens SCREAMING_SNAKE_CASE separados por
 *      `,`/`+`/`/`/`;`/`&`.
 *  R2. Prefijo plural: title empieza con "Secrets:", "Keys:", "Tokens:",
 *      "Credentials:", "Variables:" (con o sin "GitHub" delante).
 *  R3. Token UPPERCASE repetido: el mismo segmento UPPERCASE de ≥4 chars
 *      aparece 2+ veces tras partir por separadores. Captura concatenaciones
 *      sin separador explícito como
 *      "GITHUB_SECRETS_VERCEL_TOKEN_VERCEL_ORG_ID_VERCEL_PROJECT_ID".
 *
 * Excepciones intencionales (no disparan):
 *  - Un único token uppercase distinto + palabras lowercase
 *    (ej. "Stripe API Key", "GCP Service Account JSON", "AWS IAM Role").
 *  - SCREAMING_SNAKE_CASE de un solo secret con vendor único
 *    (ej. "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY").
 *  - El umbral ≥4 chars en R3 evita falsos positivos con siglas cortas
 *    repetidas como "AWS" o "GCP".
 */
export function detectGroupedCredentials(
  deps: ReadonlyArray<DiscoveredDependency>,
): string[] {
  if (deps.length === 0) return [];

  const screamingSnakeListRe = /[A-Z][A-Z0-9_]{2,}\b\s*[,+/;&]\s*[A-Z][A-Z0-9_]{2,}/;
  const pluralPrefixRe = /^(github\s+)?(secrets|keys|tokens|credentials|variables)\s*:/i;
  const segmentRe = /^[A-Z][A-Z0-9]{2,}$/;

  const hasRepeatedUppercaseToken = (title: string): boolean => {
    const segments = title.split(/[_\s,+/:;&.-]+/).filter((s) => segmentRe.test(s));
    const counts = new Map<string, number>();
    for (const s of segments) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
      if ((counts.get(s) ?? 0) >= 2 && s.length >= 4) return true;
    }
    return false;
  };

  const offenders: string[] = [];
  for (const d of deps) {
    const title = (d.title ?? '').trim();
    if (!title) continue;
    const isOffender =
      screamingSnakeListRe.test(title) ||
      pluralPrefixRe.test(title) ||
      hasRepeatedUppercaseToken(title);
    if (isOffender) {
      offenders.push(title.length > 80 ? `${title.slice(0, 77)}…` : title);
    }
  }

  return offenders;
}
