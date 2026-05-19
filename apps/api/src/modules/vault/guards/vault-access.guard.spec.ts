// Mock necesario: VaultConfigService importa Octokit (@octokit/rest), que es
// ESM y rompe el parser de Jest. jest.mock SIN factory hace auto-mock que aún
// carga el módulo real (y por ende el import de Octokit), reventando el spec.
// Con factory NO se carga el archivo — sustituimos el módulo entero por un stub.
// Los tests inyectan su mock concreto vía constructor.
jest.mock('../vault-config.service', () => ({
  VaultConfigService: jest.fn(),
}));

import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { VaultAccessGuard } from './vault-access.guard';
import { VaultConfigService } from '../vault-config.service';
import { createMockPinoLogger } from '../../../common/testing/mock-pino-logger';

type VaultPublic = {
  id: string;
  name: string;
  isActive: boolean;
  allowedPodIds: string[];
  roleDefaults: Record<string, string>;
};

const VAULT_A: VaultPublic = {
  id: 'vault-a',
  name: 'Vault A',
  isActive: true,
  allowedPodIds: ['pod-a'],
  roleDefaults: {},
};

const VAULT_B: VaultPublic = {
  id: 'vault-b',
  name: 'Vault B',
  isActive: false,
  allowedPodIds: ['pod-b'],
  roleDefaults: {},
};

function makeContext(opts: {
  user?: Partial<AuthenticatedUser>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): ExecutionContext {
  const request = {
    user: opts.user
      ? ({
          sub: 'user-1',
          email: 'u@example.com',
          role: UserRole.Viewer,
          podIds: [],
          ...opts.user,
        } as AuthenticatedUser)
      : undefined,
    query: opts.query ?? {},
    body: opts.body ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('VaultAccessGuard — BOLA cross-vault (CWE-639)', () => {
  let guard: VaultAccessGuard;
  let mockConfigs: { findAll: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    mockConfigs = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };
    guard = new VaultAccessGuard(mockConfigs as unknown as VaultConfigService, createMockPinoLogger());
  });

  it('permite acceso al vault activo cuando user tiene pod permitido', async () => {
    mockConfigs.findAll.mockResolvedValue([VAULT_A]);

    const ctx = makeContext({
      user: { role: UserRole.Viewer, podIds: ['pod-a'] },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockConfigs.findOne).not.toHaveBeenCalled();
  });

  it('DENIEGA cross-vault: user con acceso al activo (A) NO puede pasar ?vaultId=<B>', async () => {
    // Sin el fix, el guard validaba contra vault-a (passing) y la operación
    // se ejecutaba sobre vault-b vía `?vaultId=vault-b` — leak/destruct
    // cross-vault. El fix valida contra el TARGET vault.
    mockConfigs.findOne.mockResolvedValue(VAULT_B);

    const ctx = makeContext({
      user: { role: UserRole.Viewer, podIds: ['pod-a'] },
      query: { vaultId: 'vault-b' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(mockConfigs.findOne).toHaveBeenCalledWith('vault-b');
    expect(mockConfigs.findAll).not.toHaveBeenCalled();
  });

  it('permite cross-vault legítimo: user con pod en el TARGET vault', async () => {
    mockConfigs.findOne.mockResolvedValue(VAULT_B);

    const ctx = makeContext({
      user: { role: UserRole.Viewer, podIds: ['pod-b'] },
      query: { vaultId: 'vault-b' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('vaultId inexistente devuelve Forbidden (no NotFound — no filtrar existencia)', async () => {
    mockConfigs.findOne.mockRejectedValue(new NotFoundException('Vault no encontrado'));

    const ctx = makeContext({
      user: { role: UserRole.Viewer, podIds: ['pod-a'] },
      query: { vaultId: 'vault-does-not-exist' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('roleDefaults del TARGET vault aplican, no del activo', async () => {
    const vaultBRestricted: VaultPublic = {
      ...VAULT_B,
      allowedPodIds: [], // sin restricción de pod
      roleDefaults: { AltaGerencia: 'editor', Viewer: 'none' },
    };
    mockConfigs.findOne.mockResolvedValue(vaultBRestricted);

    const ctx = makeContext({
      user: { role: UserRole.Viewer, podIds: ['pod-a'] },
      query: { vaultId: 'vault-b' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('AltaGerencia (MANAGE_INTEGRATIONS) bypassa todos los checks incluso cross-vault', async () => {
    const ctx = makeContext({
      user: { role: UserRole.AltaGerencia, podIds: [] },
      query: { vaultId: 'vault-b' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockConfigs.findOne).not.toHaveBeenCalled();
    expect(mockConfigs.findAll).not.toHaveBeenCalled();
  });

  it('rechaza request sin user autenticado', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
