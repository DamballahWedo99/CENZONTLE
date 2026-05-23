/**
 * Decisión pura: ¿se puede reintentar una story dado su estado actual?
 *
 * Extraída de `FactoryQueueService.retryStory` para ser unit-testeable sin
 * Prisma — mismo patrón que `gate-readiness.ts` y `failure-info.ts` en este
 * módulo (la orquestación con DB queda en el service; la decisión se testea
 * sola).
 *
 * El retry resetea la story a `backlog` + `claimedAt=null` para que el worker
 * la re-claim. Dos estados NO se reintentan:
 *  - `done`: terminal-exitoso — no hay nada que reintentar.
 *  - `backlog` sin claim (idle): ya está en cola esperando al worker; un retry
 *    sería un no-op que solo ensuciaría el changelog con una entrada fantasma
 *    `backlog → backlog`.
 *
 * El resto (`blocked`, `in_review`, `in_progress`, `qa`, `todo`, y `backlog`
 * YA claimeado) sí se reintenta — abandona el run/claim en vuelo y vuelve a
 * encolar la story.
 */
export interface StoryRetryability {
  /** true → la story se puede reintentar. */
  retryable: boolean;
  /** Mensaje listo para el ConflictException cuando retryable=false; null si retryable. */
  reason: string | null;
}

/**
 * @param status    El `Story.status` actual (StoryStatus — se acepta como
 *                   string para mantener la función libre de imports de Prisma).
 * @param claimedAt El `Story.claimedAt` actual — distingue `backlog` idle
 *                   (null → no reintentable) de `backlog` ya claimeado por un
 *                   worker (Date → reintentable, abandona el claim en vuelo).
 */
export function classifyStoryRetryability(
  status: string,
  claimedAt: Date | null,
): StoryRetryability {
  if (status === 'done') {
    return {
      retryable: false,
      reason: "La story ya está en 'done' — no hay nada que reintentar.",
    };
  }
  if (status === 'backlog' && claimedAt === null) {
    return {
      retryable: false,
      reason:
        'La story ya está en cola (backlog) esperando al worker — no necesita un retry.',
    };
  }
  return { retryable: true, reason: null };
}
