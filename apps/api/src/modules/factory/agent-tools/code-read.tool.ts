import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeRepoCloneService } from '../../code-repositories/code-repo-clone.service';
import { CodeSearchService } from '../../code-repositories/code-search.service';
import type { AgentTool } from './agent-tool.interface';

/**
 * Lectura de un archivo específico de un repositorio conectado.
 * Multi-repo (Opción C): `repository` es REQUERIDO porque leer un archivo sin
 * saber en qué repo está es ambiguo (el mismo path puede existir en varios).
 */
@Injectable()
export class CodeReadTool implements AgentTool {
  readonly name = 'code_read';
  readonly description =
    'Read a specific file from a connected repository. The `repository` parameter is REQUIRED because file paths can collide between repos. Use code_glob or code_grep first to discover which repo contains the file. Supports offset/limit for reading large files in chunks. Rejects files > 256 KB and binary files (except images/PDFs).';
  readonly schema = {
    type: 'object' as const,
    properties: {
      repository: {
        type: 'string',
        description: 'Required: name of the enabled repository that contains the file.',
      },
      file_path: {
        type: 'string',
        description: 'File path relative to the repository root, e.g. "src/services/user.service.ts".',
      },
      offset: { type: 'number', description: '1-indexed line to start reading (default 1).' },
      limit: { type: 'number', description: 'Max lines to read (default 2000).' },
    },
    required: ['repository', 'file_path'],
  };

  constructor(
    private readonly clones: CodeRepoCloneService,
    private readonly search: CodeSearchService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: Record<string, unknown>): Promise<string> {
    const repoName = String(input.repository ?? '');
    if (!repoName) {
      return JSON.stringify({
        error: 'El parámetro `repository` es requerido. Usa code_glob o code_grep (sin `repository`) para descubrir en qué repo está el archivo.',
      });
    }

    const target = await this.clones.getEnabledByName(repoName);
    if (!target) {
      return JSON.stringify({
        error: `Repositorio "${repoName}" no existe, no está habilitado, o su clone no está listo. Repos disponibles: ${(await this.clones.getEnabled()).map((r) => r.name).join(', ') || '(ninguno)'}.`,
      });
    }

    const maxAge = Number(this.config.get('CODE_REPOS_AUTO_SYNC_AGE_MS')) || 300_000;
    // Best-effort: si el refresh falla, se lee del clone existente
    // (posiblemente stale) en vez de abortar la lectura del agente.
    try { await this.clones.ensureFresh(target.id, maxAge); } catch { /* intencional */ }

    try {
      const result = await this.search.read(target.absolutePath, String(input.file_path), {
        offset: typeof input.offset === 'number' ? (input.offset as number) : undefined,
        limit: typeof input.limit === 'number' ? (input.limit as number) : undefined,
      });
      return JSON.stringify({ repository: target.name, ...result });
    } catch (err: any) {
      return JSON.stringify({ repository: target.name, error: err?.message ?? 'Unknown error' });
    }
  }
}
