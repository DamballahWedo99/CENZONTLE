/**
 * Contrato compartido para la detección de "doom loop" del Tier 1 Harness.
 *
 * Background: el worker (apps/worker/src/lib/runner.ts) detecta dos clases de
 * fallo cuando el agente Claude Code intenta cumplir el DoD pero no avanza:
 *   - REGRESSION: passedCount efectivo BAJÓ entre attempts — el agente rompió
 *     criterios que antes pasaban (daño activo). Escalación inmediata sin
 *     grace period.
 *   - STAGNATION: passedCount efectivo NO aumentó — el agente está atorado
 *     en los mismos criterios fallidos. Escalación tras grace period.
 *
 * El worker setea `AgentRun.errorMessage` con el formato canónico definido
 * abajo. Múltiples consumidores leen ese campo para inferir el kind:
 *   - factory-queue.service.ts: extractFailureInfo para el dashboard merge view
 *   - (potencial) audit logs, alerting, retry policies
 *
 * Sin este módulo, cada consumidor tenía su propia regex con riesgo de
 * desincronización: cambiar el texto en runner.ts compila clean en el worker
 * pero rompe la detección en el queue service en producción, sin señal.
 *
 * Architecture-reviewer 2026-05-19 — extraído a shared como contrato
 * explícito tras flagging del coupling worker↔queue.
 */

export type DoomLoopKind = 'regression' | 'stagnation';

/**
 * Patrones de detección del `kind` en el `errorMessage` del AgentRun.
 *
 * IMPORTANTE: si el worker cambia el texto, actualizar esta constante en
 * el MISMO commit. El TypeScript type-checker NO atrapa la divergencia
 * porque ambos son strings.
 *
 * Acentos: incluimos forma con y sin tilde (REGRESIÓN/REGRESION,
 * ESTANCAMIENTO no necesita variante porque no tiene acento). Flag `i`
 * para case-insensitivity defensiva contra futuras ediciones del worker.
 */
export const DOOM_LOOP_PATTERNS: Record<DoomLoopKind, RegExp> = {
  regression: /REGRESIÓN|REGRESION/i,
  stagnation: /ESTANCAMIENTO/i,
};

/**
 * Detecta el kind de doom loop a partir del `errorMessage` de un AgentRun.
 * Devuelve null si el mensaje no matchea ningún patrón conocido (incluye
 * el caso `errorMessage === null`, runs que fallaron por razones distintas
 * a doom loop, etc).
 *
 * El orden de evaluación es regression-first, stagnation-second porque
 * una `regression` puede mencionar "estancamiento" tangencialmente; el
 * primer match gana.
 */
export function detectDoomLoopKind(
  errorMessage: string | null | undefined,
): DoomLoopKind | null {
  if (typeof errorMessage !== 'string' || errorMessage.length === 0) return null;
  if (DOOM_LOOP_PATTERNS.regression.test(errorMessage)) return 'regression';
  if (DOOM_LOOP_PATTERNS.stagnation.test(errorMessage)) return 'stagnation';
  return null;
}
