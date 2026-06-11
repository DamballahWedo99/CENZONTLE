/**
 * Executive Summary — SSE Client
 *
 * Conecta con el agente de resúmenes ejecutivos del backend y emite los
 * eventos conforme llegan por el stream. Mismo patrón que epic-agent.ts.
 */

import type { ExecutiveSummary, ExecutiveSummaryEvent } from '@cenzontle/shared';
import { apiFetch } from '@/lib/api/client';

/** Extensión frontend-only con timestamp de recepción como fallback. */
export type ExecutiveSummaryEventWithMeta = ExecutiveSummaryEvent & { _receivedAt?: string };

export interface StreamExecutiveSummaryOptions {
  signal?: AbortSignal;
}

export async function* streamExecutiveSummary(
  initiativeId: string,
  opts: StreamExecutiveSummaryOptions = {},
): AsyncGenerator<ExecutiveSummaryEventWithMeta> {
  const url = `/api/proxy/proyectos/executive-summary/${initiativeId}`;

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

function parseSSEEvent(raw: string): ExecutiveSummaryEventWithMeta | null {
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
    const parsed = JSON.parse(data) as ExecutiveSummaryEventWithMeta;
    if (!parsed.timestamp) {
      parsed._receivedAt = new Date().toISOString();
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Último resumen persistido — null si nunca se ha generado uno. */
export function getCachedExecutiveSummary(
  initiativeId: string,
): Promise<{ summary: ExecutiveSummary | null }> {
  return apiFetch(`/proyectos/executive-summary/${initiativeId}/cached`);
}

/** Cancela el run activo en el backend (aborta el agente + limpia estado). */
export function cancelExecutiveSummaryRun(initiativeId: string): Promise<void> {
  return apiFetch(`/proyectos/executive-summary/${initiativeId}/active`, {
    method: 'DELETE',
  });
}
