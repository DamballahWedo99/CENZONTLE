import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';

/**
 * Resource-scoped authz para épicas (CWE-639 / OWASP A01 BOLA).
 *
 * Política:
 *  - `AltaGerencia` siempre puede operar (admin bypass).
 *  - Cualquier otro rol debe compartir al menos un pod con la épica.
 *  - Épica sin pods asignados ⇒ Forbidden para no-admins (fail-closed; un
 *    epic huérfano no debería ser modificable por nadie sin acceso explícito).
 *
 * Uso típico: tras `prisma.epic.findUnique({ include: { pods: { select: { podId: true } } } })`,
 * llamar `assertUserCanAccessEpicPods(user, epic.pods.map(p => p.podId))` antes
 * de mutar el recurso. Mismo patrón que `publishToTracker` y el helper privado
 * de `DiagramGenerationController.assertUserCanAccessEpic`, pero como pure
 * function reutilizable y testeable sin mockear Prisma.
 */
export function assertUserCanAccessEpicPods(
  user: AuthenticatedUser,
  epicPodIds: readonly string[],
): void {
  if (user.role === UserRole.AltaGerencia) return;

  if (epicPodIds.length === 0) {
    throw new ForbiddenException('Sin acceso a esta épica');
  }

  const userPodIds = new Set(user.podIds ?? []);
  const sharesPod = epicPodIds.some((pid) => userPodIds.has(pid));
  if (!sharesPod) {
    throw new ForbiddenException('Sin acceso a esta épica');
  }
}

/**
 * Variant para historias: el set autorizado es la UNIÓN de los pods de la
 * épica padre + el `podId` propio de la historia. Mismo patrón que el
 * `publishToTracker` de `StoriesService`. Una historia puede tener un podId
 * que NO está en `epic.pods` (ej. transferencia entre pods sin actualizar la
 * relación del epic) — en ese caso el dueño actual sigue teniendo acceso.
 *
 * Uso: tras `prisma.story.findUnique({ include: { epic: { select: { pods: { select: { podId: true }}}}}})`,
 * llamar con `{ epicPodIds: story.epic.pods.map(p => p.podId), storyPodId: story.podId }`.
 */
export function assertUserCanAccessStoryByEpic(
  user: AuthenticatedUser,
  scope: { epicPodIds: readonly string[]; storyPodId?: string | null },
): void {
  if (user.role === UserRole.AltaGerencia) return;

  const allowed = new Set<string>(scope.epicPodIds);
  if (scope.storyPodId) allowed.add(scope.storyPodId);

  if (allowed.size === 0) {
    throw new ForbiddenException('Sin acceso a esta historia');
  }

  const userPodIds = new Set(user.podIds ?? []);
  const sharesPod = [...allowed].some((pid) => userPodIds.has(pid));
  if (!sharesPod) {
    throw new ForbiddenException('Sin acceso a esta historia');
  }
}
