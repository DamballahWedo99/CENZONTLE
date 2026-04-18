import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultCloneService } from '../../vault/vault-clone.service';
import { CodeSearchService } from '../../code-repositories/code-search.service';
import type { AgentTool } from './agent-tool.interface';

/**
 * Lectura completa de un archivo markdown del Vault, con paginación.
 * Espejo de code_read pero con `vault` en vez de `repository`.
 *
 * El parámetro `vault` es OPCIONAL (a diferencia de code_read que es requerido)
 * porque hoy solo hay un Vault activo a la vez — la ambigüedad de path entre
 * vaults solo es posible en futuro multi-active.
 */
@Injectable()
export class VaultReadTool implements AgentTool {
  readonly name = 'vault_read';
  readonly description =
    'Read a specific markdown file from the Vault with optional line-range pagination. Use after vault_glob or vault_grep to read full context. The `vault` parameter is optional — if omitted uses the active Vault. Rejects files > 64 KB (use offset/limit for long definitions) and binary files.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'File path relative to Vault root, e.g. "definiciones/booking.md".',
      },
      vault: {
        type: 'string',
        description: 'Optional Vault name. If omitted, reads from the active Vault.',
      },
      offset: { type: 'number', description: '1-indexed line to start reading (default 1).' },
      limit: { type: 'number', description: 'Max lines to read (default 2000).' },
    },
    required: ['file_path'],
  };

  constructor(
    private readonly clones: VaultCloneService,
    private readonly search: CodeSearchService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: Record<string, unknown>): Promise<string> {
    const vaultName = input.vault ? String(input.vault) : undefined;

    let target: { id: string; name: string; absolutePath: string } | null;
    if (vaultName) {
      target = await this.clones.getEnabledByName(vaultName);
      if (!target) {
        return JSON.stringify({
          error: `Vault "${vaultName}" no existe, no está habilitado, o su clone no está listo. Vaults disponibles: ${(await this.clones.getEnabled()).map((v) => v.name).join(', ') || '(ninguno)'}.`,
        });
      }
    } else {
      const enabled = await this.clones.getEnabled();
      target = enabled[0] ?? null;
      if (!target) {
        return JSON.stringify({
          error: await this.clones.getDiagnosticMessage(),
        });
      }
    }

    const maxAge = Number(this.config.get('CODE_REPOS_AUTO_SYNC_AGE_MS')) || 300_000;
    try { await this.clones.ensureFresh(target.id, maxAge); } catch {}

    try {
      const result = await this.search.read(target.absolutePath, String(input.file_path), {
        offset: typeof input.offset === 'number' ? (input.offset as number) : undefined,
        limit: typeof input.limit === 'number' ? (input.limit as number) : undefined,
      });
      return JSON.stringify({ vault: target.name, ...result });
    } catch (err: any) {
      return JSON.stringify({ vault: target.name, error: err?.message ?? 'Unknown error' });
    }
  }
}
