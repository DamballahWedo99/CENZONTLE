/**
 * Tests del IntegrationsService — focus en las invariantes críticas:
 *   1) `saveLinearConfig` sin apiKey y sin config previa → 404.
 *   2) `saveLinearConfig` sin apiKey con config previa → preserva ciphertext
 *      (no rotación silenciosa).
 *   3) `saveLinearConfig` con apiKey → cifra y persiste apiKeyMasked
 *      precomputado (evita decrypt en hot path / CWE-316).
 *   4) `testLinearConnection` con apiKey transitoria → NO actualiza el
 *      `status` persistido (evita corrupción cross-user).
 *   5) `testLinearConnection` sin apiKey y sin config previa → falla legible.
 *   6) `toResponse` lee maskedKey persistido en vez de decifrar.
 */
jest.mock('@linear/sdk', () => ({ LinearClient: jest.fn() }));

import { IntegrationsService } from './integrations.service';
import { CryptoService } from '../vault/crypto.service';
import { NotFoundException } from '@nestjs/common';
import { createMockPinoLogger } from '../../common/testing/mock-pino-logger';

type MockPrisma = {
  integrationConfig: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

function buildMocks() {
  const prisma: MockPrisma = {
    integrationConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const crypto = {
    encrypt: jest.fn().mockReturnValue({
      ciphertext: 'CIPHER',
      iv: 'IV',
      authTag: 'TAG',
    }),
    decrypt: jest.fn().mockReturnValue('lin_api_decrypted_value'),
  };
  // El factory tiene métodos sync `buildEphemeral` y async `get`. Solo
  // necesitamos `buildEphemeral` para test de testLinearConnection.
  const factory = {
    get: jest.fn(),
    buildEphemeral: jest.fn().mockReturnValue({
      providerName: 'linear',
      testConnection: jest.fn().mockResolvedValue({ ok: true, details: {} }),
      publishEpic: jest.fn(),
      publishStory: jest.fn(),
    }),
  };
  const service = new IntegrationsService(prisma as any, crypto as any, factory as any, createMockPinoLogger());
  return { service, prisma, crypto, factory };
}

describe('IntegrationsService.saveLinearConfig', () => {
  const baseDto = {
    teamId: 'team-1',
    teamName: 'Eng',
    workspaceSlug: 'acme',
  };

  it('lanza NotFoundException si no hay apiKey y no existe config previa', async () => {
    const { service, prisma } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
    await expect(service.saveLinearConfig(baseDto as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.integrationConfig.upsert).not.toHaveBeenCalled();
  });

  it('preserva el ciphertext existente cuando se actualiza metadata sin apiKey', async () => {
    const { service, prisma, crypto } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      apiKeyCiphertext: 'OLD_CIPHER',
      apiKeyIv: 'OLD_IV',
      apiKeyAuthTag: 'OLD_TAG',
      apiKeyMasked: 'lin****old1',
      fieldMapping: {},
    });
    prisma.integrationConfig.upsert.mockResolvedValue({
      provider: 'linear',
      apiKeyMasked: 'lin****old1',
      metadata: {},
      status: 'connected',
      lastTestedAt: null,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: new Date('2026-04-25'),
    });

    await service.saveLinearConfig(baseDto as any);

    expect(crypto.encrypt).not.toHaveBeenCalled();
    const upsertArgs = prisma.integrationConfig.upsert.mock.calls[0][0];
    expect(upsertArgs.update.apiKeyCiphertext).toBe('OLD_CIPHER');
    expect(upsertArgs.update.apiKeyIv).toBe('OLD_IV');
    expect(upsertArgs.update.apiKeyAuthTag).toBe('OLD_TAG');
    expect(upsertArgs.update.apiKeyMasked).toBe('lin****old1');
  });

  it('cifra y persiste apiKeyMasked precomputado al rotar/crear apiKey', async () => {
    const { service, prisma, crypto } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
    prisma.integrationConfig.upsert.mockResolvedValue({
      provider: 'linear',
      apiKeyMasked: 'lin***123',
      metadata: {},
      status: 'disconnected',
      lastTestedAt: null,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: new Date(),
    });
    const maskSpy = jest.spyOn(CryptoService, 'mask').mockReturnValue('lin***456');

    await service.saveLinearConfig({
      ...baseDto,
      apiKey: 'lin_api_xxxxxx',
    } as any);

    expect(crypto.encrypt).toHaveBeenCalledWith('lin_api_xxxxxx');
    expect(maskSpy).toHaveBeenCalledWith('lin_api_xxxxxx');
    const upsertArgs = prisma.integrationConfig.upsert.mock.calls[0][0];
    expect(upsertArgs.create.apiKeyMasked).toBe('lin***456');
    expect(upsertArgs.create.apiKeyCiphertext).toBe('CIPHER');
    maskSpy.mockRestore();
  });

  it('no persiste apiKey en el JSONB metadata (stripSensitive)', async () => {
    const { service, prisma } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
    prisma.integrationConfig.upsert.mockResolvedValue({
      provider: 'linear',
      apiKeyMasked: '',
      metadata: {},
      status: 'disconnected',
      lastTestedAt: null,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: new Date(),
    });

    await service.saveLinearConfig({
      ...baseDto,
      apiKey: 'lin_api_xxxxxx',
    } as any);

    const upsertArgs = prisma.integrationConfig.upsert.mock.calls[0][0];
    expect((upsertArgs.create.metadata as any).apiKey).toBeUndefined();
  });
});

describe('IntegrationsService.testLinearConnection', () => {
  it('NO actualiza el status persistido cuando se pasa apiKey transitoria', async () => {
    const { service, prisma, factory } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      apiKeyCiphertext: 'C',
      apiKeyIv: 'I',
      apiKeyAuthTag: 'T',
      apiKeyMasked: 'lin****persisted',
      metadata: { teamId: 't', teamName: 'n', workspaceSlug: 'w' },
      status: 'connected',
    });
    factory.buildEphemeral.mockReturnValue({
      providerName: 'linear',
      testConnection: jest.fn().mockResolvedValue({ ok: false, error: 'wrong key' }),
      publishEpic: jest.fn(),
      publishStory: jest.fn(),
    });

    const result = await service.testLinearConnection({
      apiKey: 'lin_api_throwaway',
      teamId: 't',
      teamName: 'n',
      workspaceSlug: 'w',
    } as any);

    expect(result.ok).toBe(false);
    // Crítico: NO se llamó update — el status persistido sigue intacto.
    expect(prisma.integrationConfig.update).not.toHaveBeenCalled();
  });

  it('SÍ actualiza el status persistido cuando se re-valida sin apiKey transitoria', async () => {
    const { service, prisma, factory } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      apiKeyCiphertext: 'C',
      apiKeyIv: 'I',
      apiKeyAuthTag: 'T',
      apiKeyMasked: 'lin****persisted',
      metadata: { teamId: 't', teamName: 'n', workspaceSlug: 'w' },
      status: 'connected',
    });
    factory.buildEphemeral.mockReturnValue({
      providerName: 'linear',
      testConnection: jest.fn().mockResolvedValue({ ok: true, details: {} }),
      publishEpic: jest.fn(),
      publishStory: jest.fn(),
    });
    prisma.integrationConfig.update.mockResolvedValue({
      updatedAt: new Date('2026-04-25T12:00:00Z'),
    });

    await service.testLinearConnection({} as any);

    expect(prisma.integrationConfig.update).toHaveBeenCalledTimes(1);
    const data = prisma.integrationConfig.update.mock.calls[0][0].data;
    expect(data.status).toBe('connected');
    expect(data.lastError).toBeNull();
  });

  it('falla legiblemente cuando no hay apiKey ni config previa', async () => {
    const { service, prisma } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce(null);

    const result = await service.testLinearConnection({} as any);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Sin API key');
  });

  it('trunca lastError persistido a 200 chars (defensa info-disclosure)', async () => {
    const { service, prisma, factory } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      apiKeyCiphertext: 'C',
      apiKeyIv: 'I',
      apiKeyAuthTag: 'T',
      apiKeyMasked: 'm',
      metadata: { teamId: 't', teamName: 'n', workspaceSlug: 'w' },
      status: 'connected',
    });
    const huge = 'X'.repeat(5000);
    factory.buildEphemeral.mockReturnValue({
      providerName: 'linear',
      testConnection: jest.fn().mockResolvedValue({ ok: false, error: huge }),
      publishEpic: jest.fn(),
      publishStory: jest.fn(),
    });
    prisma.integrationConfig.update.mockResolvedValue({ updatedAt: new Date() });

    await service.testLinearConnection({} as any);

    const data = prisma.integrationConfig.update.mock.calls[0][0].data;
    expect(data.lastError.length).toBeLessThanOrEqual(200);
  });
});

describe('IntegrationsService.getConfigOrNull', () => {
  it('NO decifra plaintext en read — usa apiKeyMasked precomputado (CWE-316)', async () => {
    const { service, prisma, crypto } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      provider: 'linear',
      apiKeyMasked: 'lin****abc1',
      metadata: {},
      status: 'connected',
      lastTestedAt: new Date('2026-04-25'),
      lastSyncedAt: null,
      lastError: null,
      updatedAt: new Date('2026-04-25'),
    });

    const result = await service.getConfigOrNull('linear');

    expect(result?.maskedKey).toBe('lin****abc1');
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it('retorna null cuando no hay config persistida', async () => {
    const { service, prisma } = buildMocks();
    prisma.integrationConfig.findUnique.mockResolvedValueOnce(null);
    expect(await service.getConfigOrNull('linear')).toBeNull();
  });
});
