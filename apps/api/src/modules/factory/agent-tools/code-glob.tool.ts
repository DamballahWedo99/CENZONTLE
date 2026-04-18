import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeRepoCloneService } from '../../code-repositories/code-repo-clone.service';
import { CodeSearchService } from '../../code-repositories/code-search.service';
import type { AgentTool } from './agent-tool.interface';

/**
 * Encuentra archivos en repositorios conectados por glob pattern.
 * Multi-repo (Opción C): sin `repository` busca en TODOS los enabled en paralelo;
 * con `repository` solo en el que coincida por nombre.
 */
@Injectable()
export class CodeGlobTool implements AgentTool {
  readonly name = 'code_glob';
  readonly description =
    'Find files in connected source-code repositories by glob pattern (e.g. "**/*.ts"). If `repository` is omitted, searches across ALL enabled repos in parallel and returns matches with repo attribution. If `repository` is given, scopes to that one. Use to discover project layout or find candidate files before running code_grep.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.{js,jsx}"',
      },
      path: {
        type: 'string',
        description: 'Optional subdirectory relative to repo root (only meaningful when `repository` is also set).',
      },
      repository: {
        type: 'string',
        description: 'Optional repo name to scope the search. If omitted, searches ALL enabled repos.',
      },
    },
    required: ['pattern'],
  };

  constructor(
    private readonly clones: CodeRepoCloneService,
    private readonly search: CodeSearchService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: Record<string, unknown>): Promise<string> {
    const repoName = input.repository ? String(input.repository) : undefined;
    const maxAge = Number(this.config.get('CODE_REPOS_AUTO_SYNC_AGE_MS')) || 300_000;

    // Caso 1: agente especificó un repo → buscar solo en ese
    if (repoName) {
      const target = await this.clones.getEnabledByName(repoName);
      if (!target) {
        return JSON.stringify({
          error: `Repositorio "${repoName}" no existe, no está habilitado, o su clone no está listo. Repos disponibles: ${(await this.clones.getEnabled()).map((r) => r.name).join(', ') || '(ninguno)'}.`,
        });
      }
      try { await this.clones.ensureFresh(target.id, maxAge); } catch {}
      const result = await this.search.glob(target.absolutePath, String(input.pattern), {
        subDir: input.path ? String(input.path) : undefined,
      });
      return JSON.stringify({ repository: target.name, ...result });
    }

    // Caso 2: sin repo → fan-out sobre todos los enabled
    const enabled = await this.clones.getEnabled();
    if (enabled.length === 0) {
      return JSON.stringify({
        error:
          'No hay repositorios de código habilitados con clone listo. Configura y habilita uno en Settings → Código.',
      });
    }
    await Promise.all(
      enabled.map((r) => this.clones.ensureFresh(r.id, maxAge).catch(() => {})),
    );
    const result = await this.search.globAll(enabled, String(input.pattern), {});
    return JSON.stringify(result);
  }
}
