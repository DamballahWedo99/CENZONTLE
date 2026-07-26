import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeRepoCloneService } from '../../code-repositories/code-repo-clone.service';
import { CodeSearchService } from '../../code-repositories/code-search.service';
import type { AgentTool } from './agent-tool.interface';

/**
 * Búsqueda de contenido (ripgrep) en repositorios conectados.
 * Multi-repo (Opción C): sin `repository` busca en todos los enabled en paralelo;
 * con `repository` solo en ese. Los matches siempre incluyen atribución de repo.
 */
@Injectable()
export class CodeGrepTool implements AgentTool {
  readonly name = 'code_grep';
  readonly description =
    'Search file contents with ripgrep across connected repositories. If `repository` is omitted, fans out to all enabled repos in parallel and merges results with repo attribution. If `repository` is given, scopes to that one. Supports regex, glob filtering, file types, context lines (-A/-B/-C), and three output modes.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern (ripgrep syntax). E.g. "class\\s+UserService", "TODO:", "import.*react".',
      },
      repository: {
        type: 'string',
        description: 'Optional repo name to scope the search. If omitted, searches ALL enabled repos.',
      },
      path: {
        type: 'string',
        description: 'Optional subdirectory relative to repo root (only meaningful when `repository` is set).',
      },
      glob: { type: 'string', description: 'Filter by glob, e.g. "*.ts" or "src/**/*.{ts,tsx}".' },
      type: { type: 'string', description: 'File type filter: "js", "ts", "py", "rust", "go", "java", etc.' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'content = matching lines; files_with_matches (default) = just paths; count = matches per file.',
      },
      '-A': { type: 'number', description: 'Lines of context AFTER each match (content mode).' },
      '-B': { type: 'number', description: 'Lines of context BEFORE each match.' },
      '-C': { type: 'number', description: 'Lines of context before AND after each match.' },
      '-n': { type: 'boolean', description: 'Show line numbers (default true in content mode).' },
      '-i': { type: 'boolean', description: 'Case-insensitive search.' },
      multiline: { type: 'boolean', description: 'Enable multiline matching.' },
      head_limit: { type: 'number', description: 'Max results (default 250, divided across repos in fan-out mode).' },
      offset: { type: 'number', description: 'Skip N results (only in single-repo mode).' },
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

    const outputMode = input.output_mode as 'content' | 'files_with_matches' | 'count' | undefined;
    const commonOpts = {
      glob: input.glob ? String(input.glob) : undefined,
      type: input.type ? String(input.type) : undefined,
      outputMode,
      before: typeof input['-B'] === 'number' ? (input['-B'] as number) : undefined,
      after: typeof input['-A'] === 'number' ? (input['-A'] as number) : undefined,
      context: typeof input['-C'] === 'number' ? (input['-C'] as number) : undefined,
      lineNumbers: typeof input['-n'] === 'boolean' ? (input['-n'] as boolean) : undefined,
      caseInsensitive: typeof input['-i'] === 'boolean' ? (input['-i'] as boolean) : undefined,
      multiline: typeof input.multiline === 'boolean' ? (input.multiline as boolean) : undefined,
      headLimit: typeof input.head_limit === 'number' ? (input.head_limit as number) : undefined,
    };

    // Caso 1: con repository → single-repo search
    if (repoName) {
      const target = await this.clones.getEnabledByName(repoName);
      if (!target) {
        return JSON.stringify({
          error: `Repositorio "${repoName}" no existe, no está habilitado, o su clone no está listo. Repos disponibles: ${(await this.clones.getEnabled()).map((r) => r.name).join(', ') || '(ninguno)'}.`,
        });
      }
      // Best-effort: si el refresh falla, se busca sobre el clone existente
      // (posiblemente stale) en vez de abortar la búsqueda del agente.
      try { await this.clones.ensureFresh(target.id, maxAge); } catch { /* intencional */ }
      const result = await this.search.grep(target.absolutePath, String(input.pattern), {
        ...commonOpts,
        path: input.path ? String(input.path) : undefined,
        offset: typeof input.offset === 'number' ? (input.offset as number) : undefined,
      });
      return JSON.stringify({ repository: target.name, ...result });
    }

    // Caso 2: sin repository → fan-out sobre todos los enabled
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
    const result = await this.search.grepAll(enabled, String(input.pattern), commonOpts);
    return JSON.stringify(result);
  }
}
