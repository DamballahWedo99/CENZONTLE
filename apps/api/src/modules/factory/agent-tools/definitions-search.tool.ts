import { Injectable } from '@nestjs/common';
import { VaultService } from '../../vault/vault.service';
import type { AgentTool } from './agent-tool.interface';

@Injectable()
export class DefinitionsSearchTool implements AgentTool {
  readonly name = 'search_definitions';
  readonly description =
    'Search business definitions and domain knowledge stored in the vault. Use this to understand business terminology, workflows, rules, and domain concepts mentioned in the initiative. Returns title, path, and relevant excerpts. Search for concepts like product names, process names, or business terms you see in the initiative description.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query (keywords or phrase)' },
      category: {
        type: 'string',
        description: 'Optional folder/category filter inside the vault (e.g. "definiciones", "epics")',
      },
    },
    required: ['query'],
  };

  constructor(private readonly vault: VaultService) {}

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = String(input.query ?? '').toLowerCase();
    const category = input.category ? String(input.category).replace(/[^a-zA-Z0-9_-]/g, '') : 'definiciones';

    const paths = await this.vault.listNotes(category);
    if (paths.length === 0) {
      return JSON.stringify({ results: [], message: `No notes found in folder "${category}"` });
    }

    const results: { title: string; path: string; excerpt: string }[] = [];

    for (const path of paths.slice(0, 30)) {
      const note = await this.vault.readNote(path);
      if (!note) continue;

      const content = note.content.toLowerCase();
      if (!content.includes(query)) continue;

      const title = this.extractTitle(note.content);
      const excerpt = this.extractExcerpt(note.content, query);
      results.push({ title, path, excerpt });

      if (results.length >= 8) break;
    }

    return JSON.stringify({ results });
  }

  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '(sin título)';
  }

  private extractExcerpt(content: string, query: string): string {
    const idx = content.toLowerCase().indexOf(query);
    if (idx === -1) return content.slice(0, 200);
    const start = Math.max(0, idx - 80);
    const end = Math.min(content.length, idx + query.length + 120);
    return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
  }
}
