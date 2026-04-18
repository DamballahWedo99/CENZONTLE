import { Injectable } from '@nestjs/common';
import { VaultService } from '../../vault/vault.service';
import type { AgentTool } from './agent-tool.interface';

@Injectable()
export class CodeExplorerTool implements AgentTool {
  readonly name = 'explore_code';
  readonly description =
    'Search existing vault content (epics, stories, definitions) for keywords. Use this to discover what has already been built or documented, identify gaps in coverage, and avoid proposing duplicate work. Search for technology names, feature names, or domain terms from the initiative.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query: filename, function name, or keyword' },
      folder: {
        type: 'string',
        description: 'Optional folder to scope the search (e.g. "epics", "definiciones")',
      },
      maxResults: {
        type: 'number',
        description: 'Max results to return (default 10)',
      },
    },
    required: ['query'],
  };

  constructor(private readonly vault: VaultService) {}

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = String(input.query ?? '').toLowerCase();
    const folder = input.folder ? String(input.folder).replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const maxResults = Math.min(Number(input.maxResults) || 10, 15);

    const folders = folder ? [folder] : ['epics', 'definiciones', 'stories'];
    const results: { path: string; excerpt: string; lineRange?: string }[] = [];

    for (const f of folders) {
      const paths = await this.vault.listNotes(f);
      for (const path of paths) {
        if (results.length >= maxResults) break;

        const note = await this.vault.readNote(path);
        if (!note) continue;

        const content = note.content.toLowerCase();
        if (!content.includes(query)) continue;

        const lines = note.content.split('\n');
        const matchLine = lines.findIndex((l) => l.toLowerCase().includes(query));
        const start = Math.max(0, matchLine - 2);
        const end = Math.min(lines.length, matchLine + 3);
        const excerpt = lines.slice(start, end).join('\n');

        results.push({
          path,
          excerpt: excerpt.slice(0, 300),
          lineRange: `${start + 1}-${end}`,
        });
      }
    }

    return JSON.stringify({
      results,
      totalFound: results.length,
      message: results.length === 0 ? `No matches for "${query}"` : undefined,
    });
  }
}
