import { Injectable } from '@nestjs/common';
import type { AgentTool } from './agent-tool.interface';

/**
 * Web research tool. MVP: delegates to Claude's built-in web_search server tool.
 * Since server tools run on Anthropic's side, this tool simply formats the query
 * and returns a message telling the model to use its own web_search capability.
 *
 * In production, this could be swapped for Tavily, SerpAPI, or a custom scraper.
 */
@Injectable()
export class WebResearchTool implements AgentTool {
  readonly name = 'web_research';
  readonly description =
    'Research a topic on the web. Use ONLY when the initiative mentions specific external providers (e.g., Stripe, Twilio, Auth0), third-party APIs, or technologies you need technical details about to write informed epics. Do NOT use for general concepts you already understand.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query for web research' },
      depth: {
        type: 'string',
        enum: ['shallow', 'deep'],
        description: 'shallow = quick facts, deep = detailed analysis (default: shallow)',
      },
    },
    required: ['query'],
  };

  async execute(input: Record<string, unknown>): Promise<string> {
    // MVP: return a hint for the model. The actual web_search is a server tool
    // configured at the API call level (not a custom tool). The model will use it
    // automatically when it sees the need.
    //
    // This tool exists so the agent has an explicit action in the timeline UX.
    const query = String(input.query ?? '');
    return JSON.stringify({
      note: `Web research for "${query}" will be handled via Claude built-in web search. The model should synthesize findings in its next response.`,
      query,
    });
  }
}
