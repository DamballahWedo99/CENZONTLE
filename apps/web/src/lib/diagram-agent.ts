/**
 * Diagram Generation — SSE Client
 *
 * Connects to the backend DiagramGenerationController and streams the agent's
 * events (thinking, tool_use, phase_change, document_ready, diagram_ready) in
 * real time. The backend runs a Claude Sonnet 4 tool-use loop with repo/vault/doc
 * tools.
 *
 * Event ordering contract (relevant for consumers handling side-effects):
 *   1. `phase_change` → "composing"
 *   2. `document_ready` (optional — only if the integration flow markdown was
 *      emitted AND the vault write succeeded)
 *   3. `diagram_ready` (always emitted on success; may already include
 *      `integrationFlowDocPath` + `integrationFlowGeneratedAt` set by the
 *      backend before persisting the diagram)
 *
 * The stream is exposed as an `AsyncGenerator<DiagramGenerationEvent>` — the
 * discriminated union from `@cenzontle/shared` covers every variant, including
 * `document_ready`, so consumers only need a new `case` in their switch.
 */

import type { Epic, EpicDiagram, DiagramGenerationEvent, DiagramGenerationType } from '@cenzontle/shared';

export type DiagramGenerationEventWithMeta = DiagramGenerationEvent & { _receivedAt?: string };

export interface StreamDiagramOptions {
  prompt?: string;
  signal?: AbortSignal;
}

export async function* streamDiagramGeneration(
  epic: Epic,
  type: DiagramGenerationType = 'business',
  opts: StreamDiagramOptions = {},
): AsyncGenerator<DiagramGenerationEventWithMeta> {
  const params = new URLSearchParams();
  params.set('type', type);
  if (opts.prompt) params.set('prompt', opts.prompt);

  const url = `/api/proxy/proyectos/diagram-generation/${epic.id}?${params}`;

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

/**
 * Convenience wrapper: consumes the stream until a `diagram_ready` event and
 * resolves with the diagram. Rejects on `error` events or if the run finishes
 * without producing a diagram.
 */
export async function generateDiagram(epic: Epic, type: DiagramGenerationType): Promise<EpicDiagram> {
  let diagram: EpicDiagram | null = null;

  for await (const event of streamDiagramGeneration(epic, type)) {
    if (event.type === 'diagram_ready') {
      diagram = event.diagram;
    } else if (event.type === 'error') {
      throw new Error(event.message);
    } else if (event.type === 'run_finished') {
      break;
    }
  }

  if (!diagram) {
    throw new Error('El agente finalizó sin emitir un diagrama.');
  }
  return diagram;
}

/**
 * Lee el diagrama cacheado en Redis (TTL 5 días) si existe.
 *
 * Retorna `null` si:
 *   - El endpoint responde 2xx con `{ diagram: null }` (no hay cache para
 *     esta épica + tipo, o el TTL caducó).
 *   - El endpoint falla (404, 5xx, red cortada). La falla se absorbe aquí
 *     porque "no hay cache" es un estado legítimo del flujo — no queremos
 *     romper el render de la épica por un problema de Redis.
 */
export async function fetchCachedDiagram(
  epicId: string,
  type: DiagramGenerationType = 'business',
): Promise<EpicDiagram | null> {
  const params = new URLSearchParams({ type });
  const url = `/api/proxy/proyectos/diagram-generation/${epicId}/cached?${params}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = (await response.json()) as { diagram: EpicDiagram | null };
    return body.diagram ?? null;
  } catch {
    return null;
  }
}

/**
 * Persiste un diagrama editado manualmente al cache Redis del backend.
 *
 * Usado por el editor de diagramas tras aplicar cambios (drag de nodos,
 * edición de labels, etc.). El backend marca el diagrama como
 * `generatedBy: 'manual'` y refresca `generatedAt`.
 *
 * Retorna:
 *   - El diagrama actualizado (con timestamps nuevos) en éxito.
 *   - `null` si el endpoint falló (4xx, 5xx, red cortada). El caller decide
 *     cómo mostrar el error al usuario (toast, retry, etc.).
 */
export async function saveEditedDiagram(
  epicId: string,
  type: DiagramGenerationType,
  diagram: EpicDiagram,
): Promise<EpicDiagram | null> {
  const url = `/api/proxy/proyectos/diagram-generation/${epicId}/cached`;
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, diagram }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { diagram: EpicDiagram };
    return body.diagram;
  } catch {
    return null;
  }
}

/**
 * Resetea el layout manual de un diagrama cacheado — el backend lo marca
 * `hasManualLayout=false` + borra `manualPositions`. La próxima vez que el
 * viewer monte el diagrama pasará por ELK y recalculará posiciones con el
 * layout engine actual.
 *
 * Úsese SOLO cuando el user explícitamente pide "Recalcular layout": el
 * caller debe mostrar un confirm antes de llamar, ya que las posiciones
 * manuales NO son recuperables.
 *
 * Retorna:
 *   - El diagrama con el layout reseteado en éxito.
 *   - `null` si no existe cache para esa épica+type, o si el endpoint falló.
 */
export async function resetDiagramLayout(
  epicId: string,
  type: DiagramGenerationType = 'business',
): Promise<EpicDiagram | null> {
  const params = new URLSearchParams({ type });
  const url = `/api/proxy/proyectos/diagram-generation/${epicId}/reset-layout?${params}`;
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { diagram: EpicDiagram | null };
    return body.diagram ?? null;
  } catch {
    return null;
  }
}

/**
 * Backfill: consume el SSE del endpoint que genera `steps[]` +
 * documento de flujo sobre un diagrama existente. Espeja el patrón de
 * `streamDiagramGeneration` pero:
 *   - No expone un `AsyncGenerator`: el caller recibe los eventos via
 *     callback (`onEvent`) porque el consumidor típico (panel del viewer)
 *     reacciona imperativamente a cada evento sin necesitar iteración.
 *   - Retorna `Promise<void>` que se resuelve cuando el stream termina
 *     (normal o abortado). Errores de red/parsing se propagan al `onEvent`
 *     como eventos `type: 'error'` para unificar el manejo en el caller.
 *
 * URL: `/api/proxy/proyectos/diagram-generation/{epicId}/generate-integration-doc?type={type}`
 */
export async function generateIntegrationDoc(
  epicId: string,
  type: DiagramGenerationType,
  onEvent: (event: DiagramGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({ type });
  const url = `/api/proxy/proyectos/diagram-generation/${epicId}/generate-integration-doc?${params}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal,
    });
  } catch (err) {
    // Fetch falló antes del handshake (red cortada, abort pre-request).
    // Reportamos al caller via `error` event para que pueda cerrar el toast
    // de progreso sin ramas especiales en el call-site.
    const message = err instanceof Error ? err.message : 'Error al iniciar el stream';
    onEvent({ type: 'error', message });
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    onEvent({ type: 'error', message: `Error ${response.status}: ${text}` });
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onEvent({ type: 'error', message: 'No response body' });
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
        if (event) onEvent(event);
      }
    }

    if (buffer.trim()) {
      const event = parseSSEEvent(buffer);
      if (event) onEvent(event);
    }
  } catch (err) {
    // `AbortError` es esperado cuando el caller aborta la operación —
    // lo reportamos pero sin ruido (el caller ya sabe que abortó).
    const message = err instanceof Error ? err.message : 'Error al consumir el stream';
    onEvent({ type: 'error', message });
  } finally {
    reader.releaseLock();
  }
}

function parseSSEEvent(raw: string): DiagramGenerationEventWithMeta | null {
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
    const parsed = JSON.parse(data) as DiagramGenerationEventWithMeta;
    if (!parsed.timestamp) {
      parsed._receivedAt = new Date().toISOString();
    }
    return parsed;
  } catch {
    return null;
  }
}
