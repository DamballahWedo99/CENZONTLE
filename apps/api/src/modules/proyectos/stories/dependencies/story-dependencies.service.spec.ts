/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests para `StoryDependenciesService`. Foco en los paths que el
 * adversarial QA review marcó como gaps:
 *
 *   - IDOR scope (update/remove rechazan si la dep no pertenece a la story)
 *   - Validación de fecha estricta (rechaza "2026", "garbage", "")
 *   - linkedSecretId existence check
 *   - remove idempotency (deleteMany count=0 → 404, no 500)
 *   - findByEpic devuelve [] cuando no hay deps
 *
 * Estrategia: mockear `PrismaService` con stubs jest.fn() — el service no
 * tiene otras deps inyectadas. Las queries devuelven shapes mínimos
 * compatibles con `toResponse`.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryDependenciesService } from './story-dependencies.service';
import type { CreateStoryDependencyDto } from './dto/create-story-dependency.dto';

// Helper: row mínimo válido para el toResponse mapper.
function makeRow(overrides: Partial<any> = {}): any {
  return {
    id: 'dep-1',
    storyId: 'story-1',
    title: 'Stripe API key',
    description: '',
    category: 'secrets',
    severity: 'medium',
    source: 'manual',
    vendor: null,
    requiresCredential: false,
    linkedSecretId: null,
    isBlocking: false,
    targetExternalName: null,
    targetEpicId: null,
    status: 'identified',
    owner: '',
    dueDate: null,
    resolutionNotes: '',
    mdContent: null,
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-25T00:00:00.000Z'),
    ...overrides,
  };
}

function makePrismaStub() {
  return {
    storyTechnicalDependency: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    story: {
      findUnique: jest.fn(),
    },
    externalSecret: {
      findUnique: jest.fn(),
    },
  };
}

function createService(prisma = makePrismaStub()) {
  const service = new StoryDependenciesService(prisma as any);
  return { service, prisma };
}

const baseDto: CreateStoryDependencyDto = {
  title: 'Stripe API key',
  category: 'secrets',
};

describe('StoryDependenciesService', () => {
  describe('findByStory', () => {
    it('returns deps for the given story', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findMany.mockResolvedValue([
        makeRow({ id: 'dep-1' }),
        makeRow({ id: 'dep-2' }),
      ]);

      const result = await service.findByStory('story-1');

      expect(prisma.storyTechnicalDependency.findMany).toHaveBeenCalledWith({
        where: { storyId: 'story-1' },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'dep-1', storyId: 'story-1' });
    });

    it('returns empty array when story has no deps', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findMany.mockResolvedValue([]);

      const result = await service.findByStory('empty-story');

      expect(result).toEqual([]);
    });
  });

  describe('findByEpic (rollup)', () => {
    it('uses Prisma relation filter to scope by epic', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findMany.mockResolvedValue([makeRow()]);

      await service.findByEpic('epic-1');

      expect(prisma.storyTechnicalDependency.findMany).toHaveBeenCalledWith({
        where: { story: { epicId: 'epic-1' } },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      });
    });

    it('returns [] for non-existent epic without throwing', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findMany.mockResolvedValue([]);

      const result = await service.findByEpic('does-not-exist');

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('throws NotFound when story does not exist', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.create('missing-story', baseDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.storyTechnicalDependency.create).not.toHaveBeenCalled();
    });

    it('persists dep with defaults applied for omitted fields', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      prisma.storyTechnicalDependency.create.mockResolvedValue(makeRow());

      await service.create('story-1', baseDto);

      const args = prisma.storyTechnicalDependency.create.mock.calls[0]?.[0];
      expect(args.data).toMatchObject({
        storyId: 'story-1',
        title: 'Stripe API key',
        category: 'secrets',
        severity: 'medium',
        source: 'manual',
        status: 'identified',
        requiresCredential: false,
        isBlocking: false,
      });
    });

    it('rejects when linkedSecretId points to non-existent secret', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      prisma.externalSecret.findUnique.mockResolvedValue(null);

      await expect(
        service.create('story-1', { ...baseDto, linkedSecretId: 'fake-uuid' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.storyTechnicalDependency.create).not.toHaveBeenCalled();
    });

    it('accepts linkedSecretId when secret exists', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      prisma.externalSecret.findUnique.mockResolvedValue({ id: 'secret-1' });
      prisma.storyTechnicalDependency.create.mockResolvedValue(
        makeRow({ linkedSecretId: 'secret-1' }),
      );

      const result = await service.create('story-1', {
        ...baseDto,
        linkedSecretId: 'secret-1',
      });

      expect(result.linkedSecretId).toBe('secret-1');
    });

    it('rejects malformed dueDate (year only)', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });

      await expect(
        service.create('story-1', { ...baseDto, dueDate: '2026' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects garbage dueDate', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });

      await expect(
        service.create('story-1', { ...baseDto, dueDate: 'garbage' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts ISO date YYYY-MM-DD', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      prisma.storyTechnicalDependency.create.mockResolvedValue(
        makeRow({ dueDate: new Date('2026-06-30T00:00:00.000Z') }),
      );

      await service.create('story-1', { ...baseDto, dueDate: '2026-06-30' });

      const args = prisma.storyTechnicalDependency.create.mock.calls[0]?.[0];
      expect(args.data.dueDate).toBeInstanceOf(Date);
    });
  });

  describe('update — IDOR scope', () => {
    it('throws NotFound when dep belongs to a different story', async () => {
      const { service, prisma } = createService();
      // Dep existe pero pertenece a story-other, no a story-1.
      prisma.storyTechnicalDependency.findUnique.mockResolvedValue(
        makeRow({ id: 'dep-1', storyId: 'story-other' }),
      );

      await expect(
        service.update('story-1', 'dep-1', { title: 'hijack' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.storyTechnicalDependency.update).not.toHaveBeenCalled();
    });

    it('throws NotFound when dep does not exist', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findUnique.mockResolvedValue(null);

      await expect(
        service.update('story-1', 'missing-dep', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates only the fields present in dto', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findUnique.mockResolvedValue(
        makeRow({ id: 'dep-1', storyId: 'story-1' }),
      );
      prisma.storyTechnicalDependency.update.mockResolvedValue(
        makeRow({ id: 'dep-1', storyId: 'story-1', title: 'Updated' }),
      );

      await service.update('story-1', 'dep-1', { title: 'Updated' });

      const args = prisma.storyTechnicalDependency.update.mock.calls[0]?.[0];
      expect(args.data).toEqual({ title: 'Updated' });
      // Otros campos no se incluyen — el spread condicional los omite.
      expect(args.data.severity).toBeUndefined();
    });

    it('validates linkedSecretId on update', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.findUnique.mockResolvedValue(
        makeRow({ id: 'dep-1', storyId: 'story-1' }),
      );
      prisma.externalSecret.findUnique.mockResolvedValue(null);

      await expect(
        service.update('story-1', 'dep-1', { linkedSecretId: 'nope' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove — idempotency + IDOR', () => {
    it('returns 404 when dep does not exist (count=0)', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('story-1', 'missing-dep')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 when dep belongs to different story (IDOR)', async () => {
      const { service, prisma } = createService();
      // deleteMany filtra por id+storyId; con story incorrecta devuelve count=0.
      prisma.storyTechnicalDependency.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('wrong-story', 'dep-1')).rejects.toThrow(
        NotFoundException,
      );
      const args = prisma.storyTechnicalDependency.deleteMany.mock.calls[0]?.[0];
      expect(args.where).toEqual({ id: 'dep-1', storyId: 'wrong-story' });
    });

    it('handles concurrent double-delete idempotently', async () => {
      const { service, prisma } = createService();
      prisma.storyTechnicalDependency.deleteMany
        .mockResolvedValueOnce({ count: 1 }) // primera request: borra
        .mockResolvedValueOnce({ count: 0 }); // segunda request: ya no existe

      await expect(
        service.remove('story-1', 'dep-1'),
      ).resolves.toBeUndefined();
      await expect(service.remove('story-1', 'dep-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('linkedSecretId — Prisma malformed UUID', () => {
    it('maps Prisma P2023 to BadRequestException', async () => {
      const { service, prisma } = createService();
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'malformed UUID',
        { code: 'P2023', clientVersion: '7.0.0' },
      );
      prisma.externalSecret.findUnique.mockRejectedValue(prismaError);

      await expect(
        service.create('story-1', {
          ...baseDto,
          linkedSecretId: 'not-a-uuid',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
