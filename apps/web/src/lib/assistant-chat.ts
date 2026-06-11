/**
 * Assistant Chat — SSE Client
 *
 * Un turno de chat con el asistente editorial. POST (el mensaje viaja en el
 * body) y la respuesta es un stream SSE que parseamos igual que los agentes
 * de generación (epic-agent/story-agent).
 */

import type {
  AssistantChatEvent,
  AssistantEntityType,
  AssistantProposalFeedback,
  AssistantSessionSnapshot,
} from '@cenzontle/shared';

export interface AssistantTurnOptions {
  message: string;
  sessionId?: string;
  proposalFeedback?: AssistantProposalFeedback[];
  signal?: AbortSignal;
}

export async function* streamAssistantTurn(
  entityType: AssistantEntityType,
  entityId: string,
  opts: AssistantTurnOptions,
): AsyncGenerator<AssistantChatEvent> {
  const url = `/api/proxy/proyectos/assistant-chat/${entityType}/${entityId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message: opts.message,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.proposalFeedback?.length ? { proposalFeedback: opts.proposalFeedback } : {}),
    }),
    signal: opts.signal,
  });

  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const parsed = await response.json();
      if (parsed?.message) message = String(parsed.message);
    } catch {
      // body no-JSON — dejamos el mensaje genérico
    }
    yield { type: 'error', message };
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

export function destroyAssistantSession(sessionId: string): Promise<void> {
  return fetch(`/api/proxy/proyectos/assistant-chat/session/${sessionId}`, {
    method: 'DELETE',
  }).then(
    () => undefined,
    () => undefined, // best-effort: la sesión expira sola por TTL
  );
}

/**
 * Sesión activa del usuario para esta entidad (si existe) — para rehidratar
 * la conversación tras recargar la página. Null si no hay sesión viva.
 */
export async function getAssistantSession(
  entityType: AssistantEntityType,
  entityId: string,
): Promise<AssistantSessionSnapshot | null> {
  try {
    const res = await fetch(
      `/api/proxy/proyectos/assistant-chat/${entityType}/${entityId}/session`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { session: AssistantSessionSnapshot | null };
    return data.session ?? null;
  } catch {
    return null; // best-effort: sin snapshot, el chat arranca fresco
  }
}

/**
 * Reporta al backend el resultado de una propuesta apenas el usuario actúa —
 * así sobrevive recargas y alimenta el próximo turno server-side. Best-effort:
 * el body del siguiente turno viaja como respaldo (el server dedupea por id).
 */
export function sendProposalFeedback(
  sessionId: string,
  feedback: AssistantProposalFeedback[],
): Promise<void> {
  return fetch(`/api/proxy/proyectos/assistant-chat/session/${sessionId}/proposal-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  }).then(
    () => undefined,
    () => undefined,
  );
}

function parseSSEEvent(raw: string): AssistantChatEvent | null {
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join('\n')) as AssistantChatEvent;
  } catch {
    return null;
  }
}
