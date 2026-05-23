/**
 * Política PURA del DoD enforcement loop del Forge Worker.
 *
 * Este módulo aísla las DECISIONES del retry loop (cuántos attempts permite la
 * config, cuándo cortar por doom loop) del MECANISMO (spawn de claude, I/O,
 * red) que vive en `runner.ts`. Todo acá es determinístico y sin side-effects
 * → 100 % testeable en aislamiento (ver `dod-retry.test.ts`), sin stubs,
 * mocks, procesos hijo ni filesystem.
 *
 * ── Por qué separar policy de mechanism ─────────────────────────────────
 * `runStory()` es una función de ~2000 líneas que orquesta procesos, red y
 * disco. Su retry loop tenía la lógica del doom loop inline: imposible de
 * testear sin levantar todo el aparato. Extraer la policy a funciones puras
 * la vuelve verificable de forma exhaustiva y barata (un test del state
 * machine corre en microsegundos, no en segundos).
 *
 * ── Estrategia de observabilidad ────────────────────────────────────────
 * Las funciones de este módulo NO loguean — devuelven datos estructurados y
 * `runner.ts` (el orquestador) emite los eventos. Mantenerlas puras es
 * justamente lo que las hace testeables. Taxonomía de eventos del retry loop
 * (todos emitidos por `runner.ts`):
 *
 *   nivel   evento                   cuándo / para qué
 *   ─────   ──────────────────────   ──────────────────────────────────────
 *   debug   dod.turn.delta           delta de passedCount de CADA turno
 *                                    verificado — diagnóstico del doom loop
 *   info    dod.attempts.resolved    config del loop resuelta para el run
 *                                    (valor crudo del claim + resuelto +
 *                                    flag `clamped`)
 *   info    dod.retry                inicio de un attempt de retry (attempt>1)
 *   info    dod.retry.hard_error     retry tras crash / exit≠0 / timeout
 *   info    dod.retry.prompt_built   retry quirúrgico tras warns del DoD
 *   error   dod.doom_loop            2 turnos sin progreso → corte del run
 *
 * Regla de niveles: `debug` para el detalle por-turno (ruidoso en prod, oro
 * en una sesión de diagnóstico — se activa con `LOG_LEVEL=debug` o `--verbose`);
 * `info` para los hitos del ciclo de vida que un operador quiere ver siempre;
 * `error` solo para el corte duro que escala a humano.
 */

import type { DoomLoopKind } from '@cenzontle/shared';

// ═════════════════════════════════════════════════════════════════════════
// Resolución del tope de attempts (config `dodMaxAttempts`)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Tope de attempts cuando el claim NO trae `dodMaxAttempts` (claim de un
 * backend viejo durante un deploy parcial). 1 = una sola pasada, el
 * comportamiento conservador: sin retries no hay gasto extra de tokens ni
 * doom loop posible. Los retries son OPT-IN.
 */
export const DEFAULT_DOD_ATTEMPTS = 1;

/**
 * Bounds de clamp para `claimed.dodMaxAttempts`. El backend ya valida el
 * rango en el DTO (`@Min(1)` / `@Max(3)`), pero el worker re-clampea como
 * defensa-en-profundidad: un claim malformado nunca debe spawnear claude un
 * número arbitrario de veces. 3 es el techo — más que eso típicamente indica
 * un problema de spec, no de implementación, y mejor escalar a humano que
 * quemar tokens.
 */
export const MIN_DOD_ATTEMPTS = 1;
export const MAX_DOD_ATTEMPTS_CAP = 3;

/**
 * Resuelve el tope de attempts del DoD loop para ESTE run. Lee
 * `claimed.dodMaxAttempts` (configurado en AgentTokenSettings → tab Factory),
 * lo clampea a `[MIN_DOD_ATTEMPTS, MAX_DOD_ATTEMPTS_CAP]`, y cae a
 * `DEFAULT_DOD_ATTEMPTS` si el campo no vino o no es un número usable
 * (claim legacy / payload malformado: `undefined`, `NaN`, `±Infinity`).
 *
 * Los floats se TRUNCAN, no se redondean (`Math.trunc`): `2.9 → 2`. Un valor
 * fraccionario nunca debería llegar (el DTO valida `@IsInt`), pero truncar es
 * la defensa predecible.
 *
 * Función PURA — no loguea. `runner.ts` emite `dod.attempts.resolved` con el
 * valor crudo y el resuelto para que el operador vea si hubo clamp.
 */
export function resolveMaxDodAttempts(
  dodMaxAttempts: number | undefined,
): number {
  if (
    typeof dodMaxAttempts !== 'number' ||
    !Number.isFinite(dodMaxAttempts)
  ) {
    return DEFAULT_DOD_ATTEMPTS;
  }
  const truncated = Math.trunc(dodMaxAttempts);
  return Math.min(MAX_DOD_ATTEMPTS_CAP, Math.max(MIN_DOD_ATTEMPTS, truncated));
}

// ═════════════════════════════════════════════════════════════════════════
// Doom loop — máquina de estados pura
// ═════════════════════════════════════════════════════════════════════════

/**
 * Turnos malos CONSECUTIVOS que disparan el doom loop. Un "turno malo" es un
 * attempt verificado cuyo `passedCount` NO subió respecto del anterior. Al
 * llegar a este umbral, el agente está atorado: el run se corta y escala a
 * humano.
 *
 * Con `threshold = 2` hacen falta 2 comparaciones de `passedCount` → 3
 * attempts verificados para evaluar (con `cap = 3`, tras los attempts 2 y 3
 * malos). Con `cap <= 2` el doom loop nunca dispara; con `cap = 1` ni hay
 * loop. Es por diseño: el doom loop es una red de seguridad para configs con
 * retries altos, no un gate del happy path.
 */
export const DOOM_LOOP_THRESHOLD = 2;

/** Estado del doom loop que se acarrea entre turnos verificados del loop. */
export interface DoomLoopState {
  /**
   * `passedCount` del attempt verificado anterior; `null` hasta que haya un
   * primer turno verificado (sin baseline no se puede computar el delta).
   */
  previousPassedCount: number | null;
  /** Turnos consecutivos sin progreso (`delta <= 0`). */
  consecutiveBadTurns: number;
}

/** Estado inicial — antes del primer turno verificado del run. */
export const INITIAL_DOOM_LOOP_STATE: DoomLoopState = {
  previousPassedCount: null,
  consecutiveBadTurns: 0,
};

/**
 * Resultado de evaluar un turno verificado contra el estado del doom loop.
 *
 * Es una UNIÓN DISCRIMINADA por `doomLooped`: cuando `doomLooped` es `true`,
 * el type checker garantiza que `kind` es un `DoomLoopKind` (no `null`) y que
 * `delta` es un `number` (no `null`) — el doom loop solo dispara tras 2
 * turnos verificados, así que siempre hay baseline y delta. Esto vuelve
 * imposible representar un estado inválido (doom loop sin clase de fallo) y
 * `runner.ts` puede leer `kind` sin chequear null tras `if (doomLooped)`.
 */
export type DoomLoopEvaluation =
  | {
      /** Estado actualizado — pasarlo a la próxima llamada de `evaluateDoomLoop`. */
      state: DoomLoopState;
      /** El run sigue: no se detectó doom loop en este turno. */
      doomLooped: false;
      /** Sin doom loop → sin clase de fallo. */
      kind: null;
      /**
       * `passedCount` actual menos el del turno anterior; `null` en el primer
       * turno (sin baseline). Negativo = regresión, 0 = estancamiento,
       * positivo = progreso. `runner.ts` lo emite en `dod.turn.delta`.
       */
      delta: number | null;
    }
  | {
      /** Estado actualizado (el caller cortará el run, pero se mantiene por consistencia). */
      state: DoomLoopState;
      /** 2 turnos malos seguidos: `runner.ts` debe cortar el run. */
      doomLooped: true;
      /**
       * Clase del fallo. `'regression'` = el agente rompió criterios que
       * pasaban (`delta < 0`); `'stagnation'` = el agente no avanzó
       * (`delta === 0`). Lo decide el ÚLTIMO delta.
       */
      kind: DoomLoopKind;
      /** Delta del último turno — siempre `<= 0` cuando hay doom loop. */
      delta: number;
    };

/**
 * Evalúa un turno verificado del DoD loop contra el estado del doom loop.
 *
 * Reducer PURO: `(estado, passedCount) → evaluación`. No muta `prev`.
 *
 * Invariantes:
 *  - El primer turno (sin baseline) nunca dispara — solo fija el baseline.
 *  - Un turno con progreso (`delta > 0`) resetea el contador de turnos malos
 *    a 0: el doom loop exige turnos malos CONSECUTIVOS, no acumulados.
 *  - El nuevo `previousPassedCount` siempre es el `passedCount` recibido.
 *
 * @param prev        Estado acarreado del turno anterior.
 * @param passedCount Criterios DoD que pasaron en el attempt recién verificado.
 */
export function evaluateDoomLoop(
  prev: DoomLoopState,
  passedCount: number,
): DoomLoopEvaluation {
  // Primer turno verificado: sin baseline no hay delta. Solo se registra el
  // passedCount como baseline para el próximo turno.
  if (prev.previousPassedCount === null) {
    return {
      state: { previousPassedCount: passedCount, consecutiveBadTurns: 0 },
      doomLooped: false,
      kind: null,
      delta: null,
    };
  }

  const delta = passedCount - prev.previousPassedCount;
  const isBadTurn = delta <= 0;
  // Turno bueno (delta > 0) → la cadena de turnos malos se rompe (reset a 0).
  const consecutiveBadTurns = isBadTurn ? prev.consecutiveBadTurns + 1 : 0;
  const state: DoomLoopState = {
    previousPassedCount: passedCount,
    consecutiveBadTurns,
  };

  // 2 turnos malos consecutivos → doom loop. El kind lo decide el último
  // delta: regresión si bajó, estancamiento si quedó igual. Los returns por
  // rama (literal `true`/`false`) son lo que deja a TS estrechar la unión.
  if (consecutiveBadTurns >= DOOM_LOOP_THRESHOLD) {
    return {
      state,
      doomLooped: true,
      kind: delta < 0 ? 'regression' : 'stagnation',
      delta,
    };
  }

  return { state, doomLooped: false, kind: null, delta };
}
