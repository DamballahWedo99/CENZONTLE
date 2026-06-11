// Los controllers arrastran (vía sus services) la cadena agent-tools →
// code-repo-clone → @octokit/rest, que es ESM-only y Jest no transforma
// node_modules — stubs CJS como en diagram-generation.service.spec.ts.
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue({}),
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@cenzontle/shared';
import type { AuthenticatedUser } from '@cenzontle/shared';
import { EpicGenerationController } from './epics/generation/epic-generation.controller';
import { StoryGenerationController } from './stories/generation/story-generation.controller';
import { DiagramGenerationController } from './diagrams/generation/diagram-generation.controller';
import { createMockPinoLogger } from '../../common/testing/mock-pino-logger';

/**
 * BOLA / CWE-639 — unión EpicPod ∪ Story.podId en los checks de authz de los
 * agentes de generación IA.
 *
 * `Story.podId` es una relación independiente de la tabla join EpicPod en el
 * schema. Derivar los pods autorizados SOLO de EpicPod producía dos bugs
 * espejo según la semántica de la rama vacía de cada controller:
 *   - epic-generation (vacía → permitir): épicas sin filas EpicPod pero con
 *     historias con pod caían en "sin pods → permitir" — leak vía SSE a
 *     cualquier usuario con el permiso global.
 *   - story/diagram-generation (vacía → denegar): usuarios cuyo pod trabaja
 *     las historias de la épica quedaban bloqueados — falso negativo.
 *
 * Estos tests cubren la rama de unión en los 3 controllers replicados (el
 * cuarto, executive-summary, tiene la misma lógica validada por review).
 * Spec temático cross-módulo, mismo precedente que prompt-cache-fix.spec.ts.
 */

function makeUser(opts: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    sub: 'user-1',
    email: 'u@example.com',
    name: 'User One',
    role: UserRole.TechLead,
    podIds: [],
    ...opts,
  } as AuthenticatedUser;
}

type FindUniqueMock = jest.Mock;

function makePrismaMock(): { initiative: { findUnique: FindUniqueMock }; epic: { findUnique: FindUniqueMock } } {
  return {
    initiative: { findUnique: jest.fn() },
    epic: { findUnique: jest.fn() },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Los controllers se instancian con stubs `{} as any` para las dependencias
// que el método privado de authz no toca (generation service, caches,
// registry, logger) — mismo patrón que diagram-generation.service.spec.ts.

describe('EpicGenerationController.assertUserCanAccessInitiative — unión EpicPod ∪ Story.podId', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let controller: EpicGenerationController;

  const assertAccess = (user: AuthenticatedUser): Promise<void> =>
    (controller as any).assertUserCanAccessInitiative(user, 'init-1');

  beforeEach(() => {
    prisma = makePrismaMock();
    controller = new EpicGenerationController(
      {} as any,
      {} as any,
      prisma as any,
      {} as any,
      createMockPinoLogger() as any,
    );
  });

  it('AltaGerencia bypassa sin consultar la BD', async () => {
    await expect(assertAccess(makeUser({ role: UserRole.AltaGerencia }))).resolves.toBeUndefined();
    expect(prisma.initiative.findUnique).not.toHaveBeenCalled();
  });

  it('iniciativa inexistente → NotFoundException', async () => {
    prisma.initiative.findUnique.mockResolvedValue(null);
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).rejects.toThrow(NotFoundException);
  });

  it('LEAK CERRADO: épicas sin EpicPod pero historias con pod ajeno → Forbidden (antes del fix: permitía)', async () => {
    prisma.initiative.findUnique.mockResolvedValue({
      id: 'init-1',
      epics: [{ pods: [], stories: [{ podId: 'pod-b' }] }],
    });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).rejects.toThrow(ForbiddenException);
  });

  it('rama nueva: pod del user presente SOLO vía Story.podId → permite', async () => {
    prisma.initiative.findUnique.mockResolvedValue({
      id: 'init-1',
      epics: [{ pods: [], stories: [{ podId: 'pod-a' }] }],
    });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).resolves.toBeUndefined();
  });

  it('caso "primera épica" preservado: unión vacía → permite', async () => {
    prisma.initiative.findUnique.mockResolvedValue({ id: 'init-1', epics: [] });
    await expect(assertAccess(makeUser({ podIds: [] }))).resolves.toBeUndefined();

    prisma.initiative.findUnique.mockResolvedValue({
      id: 'init-1',
      epics: [{ pods: [], stories: [] }],
    });
    await expect(assertAccess(makeUser({ podIds: [] }))).resolves.toBeUndefined();
  });

  it('vía EpicPod sigue funcionando y la query selecciona ambas fuentes', async () => {
    prisma.initiative.findUnique.mockResolvedValue({
      id: 'init-1',
      epics: [{ pods: [{ podId: 'pod-a' }], stories: [] }],
    });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).resolves.toBeUndefined();

    // Regresión guard: si el select deja de traer stories, la unión queda coja
    const select = prisma.initiative.findUnique.mock.calls[0][0].select;
    expect(select.epics.select).toEqual(
      expect.objectContaining({
        pods: { select: { podId: true } },
        stories: { select: { podId: true } },
      }),
    );
  });
});

interface EpicScopedCase {
  name: string;
  build: (prisma: ReturnType<typeof makePrismaMock>) => { assertAccess: (user: AuthenticatedUser) => Promise<void> };
}

// story-generation y diagram-generation comparten semántica exacta del check
// (rama vacía → denegar) — se ejercitan con la misma batería parametrizada.
// OJO: el orden de constructor de DiagramGenerationController difiere
// (registry antes de prisma).
const EPIC_SCOPED_CONTROLLERS: EpicScopedCase[] = [
  {
    name: 'StoryGenerationController',
    build: (prisma) => {
      const controller = new StoryGenerationController(
        {} as any,
        {} as any,
        prisma as any,
        {} as any,
        createMockPinoLogger() as any,
      );
      return { assertAccess: (user) => (controller as any).assertUserCanAccessEpic(user, 'epic-1') };
    },
  },
  {
    name: 'DiagramGenerationController',
    build: (prisma) => {
      const controller = new DiagramGenerationController(
        {} as any,
        {} as any,
        {} as any,
        prisma as any,
        createMockPinoLogger() as any,
      );
      return { assertAccess: (user) => (controller as any).assertUserCanAccessEpic(user, 'epic-1') };
    },
  },
];

describe.each(EPIC_SCOPED_CONTROLLERS)('$name.assertUserCanAccessEpic — unión EpicPod ∪ Story.podId', ({ build }) => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let assertAccess: (user: AuthenticatedUser) => Promise<void>;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ assertAccess } = build(prisma));
  });

  it('AltaGerencia bypassa sin consultar la BD', async () => {
    await expect(assertAccess(makeUser({ role: UserRole.AltaGerencia }))).resolves.toBeUndefined();
    expect(prisma.epic.findUnique).not.toHaveBeenCalled();
  });

  it('épica inexistente → NotFoundException', async () => {
    prisma.epic.findUnique.mockResolvedValue(null);
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).rejects.toThrow(NotFoundException);
  });

  it('falso negativo corregido: pod del user presente SOLO vía Story.podId → permite (antes del fix: Forbidden)', async () => {
    prisma.epic.findUnique.mockResolvedValue({
      id: 'epic-1',
      pods: [],
      stories: [{ podId: 'pod-a' }],
    });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).resolves.toBeUndefined();
  });

  it('sin intersección con la unión → Forbidden', async () => {
    prisma.epic.findUnique.mockResolvedValue({
      id: 'epic-1',
      pods: [{ podId: 'pod-b' }],
      stories: [{ podId: 'pod-c' }],
    });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).rejects.toThrow(ForbiddenException);
  });

  it('rama vacía preservada (deny): épica sin pods en ninguna fuente → Forbidden', async () => {
    prisma.epic.findUnique.mockResolvedValue({ id: 'epic-1', pods: [], stories: [] });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).rejects.toThrow(ForbiddenException);
  });

  it('dedup: mismo pod en ambas fuentes cuenta una vez y permite', async () => {
    prisma.epic.findUnique.mockResolvedValue({
      id: 'epic-1',
      pods: [{ podId: 'pod-a' }],
      stories: [{ podId: 'pod-a' }, { podId: 'pod-a' }],
    });
    await expect(assertAccess(makeUser({ podIds: ['pod-a'] }))).resolves.toBeUndefined();
  });

  it('la query selecciona ambas fuentes de podIds', async () => {
    prisma.epic.findUnique.mockResolvedValue({ id: 'epic-1', pods: [{ podId: 'pod-a' }], stories: [] });
    await assertAccess(makeUser({ podIds: ['pod-a'] }));
    const select = prisma.epic.findUnique.mock.calls[0][0].select;
    expect(select).toEqual(
      expect.objectContaining({
        pods: { select: { podId: true } },
        stories: { select: { podId: true } },
      }),
    );
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
