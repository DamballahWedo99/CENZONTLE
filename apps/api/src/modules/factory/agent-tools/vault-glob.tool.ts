import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultCloneService } from '../../vault/vault-clone.service';
import { CodeSearchService } from '../../code-repositories/code-search.service';
import type { AgentTool } from './agent-tool.interface';

/**
 * Encuentra archivos markdown del Vault por glob pattern.
 * Espejo de code_glob pero apuntado al clone local del Vault en vez de code repos.
 *
 * Multi-vault: sin `vault` busca en todos los vaults enabled (hoy solo 1 porque
 * VaultConfig.isActive es exclusivo, pero shape-ready para futuro multi-active);
 * con `vault` scope a uno por nombre.
 */
@Injectable()
export class VaultGlobTool implements AgentTool {
  readonly name = 'vault_glob';
  readonly description =
    'Find files in the connected Vault (markdown knowledge base) by glob pattern. Useful to discover what definitions, epics, or stories exist before running vault_grep. If `vault` is omitted, searches the active Vault. Returns up to 100 file paths sorted by modification time.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern, e.g. "definiciones/**/*.md" or "**/booking*.md"',
      },
      path: {
        type: 'string',
        description: 'Optional subdirectory relative to Vault root (e.g. "definiciones", "epics").',
      },
      vault: {
        type: 'string',
        description: 'Optional Vault name to scope the search. If omitted, searches the active Vault.',
      },
    },
    required: ['pattern'],
  };

  constructor(
    private readonly clones: VaultCloneService,
    private readonly search: CodeSearchService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: Record<string, unknown>): Promise<string> {
    const vaultName = input.vault ? String(input.vault) : undefined;
    const maxAge = Number(this.config.get('CODE_REPOS_AUTO_SYNC_AGE_MS')) || 300_000;

    // Caso 1: scope a un vault específico
    if (vaultName) {
      const target = await this.clones.getEnabledByName(vaultName);
      if (!target) {
        return JSON.stringify({
          error: `Vault "${vaultName}" no existe, no está habilitado, o su clone no está listo. Vaults disponibles: ${(await this.clones.getEnabled()).map((v) => v.name).join(', ') || '(ninguno)'}.`,
        });
      }
      // Best-effort: si el refresh falla, se busca sobre el clone existente
      // (posiblemente stale) en vez de abortar la búsqueda del agente.
      try { await this.clones.ensureFresh(target.id, maxAge); } catch { /* intencional */ }
      const result = await this.search.glob(target.absolutePath, String(input.pattern), {
        subDir: input.path ? String(input.path) : undefined,
      });
      return JSON.stringify({ vault: target.name, ...result });
    }

    // Caso 2: sin vault → fan-out sobre todos los enabled (hoy 0-1 elementos)
    const enabled = await this.clones.getEnabled();
    if (enabled.length === 0) {
      return JSON.stringify({
        error: await this.clones.getDiagnosticMessage(),
      });
    }
    await Promise.all(
      enabled.map((v) => this.clones.ensureFresh(v.id, maxAge).catch(() => {})),
    );
    const result = await this.search.globAll(enabled, String(input.pattern), {});
    return JSON.stringify(result);
  }
}
