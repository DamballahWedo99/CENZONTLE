import { AgentTokenSettingsService } from './agent-token-settings.service';
import { createMockPinoLogger } from '../../common/testing/mock-pino-logger';

/**
 * Mock mínimo del PrismaService — solo los métodos que el service usa.
 * Refactor v2: campos `*Thinking: number` reemplazados por `*Effort: string`
 * (low|medium|high) tras la migración a adaptive thinking + effort levels.
 */
function makeMockPrisma(initialRow?: Partial<Record<string, unknown>>) {
  const row = {
    id: 'singleton',
    storyPoModel: 'claude-sonnet-4-6',
    storyPoEffort: 'high',
    storyPoMaxTokens: 28000,
    storyPoThinkingEnabled: true,
    storyTlModel: 'claude-sonnet-4-6',
    storyTlEffort: 'high',
    storyTlMaxTokens: 44000,
    storyTlThinkingEnabled: true,
    storyQaModel: 'claude-sonnet-4-6',
    storyQaEffort: 'high',
    storyQaMaxTokens: 44000,
    storyQaThinkingEnabled: true,
    epicModel: 'claude-sonnet-4-6',
    epicEffort: 'high',
    epicMaxTokens: 64000,
    epicThinkingEnabled: true,
    diagramModel: 'claude-sonnet-4-6',
    diagramEffort: 'high',
    diagramMaxTokens: 64000,
    diagramThinkingEnabled: true,
    // Assistant (chatbot lateral de edición) — defaults alineados con schema.
    assistantModel: 'claude-sonnet-4-6',
    assistantEffort: 'medium',
    assistantMaxTokens: 32000,
    assistantThinkingEnabled: true,
    // Forge Worker (coder agent CLI) — defaults alineados con schema.
    forgeWorkerModel: 'claude-sonnet-4-6',
    forgeWorkerEffort: 'high',
    forgeWorkerMaxRunDurationMs: 1_800_000, // 30 min (default schema)
    // DoD Verifier (reviewer agent CLI) — defaults.
    dodVerifierModel: 'claude-haiku-4-5-20251001',
    dodVerifierEffort: 'low',
    dodMaxAttempts: 1,
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
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

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
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const settings = await service.get();
      expect(settings.storyPoEffort).toBe('medium');
    });
  });

  describe('update()', () => {
    it('aplica patch de effort dentro de transacción Serializable', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

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
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      await expect(
        service.update({ storyPoEffort: 'low' }, 'user-123'),
      ).rejects.toThrow(/Conflicto de concurrencia/);
    });

    it('toggle enabled=false se persiste y se devuelve por los helpers', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      await service.update({ diagramThinkingEnabled: false }, 'user-123');

      const result = await service.getDiagram();
      expect(result.enabled).toBe(false);
      expect(result.effort).toBe('high');
      expect(result.maxTokens).toBe(64000);
    });

    it('invalida cache tras update — siguiente get() ve los nuevos valores', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const before = await service.get();
      expect(before.diagramEffort).toBe('high');

      await service.update({ diagramEffort: 'low' }, 'user-123');

      const after = await service.get();
      expect(after.diagramEffort).toBe('low');
    });
  });

  describe('helpers tipados', () => {
    it('getStoryPo/Tl/Qa devuelven { model, effort, maxTokens, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      expect(await service.getStoryPo()).toEqual({ model: 'claude-sonnet-4-6', effort: 'high', maxTokens: 28000, enabled: true });
      expect(await service.getStoryTl()).toEqual({ model: 'claude-sonnet-4-6', effort: 'high', maxTokens: 44000, enabled: true });
      expect(await service.getStoryQa()).toEqual({ model: 'claude-sonnet-4-6', effort: 'high', maxTokens: 44000, enabled: true });
    });

    it('getEpic devuelve { model, effort, maxTokensCap, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      expect(await service.getEpic()).toEqual({ model: 'claude-sonnet-4-6', effort: 'high', maxTokensCap: 64000, enabled: true });
    });

    it('getDiagram devuelve { model, effort, maxTokens, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      expect(await service.getDiagram()).toEqual({ model: 'claude-sonnet-4-6', effort: 'high', maxTokens: 64000, enabled: true });
    });

    it('getAssistant devuelve { model, effort, maxTokens, enabled }', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      expect(await service.getAssistant()).toEqual({ model: 'claude-sonnet-4-6', effort: 'medium', maxTokens: 32000, enabled: true });
    });

    it('getStoryPo: model fuera de whitelist (BD legacy) cae al default Sonnet 4.6', async () => {
      const prisma = makeMockPrisma({ storyPoModel: 'claude-haiku-4-5-20251001' });
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      expect((await service.getStoryPo()).model).toBe('claude-sonnet-4-6');
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // forgeWorkerMaxRunDurationMs — wall-clock timeout del worker
  // ═════════════════════════════════════════════════════════════════════
  //
  // Cubre los 4 invariantes críticos del campo:
  //   1. Default 30 min (1_800_000) cuando no se patchea
  //   2. update() aplica el valor sin distorsionar
  //   3. toPublic() clampea valores fuera del rango [300_000, 7_200_000]
  //   4. toPublic() restaura default si row tiene 0/negativo (defensa
  //      contra basura legacy en BD post-migration o downgrade roto)
  //   5. getForgeWorker() incluye maxRunDurationMs en el objeto retornado
  // ═════════════════════════════════════════════════════════════════════
  describe('forgeWorkerMaxRunDurationMs (worker timeout)', () => {
    it('default es 1_800_000 (30 min) cuando no se patchea', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const settings = await service.get();
      expect(settings.forgeWorkerMaxRunDurationMs).toBe(1_800_000);
    });

    it('update() aplica un valor válido dentro del rango', async () => {
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const updated = await service.update(
        { forgeWorkerMaxRunDurationMs: 3_600_000 }, // 60 min
        'user-123',
      );
      expect(updated.forgeWorkerMaxRunDurationMs).toBe(3_600_000);
    });

    it('toPublic clampea valores debajo del MIN (300_000 / 5 min)', async () => {
      // Defense in depth: si la BD tiene basura (e.g. 60000 = 1 min, valor
      // pre-migration sin DEFAULT, o downgrade roto que dejó valor inválido),
      // el mapper sube al MIN del bounds. NO permite valores menores a 5 min.
      const prisma = makeMockPrisma({ forgeWorkerMaxRunDurationMs: 60_000 }); // 1 min
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const settings = await service.get();
      expect(settings.forgeWorkerMaxRunDurationMs).toBe(300_000);
    });

    it('toPublic clampea valores arriba del MAX (7_200_000 / 2 h)', async () => {
      // Si la BD tiene un valor absurdo (10h), el mapper baja al MAX. Esto
      // protege contra runaway costs si alguien mete por SQL un valor enorme.
      const prisma = makeMockPrisma({ forgeWorkerMaxRunDurationMs: 36_000_000 }); // 10 h
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const settings = await service.get();
      expect(settings.forgeWorkerMaxRunDurationMs).toBe(7_200_000);
    });

    it('toPublic restaura default (1_800_000) si row tiene 0', async () => {
      // Si la columna existe pero tiene 0 (valor falsy), el código asume
      // "valor inválido / no inicializado" y restaura al default del schema.
      const prisma = makeMockPrisma({ forgeWorkerMaxRunDurationMs: 0 });
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const settings = await service.get();
      expect(settings.forgeWorkerMaxRunDurationMs).toBe(1_800_000);
    });

    it('toPublic restaura default si row tiene valor negativo', async () => {
      // Negativo es claramente basura (probablemente cast erróneo de UI o
      // SQL injection roto). El mapper lo descarta y aplica el default.
      const prisma = makeMockPrisma({ forgeWorkerMaxRunDurationMs: -500 });
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const settings = await service.get();
      expect(settings.forgeWorkerMaxRunDurationMs).toBe(1_800_000);
    });

    it('getForgeWorker() incluye maxRunDurationMs alineado con el row', async () => {
      const prisma = makeMockPrisma({ forgeWorkerMaxRunDurationMs: 5_400_000 }); // 90 min
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const cfg = await service.getForgeWorker();
      expect(cfg).toEqual({
        model: 'claude-sonnet-4-6',
        effort: 'high',
        maxRunDurationMs: 5_400_000,
      });
    });

    it('getForgeWorker() retorna el valor CLAMPEADO cuando la BD tiene basura', async () => {
      // E2E del clamp: si la BD tiene 100ms (basura), el cliente (worker)
      // recibe MIN (300_000), NO el valor crudo. Defense in depth garantiza
      // que el worker NUNCA reciba un timeout absurdo.
      const prisma = makeMockPrisma({ forgeWorkerMaxRunDurationMs: 100 });
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const cfg = await service.getForgeWorker();
      expect(cfg.maxRunDurationMs).toBe(300_000);
    });

    it('update + getForgeWorker round-trip preserva el valor', async () => {
      // Confirma que la cache invalidation tras update funciona también
      // para este campo (no quedó cacheado el valor viejo).
      const prisma = makeMockPrisma();
      const service = new AgentTokenSettingsService(prisma, createMockPinoLogger());

      const before = await service.getForgeWorker();
      expect(before.maxRunDurationMs).toBe(1_800_000);

      await service.update({ forgeWorkerMaxRunDurationMs: 3_600_000 }, 'user-123');

      const after = await service.getForgeWorker();
      expect(after.maxRunDurationMs).toBe(3_600_000);
    });
  });
});
