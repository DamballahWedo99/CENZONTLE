import { detectDoomLoopKind, type DoomLoopKind } from '@cenzontle/shared';

// ════════════════════════════════════════════════════════════════════════
// Failure extraction — la checklist DoD que el TechLead ve en el merge view
// ════════════════════════════════════════════════════════════════════════
//
// Extraído de factory-queue.service.ts (2026-05-19) a su propio archivo:
// es lógica pura de dominio y vivía dentro de un service de 1600 líneas que
// importa GitHub/Octokit. Aislarla la hace unit-testeable sin arrastrar esa
// cadena de dependencias (Jest no transpila el ESM de @octokit).

// 500: el panel "Revisión técnica del Forge" muestra el reason en un bloque
// propio (no inline), así que cabe el detalle completo del verifier sin
// cortarlo a media frase. El DTO de origen permite hasta 2000.
const REASON_MAX_CHARS = 500;

export type CriterionStatus = 'passed' | 'failed' | 'skipped';

export interface CriterionResult {
  id: string;
  label: string;
  status: CriterionStatus;
  /**
   * Motivo del fail/skip — `verdict.reason` (explicación concisa del
   * verifier) con fallback a `verdict.output` (dump crudo). Vacío para
   * criterios `passed`. Truncado a `REASON_MAX_CHARS`.
   */
  reason: string;
}

export interface FailureInfo {
  attempts: number;
  doomLoopKind: DoomLoopKind | null;
  /**
   * Checklist COMPLETA del DoD — todos los criterios con su veredicto final
   * (passed/failed/skipped). El merge view la renderiza como checklist para
   * que el TechLead vea qué se cumplió y qué no, no solo los fallos.
   *
   * Orden: el de primera-aparición del criterio (estable entre attempts).
   */
  criteria: CriterionResult[];
}

/** Verdict crudo tal como viene en `dodVerification` (Json de Prisma). */
type RawVerdict = Record<string, unknown>;

/** Trunca + limpia el motivo de un verdict (reason preferido sobre output). */
function deriveReason(verdict: RawVerdict): string {
  const raw =
    typeof verdict.reason === 'string' && verdict.reason.trim().length > 0
      ? verdict.reason.trim()
      : typeof verdict.output === 'string'
        ? verdict.output.trim()
        : '';
  // Colapsar saltos de línea a un espacio: el reason se renderiza en una
  // sola línea (tooltip + checklist) y se serializa a markdown — un \n crudo
  // rompería la línea de continuación `└` del markdown copiado, y el texto
  // tras el salto se parsearía como item suelto (qa-reviewer 2026-05-19).
  const oneLine = raw.replace(/\s*\n\s*/g, ' ');
  return oneLine.length > REASON_MAX_CHARS
    ? oneLine.slice(0, REASON_MAX_CHARS) + '…'
    : oneLine;
}

/**
 * Extrae del `dodVerification` y `errorMessage` la info que el frontend
 * necesita para mostrar la checklist DoD de una story en el merge view.
 *
 * **Merge across attempts (last-wins):** NO leemos solo el último attempt.
 * Con el surgical retry, un attempt tardío puede re-verificar SOLO los
 * criterios que fallaban — leer únicamente ese entry perdería los criterios
 * que ya pasaban. Recolectamos todos los criterios vistos en cualquier
 * attempt y, para cada `criterionId`, nos quedamos con el veredicto del
 * attempt MÁS RECIENTE donde aparece. Mismo patrón que `extractMergedVerdicts`
 * del frontend (terminal/page.tsx). El orden de la checklist preserva la
 * primera-aparición de cada criterio para estabilidad visual.
 *
 * **Shape canónico:** `CriterionVerdictDto` (dod-verification.dto.ts) — los
 * campos son `criterionId` y `status: 'passed'|'failed'|'skipped'`. NO existe
 * un booleano `passed` ni un campo `id`.
 *
 * **Doom loop:** delega a `detectDoomLoopKind` de @cenzontle/shared para que
 * worker y queue compartan UNA fuente de verdad del formato del errorMessage.
 */
export function extractFailureInfo(
  dodVerification: unknown,
  errorMessage: string | null,
): FailureInfo {
  const doomLoopKind = detectDoomLoopKind(errorMessage);

  if (!Array.isArray(dodVerification) || dodVerification.length === 0) {
    return { attempts: 0, doomLoopKind, criteria: [] };
  }

  // order: criterionId → índice de primera aparición (estabilidad visual).
  // latest: criterionId → veredicto del attempt más reciente (last-wins).
  const order = new Map<string, number>();
  const latest = new Map<string, CriterionResult>();

  // Defensa: ordenar por `attempt` ascendente antes del merge last-wins.
  // El worker escribe append-only (orden natural ya ascendente), pero el
  // sort explícito blinda el last-wins contra cualquier escritura futura
  // fuera de orden — sin él, un attempt viejo podría sobrescribir el
  // veredicto de uno más reciente (qa-reviewer 2026-05-19).
  const attemptsAsc = [...dodVerification].sort((a, b) => {
    const an = (a as { attempt?: unknown } | null)?.attempt;
    const bn = (b as { attempt?: unknown } | null)?.attempt;
    return (typeof an === 'number' ? an : 0) - (typeof bn === 'number' ? bn : 0);
  });

  // Iterar en orden ascendente hace que el último `.set` gane = last-wins.
  for (const attemptEntry of attemptsAsc) {
    const verdicts = Array.isArray(
      (attemptEntry as { verdicts?: unknown } | null)?.verdicts,
    )
      ? (attemptEntry as { verdicts: unknown[] }).verdicts
      : [];
    for (const v of verdicts) {
      if (!v || typeof v !== 'object') continue;
      const verdict = v as RawVerdict;
      // criterionId ausente/malformado → 'unknown'. Si varios verdicts caen
      // aquí colapsan a la misma key y solo sobrevive el último (last-wins).
      // Es data corrupta — el DTO valida criterionId como string requerido;
      // no preservamos duplicados de algo que no debería existir.
      const id =
        typeof verdict.criterionId === 'string'
          ? verdict.criterionId
          : 'unknown';
      const rawStatus = verdict.status;
      const status: CriterionStatus =
        rawStatus === 'passed' || rawStatus === 'failed' || rawStatus === 'skipped'
          ? rawStatus
          : 'failed'; // status desconocido/malformado → tratamos como fallo
      const label =
        typeof verdict.label === 'string' && verdict.label.length > 0
          ? verdict.label
          : id;
      if (!order.has(id)) order.set(id, order.size);
      latest.set(id, {
        id,
        label,
        status,
        reason: status === 'passed' ? '' : deriveReason(verdict),
      });
    }
  }

  // Reconstruir el array en orden de primera-aparición.
  const criteria = [...latest.values()].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  return {
    attempts: dodVerification.length,
    doomLoopKind,
    criteria,
  };
}
