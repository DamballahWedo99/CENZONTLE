// ════════════════════════════════════════════════════════════════════════
// secret-deps.ts — clasificación de dependencias de credenciales
// ════════════════════════════════════════════════════════════════════════
//
// Lógica pura extraída de `materializeClaim` (agent-run.service.ts) para que
// el gate de credenciales bloqueantes sea unit-testeable sin levantar el
// claim entero — mismo patrón que `queue/run-stats.ts`.

/** Subset de `StoryTechnicalDependency` relevante para el gate de credenciales. */
export interface SecretDepInput {
  title: string;
  vendor: string | null;
  requiresCredential: boolean;
  isBlocking: boolean;
  linkedSecretId: string | null;
}

/** Una dep que requiere credencial y todavía no la tiene vinculada. */
export interface SecretDepGap {
  vendor: string | null;
  title: string;
}

export interface SecretDepClassification {
  /** Gaps BLOQUEANTES: el claim debe rechazarse, la historia escala a `blocked`. */
  blockingGaps: SecretDepGap[];
  /** Gaps NO bloqueantes: el claim procede; el caller solo loguea una advertencia. */
  nonBlockingGaps: SecretDepGap[];
}

/**
 * Clasifica las `StoryTechnicalDependency` de una historia respecto a
 * credenciales faltantes.
 *
 * Una dep es un "gap" si `requiresCredential === true` y `linkedSecretId`
 * es `null` — requiere una credencial que el operador todavía no vinculó a
 * un `ExternalSecret`. Los gaps se parten por `isBlocking`:
 *  - `isBlocking` → `blockingGaps`: el claim se rechaza y la historia pasa a
 *    `blocked` — el agente no puede implementar (ni el verifier testear)
 *    contra una credencial inexistente.
 *  - no bloqueante → `nonBlockingGaps`: el claim procede; el caller solo
 *    deja un log de advertencia.
 *
 * Deps sin `requiresCredential`, o ya vinculadas (`linkedSecretId != null`),
 * se ignoran — no son gaps.
 */
export function classifySecretDependencies(
  deps: SecretDepInput[],
): SecretDepClassification {
  const blockingGaps: SecretDepGap[] = [];
  const nonBlockingGaps: SecretDepGap[] = [];
  for (const dep of deps) {
    // Solo interesan deps que requieren credencial y NO la tienen vinculada.
    if (!dep.requiresCredential || dep.linkedSecretId != null) continue;
    const gap: SecretDepGap = { vendor: dep.vendor, title: dep.title };
    if (dep.isBlocking) {
      blockingGaps.push(gap);
    } else {
      nonBlockingGaps.push(gap);
    }
  }
  return { blockingGaps, nonBlockingGaps };
}
