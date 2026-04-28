/**
 * Epic Generation — SSE Client
 *
 * Connects to the real backend agent and yields events as they stream in.
 */

import type { EpicGenerationEvent } from '@cenzontle/shared';

/** Frontend-only extension with client-side timestamp fallback. */
export type EpicGenerationEventWithMeta = EpicGenerationEvent & { _receivedAt?: string };

export interface StreamEpicOptions {
  prompt?: string;
  count?: number;
  webSearch?: boolean;
  signal?: AbortSignal;
}

export async function* streamEpicProposals(
  initiativeId: string,
  opts: StreamEpicOptions = {},
): AsyncGenerator<EpicGenerationEventWithMeta> {
  const params = new URLSearchParams();
  if (opts.prompt) params.set('prompt', opts.prompt);
  if (opts.count) params.set('count', String(opts.count));
  if (opts.webSearch) params.set('webSearch', 'true');

  const url = `/api/proxy/proyectos/epic-generation/${initiativeId}?${params}`;

  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
    signal: opts.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    yield { type: 'error', message: `Error ${response.status}: ${text}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'error', message: 'No response body' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const event = parseSSEEvent(part);
        if (event) yield event;
      }
    }

    if (buffer.trim()) {
      const event = parseSSEEvent(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEEvent(raw: string): EpicGenerationEventWithMeta | null {
  const lines = raw.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  const data = dataLines.join('\n');

  try {
    const parsed = JSON.parse(data) as EpicGenerationEventWithMeta;
    if (!parsed.timestamp) {
      parsed._receivedAt = new Date().toISOString();
    }
    return parsed;
  } catch {
    return null;
  }
}
