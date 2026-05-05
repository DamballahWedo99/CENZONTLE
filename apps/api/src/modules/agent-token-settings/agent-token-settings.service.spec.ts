import { AgentTokenSettingsService } from './agent-token-settings.service';

/**
 * Mock mínimo del PrismaService — solo los métodos que el service usa.
 * Refactor v2: campos `*Thinking: number` reemplazados por `*Effort: string`
 * (low|medium|high) tras la migración a adaptive thinking + effort levels.
 */
function makeMockPrisma(initialRow?: Partial<Record<string, unknown>>) {
  const row = {
    id: 'singleton',
    storyPoEffort: 'high',
    storyPoMaxTokens: 28000,
    storyPoThinkingEnabled: true,
    storyTlEffort: 'high',
    storyTlMaxTokens: 44000,
    storyTlThinkingEnabled: true,
    storyQaEffort: 'high',
    storyQaMaxTokens: 44000,
    storyQaThinkingEnabled: true,
    epicEffort: 'high',
    epicMaxTokens: 64000,
    epicThinkingEnabled: true,
    diagramEffort: 'high',
    diagramMaxTokens: 64000,
    diagramThinkingEnabled: true,
    updatedAt: new Date('2026-04-28T00:00:00Z'),
    updatedBy: null,
    ...initialRow,
  };

  const tx = {
    agentTokenSettings: {
      upsert: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        row.updatedAt = new Date();
        return Promise.resolve(row);
      }),
    },
  };

  return {
    agentTokenSettings: tx.agentTokenSettings,
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _row: row,
  } as any;
}

describe('AgentTokenSettingsService', () => {
  describe('get()', () => {
    it('devuelve settings con shape público y cachea el resultado', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      const a = await service.get();
      const b = await service.get();

      expect(a).toEqual(b);
      expect(prisma.agentTokenSettings.upsert).toHaveBeenCalledTimes(1);
      expect(a.storyPoEffort).toBe('high');
      expect(a.diagramMaxTokens).toBe(64000);
    });

    it('defaults legacy/inválidos en BD se sanean a "medium"', async () => {
      // Cambio 2026-05-04: el fallback default cambió de 'high' a 'medium'
      // para balancear calidad vs costo de thinking tokens.
      const prisma = makeMockPrisma({ storyPoEffort: 'invalid_value' });
      const service = new AgentTokenSettingsService(prisma);

      const settings = await service.get();
      expect(settings.storyPoEffort).toBe('medium');
    });
  });

  describe('update()', () => {
    it('aplica patch de effort dentro de transacción Serializable', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      const updated = await service.update(
        { storyPoEffort: 'medium', storyPoMaxTokens: 30000 },
        'user-123',
      );

      expect(updated.storyPoEffort).toBe('medium');
      expect(updated.storyPoMaxTokens).toBe(30000);
      expect(updated.storyTlEffort).toBe('high');
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('mapea P2034 (Postgres SerializationError) a 400 con mensaje útil', async () => {
      const prisma = makeMockPrisma();
      prisma.$transaction = jest.fn().mockRejectedValue(
        Object.assign(new Error('serialize'), { code: 'P2034' }),
      );
      const service = new AgentTokenSettingsService(prisma);

      await expect(
        service.update({ storyPoEffort: 'low' }, 'user-123'),
      ).rejects.toThrow(/Conflicto de concurrencia/);
    });

    it('toggle enabled=false se persiste y se devuelve por los helpers', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      await service.update({ diagramThinkingEnabled: false }, 'user-123');

      const result = await service.getDiagram();
      expect(result.enabled).toBe(false);
      expect(result.effort).toBe('high');
      expect(result.maxTokens).toBe(64000);
    });

    it('invalida cache tras update — siguiente get() ve los nuevos valores', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      const before = await service.get();
      expect(before.diagramEffort).toBe('high');

      await service.update({ diagramEffort: 'low' }, 'user-123');

      const after = await service.get();
      expect(after.diagramEffort).toBe('low');
    });
  });

  describe('helpers tipados', () => {
    it('getStoryPo/Tl/Qa devuelven { effort, maxTokens, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      expect(await service.getStoryPo()).toEqual({ effort: 'high', maxTokens: 28000, enabled: true });
      expect(await service.getStoryTl()).toEqual({ effort: 'high', maxTokens: 44000, enabled: true });
      expect(await service.getStoryQa()).toEqual({ effort: 'high', maxTokens: 44000, enabled: true });
    });

    it('getEpic devuelve { effort, maxTokensCap, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      expect(await service.getEpic()).toEqual({ effort: 'high', maxTokensCap: 64000, enabled: true });
    });

    it('getDiagram devuelve { effort, maxTokens, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma);

      expect(await service.getDiagram()).toEqual({ effort: 'high', maxTokens: 64000, enabled: true });
    });
  });
});
