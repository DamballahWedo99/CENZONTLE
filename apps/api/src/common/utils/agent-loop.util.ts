import type Anthropic from '@anthropic-ai/sdk';
import { scrubSecrets } from './scrub-secrets.util';

/**
 * Helpers compartidos del tool-use loop de agentes IA.
 *
 * Extraídos de las 4 copias literales que vivían como métodos privados en
 * EpicGenerationService, StoryGenerationService, DiagramGenerationService y
 * AssistantChatService (hallazgo medium de architecture-review, 2026-06-10).
 * Funciones puras sin estado — cada servicio conserva lo que SÍ varía:
 * el mapa de labels de sus tools y la política de fallback del nudge.
 */

/**
 * Sanea los argumentos de una tool antes de emitirlos por SSE / persistir en
 * cache. Dos responsabilidades:
 *   1. Truncar strings largos (tope 100 chars) para no saturar la UI.
 *   2. Correr `scrubSecrets` en CADA string leaf — incluyendo objetos/arrays
 *      anidados — para que un prompt injection que haga que el modelo invoque
 *      p. ej. `code_grep({ pattern: "ghp_..." })` no filtre el token por el
 *      evento `step_start.toolArgs`. El evento se emite ANTES de ejecutar la
 *      tool, así que incluso si la ejecución falla el cliente ya vio el
 *      secreto sin esta defensa.
 */
export function sanitizeToolArgs(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeToolArgValue(input) as Record<string, unknown>;
}

function sanitizeToolArgValue(val: unknown): unknown {
  if (typeof val === 'string') {
    const truncated = val.length > 100 ? val.slice(0, 100) + '…' : val;
    return scrubSecrets(truncated);
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeToolArgValue(item));
  }
  if (val !== null && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(val as Record<string, unknown>)) {
      out[key] = sanitizeToolArgValue(inner);
    }
    return out;
  }
  return val;
}

/**
 * Preview corto del resultado de una tool para el evento `step_done`.
 * Defense in depth: envuelve TODO el flujo en scrubSecrets porque el `result`
 * viene de tools que en el peor caso pueden devolver contenido de .git/config
 * o mensajes de error con PATs embebidos.
 */
export function extractResultPreview(result: string): string | undefined {
  const preview = computeRawPreview(result);
  return preview === undefined ? undefined : scrubSecrets(preview);
}

function computeRawPreview(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result);

    // Code exploration: show file paths or snippet titles
    if (Array.isArray(parsed.results) && parsed.results.length > 0) {
      return parsed.results
        .slice(0, 5)
        .map(
          (r: Record<string, unknown>) =>
            r.title || r.path || r.name || JSON.stringify(r).slice(0, 80),
        )
        .join(' · ');
    }

    // Documents: show document titles
    if (Array.isArray(parsed.documents) && parsed.documents.length > 0) {
      return parsed.documents
        .slice(0, 5)
        .map((d: Record<string, unknown>) => d.title || d.name || 'Documento')
        .join(' · ');
    }

    // Raw content: show excerpt
    if (typeof parsed.content === 'string' && parsed.content.length > 0) {
      return parsed.content.slice(0, 300) + (parsed.content.length > 300 ? '…' : '');
    }

    // Fallback: show first 300 chars of the stringified result
    const str = JSON.stringify(parsed);
    if (str.length > 2) return str.slice(0, 300) + (str.length > 300 ? '…' : '');

    return undefined;
  } catch {
    return result.slice(0, 300) + (result.length > 300 ? '…' : '');
  }
}

/**
 * Label humano de una tool para la timeline de la UI. Cada servicio pasa su
 * propio mapa — los textos difieren deliberadamente por contexto (p. ej.
 * "Buscando archivos de codigo" en stories vs "Explorando archivos del
 * código" en diagramas).
 */
export function getToolLabel(labels: Record<string, string>, name: string): string {
  return labels[name] ?? name;
}

/** Resumen de una línea del resultado de una tool para el evento `step_done`. */
export function summarizeToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (parsed.results) return `${parsed.results.length} resultados`;
    if (parsed.documents) return `${parsed.documents.length} documentos`;
    if (parsed.content) return `Contenido leído (${parsed.content.length} chars)`;
    return 'Completado';
  } catch {
    return 'Completado';
  }
}

/**
 * Promise que rechaza a los `ms` — para `Promise.race` contra la ejecución
 * de una tool. `clear()` DEBE llamarse cuando la tool gana la race para no
 * dejar el timer vivo.
 */
export function toolTimeout(ms: number): Promise<never> & { clear: () => void } {
  let timerId: NodeJS.Timeout;
  const promise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Tool timeout (${ms}ms)`)), ms);
  });
  (promise as Promise<never> & { clear: () => void }).clear = () => clearTimeout(timerId!);
  return promise as Promise<never> & { clear: () => void };
}

/**
 * Anexa el "nudge" textual (presupuesto de iteraciones por agotarse) al
 * ÚLTIMO mensaje si es `user` — como bloque extra si el content es array
 * (post-tool_results) o concatenado si es string. Evita la secuencia
 * inválida `user[tool_results], user[nudge]` que rompe la alternancia
 * estricta exigida por Anthropic con thinking activo.
 *
 * Devuelve `false` si el último mensaje NO es `user` — el caller decide la
 * política: los servicios de generación pushean un user message nuevo
 * (comportamiento histórico); el assistant-chat omite el nudge con un warn
 * (un push ahí rompería la alternancia del historial multiturno).
 */
export function appendNudgeToLastUserMessage(
  messages: Anthropic.Messages.MessageParam[],
  nudgeText: string,
): boolean {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user' && Array.isArray(last.content)) {
    last.content.push({ type: 'text', text: nudgeText });
    return true;
  }
  if (last && last.role === 'user' && typeof last.content === 'string') {
    last.content = `${last.content}\n\n${nudgeText}`;
    return true;
  }
  return false;
}
