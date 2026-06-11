// Octokit (@octokit/rest) y @anthropic-ai/sdk son ESM y rompen el parser de
// Jest al cargarse en la cadena de imports del service. Los mockeamos a nivel
// módulo: getAllTags no los usa, e inyectamos mocks concretos vía constructor.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => jest.fn());

import { VaultConnectionsService } from './vault-connections.service';
import { VaultService } from './vault.service';
import { VaultCloneService } from './vault-clone.service';
import { VaultConfigService } from './vault-config.service';
import { OrgAnthropicConfigService } from '../org-anthropic-config/org-anthropic-config.service';
import { createMockPinoLogger } from '../../common/testing/mock-pino-logger';

function noteWithTags(tag: string) {
  return { path: 'doc.md', content: `---\ntags: [${tag}]\n---\n# Doc`, sha: 'sha', updatedAt: null };
}

describe('VaultConnectionsService.getAllTags — cache keyed por vault real (CWE-200 cross-vault)', () => {
  let service: VaultConnectionsService;
  let vault: { listTree: jest.Mock; readNote: jest.Mock; listCommits: jest.Mock };
  let clones: { getEnabled: jest.Mock };
  let vaultConfigs: { findAll: jest.Mock };

  beforeEach(() => {
    vault = {
      // Un único doc.md en la raíz; su contenido lo controla readNote.
      listTree: jest.fn().mockResolvedValue([{ path: 'doc.md', name: 'doc.md', type: 'file', sha: 'x' }]),
      readNote: jest.fn(),
      listCommits: jest.fn(),
    };
    // Sin clone ready → collectDocuments cae al fallback de GitHub API (readNote).
    clones = { getEnabled: jest.fn().mockResolvedValue([]) };
    vaultConfigs = { findAll: jest.fn() };

    service = new VaultConnectionsService(
      vault as unknown as VaultService,
      clones as unknown as VaultCloneService,
      vaultConfigs as unknown as VaultConfigService,
      {} as unknown as OrgAnthropicConfigService,
      createMockPinoLogger(),
    );
  });

  it('un switch de vault activo NO sirve los tags del vault anterior', async () => {
    // Vault A activo: doc.md tiene [alpha]. Pobla el cache bajo la clave 'vault-a'.
    vaultConfigs.findAll.mockResolvedValue([{ id: 'vault-a', isActive: true }]);
    vault.readNote.mockResolvedValue(noteWithTags('alpha'));
    expect(await service.getAllTags()).toEqual({ 'doc.md': ['alpha'] });

    // Un admin activa el vault B; doc.md del nuevo activo tiene [beta].
    vaultConfigs.findAll.mockResolvedValue([{ id: 'vault-b', isActive: true }]);
    vault.readNote.mockResolvedValue(noteWithTags('beta'));

    // getAllTags() sin vaultId resuelve la clave 'vault-b' → cache miss → relee.
    // Antes del fix (clave sintética '__active__') habría servido el cache de A.
    expect(await service.getAllTags()).toEqual({ 'doc.md': ['beta'] });
    expect(vault.listTree).toHaveBeenCalledTimes(2);
  });

  it('cachea dentro del mismo vault activo (segunda llamada = hit, no relee)', async () => {
    vaultConfigs.findAll.mockResolvedValue([{ id: 'vault-a', isActive: true }]);
    vault.readNote.mockResolvedValue(noteWithTags('alpha'));

    await service.getAllTags();
    await service.getAllTags();

    // El árbol se leyó una sola vez: la segunda llamada salió del cache.
    expect(vault.listTree).toHaveBeenCalledTimes(1);
  });

  it('un vaultId explícito usa su propia clave, independiente del activo', async () => {
    vaultConfigs.findAll.mockResolvedValue([{ id: 'vault-a', isActive: true }]);
    vault.readNote.mockResolvedValue(noteWithTags('alpha'));

    await service.getAllTags('vault-b'); // browse-mode: clave 'vault-b'
    // findAll no se consulta cuando hay vaultId explícito (clave directa).
    expect(vaultConfigs.findAll).not.toHaveBeenCalled();
  });
});

describe('VaultConnectionsService.getLastRunAt — datado vía git history', () => {
  let service: VaultConnectionsService;
  let vault: { listCommits: jest.Mock };

  beforeEach(() => {
    vault = { listCommits: jest.fn() };
    service = new VaultConnectionsService(
      vault as unknown as VaultService,
      {} as unknown as VaultCloneService,
      {} as unknown as VaultConfigService,
      {} as unknown as OrgAnthropicConfigService,
      createMockPinoLogger(),
    );
  });

  it('devuelve la fecha del commit-marcador más reciente (commits vienen DESC)', async () => {
    vault.listCommits.mockResolvedValue([
      { sha: '1', message: 'docs(vault): edit manual', date: '2026-06-10T12:00:00Z', authorName: 'u', files: [] },
      { sha: '2', message: 'docs(vault): conexiones IA — tags de a.md', date: '2026-06-09T10:00:00Z', authorName: 'u', files: [] },
      { sha: '3', message: 'docs(vault): conexiones IA — tags de b.md', date: '2026-06-01T08:00:00Z', authorName: 'u', files: [] },
    ]);
    // El primer match (más reciente) gana, ignorando commits manuales más nuevos.
    expect(await service.getLastRunAt()).toBe('2026-06-09T10:00:00Z');
  });

  it('devuelve null si nunca se generaron conexiones', async () => {
    vault.listCommits.mockResolvedValue([
      { sha: '1', message: 'docs(vault): create README', date: '2026-06-10T12:00:00Z', authorName: 'u', files: [] },
    ]);
    expect(await service.getLastRunAt()).toBeNull();
  });

  it('devuelve null con vault sin commits', async () => {
    vault.listCommits.mockResolvedValue([]);
    expect(await service.getLastRunAt()).toBeNull();
  });
});
