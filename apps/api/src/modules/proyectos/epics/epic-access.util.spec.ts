import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import {
  assertUserCanAccessEpicPods,
  assertUserCanAccessStoryByEpic,
  assertUserCanAssignPods,
} from './epic-access.util';

function makeUser(opts: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    sub: 'user-1',
    email: 'u@example.com',
    role: UserRole.Viewer,
    podIds: [],
    ...opts,
  } as AuthenticatedUser;
}

describe('assertUserCanAccessEpicPods — BOLA on epic-scoped operations (CWE-639)', () => {
  it('AltaGerencia bypassa todos los checks', () => {
    const user = makeUser({ role: UserRole.AltaGerencia, podIds: [] });
    expect(() => assertUserCanAccessEpicPods(user, ['pod-x'])).not.toThrow();
    expect(() => assertUserCanAccessEpicPods(user, [])).not.toThrow();
  });

  it('TechLead con pod compartido tiene acceso', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a', 'pod-c'] });
    expect(() => assertUserCanAccessEpicPods(user, ['pod-a'])).not.toThrow();
    expect(() => assertUserCanAccessEpicPods(user, ['pod-b', 'pod-c'])).not.toThrow();
  });

  it('TechLead SIN pod compartido es rechazado (cross-pod BOLA)', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a'] });
    expect(() => assertUserCanAccessEpicPods(user, ['pod-b'])).toThrow(ForbiddenException);
    expect(() => assertUserCanAccessEpicPods(user, ['pod-b', 'pod-c'])).toThrow(
      ForbiddenException,
    );
  });

  it('épica huérfana (sin pods) es rechazada para no-admins', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a'] });
    expect(() => assertUserCanAccessEpicPods(user, [])).toThrow(ForbiddenException);
  });

  it('user sin podIds es rechazado salvo admin', () => {
    const user = makeUser({ role: UserRole.ProductOwner, podIds: [] });
    expect(() => assertUserCanAccessEpicPods(user, ['pod-a'])).toThrow(ForbiddenException);
  });

  it('rol QA sin pod compartido es rechazado', () => {
    const user = makeUser({ role: UserRole.QA, podIds: ['pod-a'] });
    expect(() => assertUserCanAccessEpicPods(user, ['pod-b'])).toThrow(ForbiddenException);
  });

  it('rol Viewer con pod compartido NO es bloqueado por este helper (las restricciones de viewer las aplica @Permissions)', () => {
    // Este helper sólo valida pod intersection — el `@Permissions(EDIT_EPIC)`
    // del controller filtra los roles. Si Viewer llegó hasta acá es porque
    // el rol-level guard ya lo permitió (caso teórico). Resultado esperado:
    // helper pasa porque comparte pod.
    const user = makeUser({ role: UserRole.Viewer, podIds: ['pod-a'] });
    expect(() => assertUserCanAccessEpicPods(user, ['pod-a'])).not.toThrow();
  });
});

describe('assertUserCanAccessStoryByEpic — BOLA on story-scoped operations', () => {
  it('AltaGerencia bypassa todos los checks', () => {
    const user = makeUser({ role: UserRole.AltaGerencia, podIds: [] });
    expect(() =>
      assertUserCanAccessStoryByEpic(user, { epicPodIds: ['pod-x'], storyPodId: 'pod-y' }),
    ).not.toThrow();
  });

  it('user comparte pod con la épica padre (storyPodId distinto) → permite', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a'] });
    expect(() =>
      assertUserCanAccessStoryByEpic(user, { epicPodIds: ['pod-a'], storyPodId: 'pod-z' }),
    ).not.toThrow();
  });

  it('user comparte el storyPodId pero NO los epicPodIds → permite (caso transferencia)', () => {
    const user = makeUser({ role: UserRole.ProductOwner, podIds: ['pod-z'] });
    expect(() =>
      assertUserCanAccessStoryByEpic(user, { epicPodIds: ['pod-a'], storyPodId: 'pod-z' }),
    ).not.toThrow();
  });

  it('cross-pod (sin overlap en epic NI en story) → rechaza', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a'] });
    expect(() =>
      assertUserCanAccessStoryByEpic(user, { epicPodIds: ['pod-b'], storyPodId: 'pod-c' }),
    ).toThrow(ForbiddenException);
  });

  it('historia y épica sin pods → rechaza no-admins (fail-closed)', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a'] });
    expect(() =>
      assertUserCanAccessStoryByEpic(user, { epicPodIds: [], storyPodId: null }),
    ).toThrow(ForbiddenException);
  });

  it('storyPodId nulo + user comparte pod del epic → permite', () => {
    const user = makeUser({ role: UserRole.QA, podIds: ['pod-a'] });
    expect(() =>
      assertUserCanAccessStoryByEpic(user, { epicPodIds: ['pod-a'], storyPodId: null }),
    ).not.toThrow();
  });
});

describe('assertUserCanAssignPods — BOLA on create/reassign (CWE-639), SUBSET semantics', () => {
  it('AltaGerencia puede asignar cualquier pod', () => {
    const user = makeUser({ role: UserRole.AltaGerencia, podIds: [] });
    expect(() => assertUserCanAssignPods(user, ['pod-x', 'pod-y'])).not.toThrow();
  });

  it('podIds vacío → permitido (sin escalación cross-pod)', () => {
    const user = makeUser({ role: UserRole.ProductOwner, podIds: [] });
    expect(() => assertUserCanAssignPods(user, [])).not.toThrow();
  });

  it('asignar solo pods propios → permitido', () => {
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a', 'pod-b'] });
    expect(() => assertUserCanAssignPods(user, ['pod-a'])).not.toThrow();
    expect(() => assertUserCanAssignPods(user, ['pod-a', 'pod-b'])).not.toThrow();
  });

  it('asignar un pod AJENO → rechazado (exploit original)', () => {
    const user = makeUser({ role: UserRole.ProductOwner, podIds: ['pod-a'] });
    expect(() => assertUserCanAssignPods(user, ['pod-b'])).toThrow(ForbiddenException);
  });

  it('caso MIXTO propio + ajeno → rechazado (la intersección lo dejaría pasar; el subconjunto NO)', () => {
    // Este es el corazón del fix: si alguien "simplifica" a intersección en el
    // futuro, este test rompe y reabre la vuln.
    const user = makeUser({ role: UserRole.TechLead, podIds: ['pod-a'] });
    expect(() => assertUserCanAssignPods(user, ['pod-a', 'pod-b'])).toThrow(
      ForbiddenException,
    );
  });

  it('user sin podIds intentando asignar un pod → rechazado', () => {
    const user = makeUser({ role: UserRole.ProductOwner, podIds: [] });
    expect(() => assertUserCanAssignPods(user, ['pod-a'])).toThrow(ForbiddenException);
  });
});
