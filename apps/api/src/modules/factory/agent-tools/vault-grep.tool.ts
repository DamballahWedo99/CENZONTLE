import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultCloneService } from '../../vault/vault-clone.service';
import { CodeSearchService } from '../../code-repositories/code-search.service';
import type { AgentTool } from './agent-tool.interface';

/**
 * Búsqueda de contenido en el Vault via ripgrep. Reemplaza `search_definitions`
 * con una implementación 10-30× más rápida (clone local en vez de Octokit loop)
 * y con regex completo para manejar sinónimos via alternación:
 * `(booking|reserva|PNR)`.
 *
 * DEFAULT `outputMode: 'content'` (diferente de code_grep que default es
 * 'files_with_matches'): buscar en docs típicamente queremos el excerpt,
 * no solo saber en qué archivo está.
 */
@Injectable()
export class VaultGrepTool implements AgentTool {
  readonly name = 'vault_grep';
  readonly description =
    'Search markdown content in the Vault (business knowledge base) using ripgrep. Use regex alternation to catch synonyms: `(booking|reserva|PNR)` with `-i: true` handles case-insensitive multi-term search in one call. If `vault` is omitted, searches the active Vault. Default outputMode is "content" returning excerpts with line numbers — set to "files_with_matches" for just paths.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern. For synonym search use alternation like "(pago|cobro|transacción)". For case-insensitive add "-i: true".',
      },
      vault: {
        type: 'string',
        description: 'Optional Vault name. If omitted, searches the active Vault.',
      },
      path: {
        type: 'string',
        description: 'Optional subdirectory within the Vault to scope the search (e.g. "definiciones").',
      },
      glob: { type: 'string', description: 'Filter files by glob, e.g. "*.md".' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'content (default) = matching lines with excerpts; files_with_matches = just paths; count = matches per file.',
      },
      '-A': { type: 'number', description: 'Lines of context AFTER each match (content mode).' },
      '-B': { type: 'number', description: 'Lines of context BEFORE each match.' },
      '-C': { type: 'number', description: 'Lines of context before AND after.' },
      '-n': { type: 'boolean', description: 'Show line numbers (default true in content mode).' },
      '-i': { type: 'boolean', description: 'Case-insensitive search. Use this almost always for definitions.' },
      multiline: { type: 'boolean', description: 'Enable multiline matching.' },
      head_limit: { type: 'number', description: 'Max results (default 250).' },
      offset: { type: 'number', description: 'Skip N results for pagination.' },
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

    // Default outputMode 'content' (diferente de code_grep) — docs queremos excerpts
    const outputMode = (input.output_mode as 'content' | 'files_with_matches' | 'count' | undefined) ?? 'content';

    const commonOpts = {
      glob: input.glob ? String(input.glob) : '*.md',
      outputMode,
      before: typeof input['-B'] === 'number' ? (input['-B'] as number) : undefined,
      after: typeof input['-A'] === 'number' ? (input['-A'] as number) : undefined,
      context: typeof input['-C'] === 'number' ? (input['-C'] as number) : undefined,
      lineNumbers: typeof input['-n'] === 'boolean' ? (input['-n'] as boolean) : undefined,
      caseInsensitive: typeof input['-i'] === 'boolean' ? (input['-i'] as boolean) : undefined,
      multiline: typeof input.multiline === 'boolean' ? (input.multiline as boolean) : undefined,
      headLimit: typeof input.head_limit === 'number' ? (input.head_limit as number) : undefined,
    };

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
      const result = await this.search.grep(target.absolutePath, String(input.pattern), {
        ...commonOpts,
        path: input.path ? String(input.path) : undefined,
        offset: typeof input.offset === 'number' ? (input.offset as number) : undefined,
      });
      return JSON.stringify({ vault: target.name, ...result });
    }

    // Caso 2: sin vault → fan-out (hoy 0-1 vaults, preparado para multi-active)
    const enabled = await this.clones.getEnabled();
    if (enabled.length === 0) {
      return JSON.stringify({
        error: await this.clones.getDiagnosticMessage(),
      });
    }
    await Promise.all(
      enabled.map((v) => this.clones.ensureFresh(v.id, maxAge).catch(() => {})),
    );
    const result = await this.search.grepAll(enabled, String(input.pattern), commonOpts);
    return JSON.stringify(result);
  }
}
