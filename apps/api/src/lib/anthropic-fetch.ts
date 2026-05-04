import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Dispatcher de undici con timeouts largos para llamadas streaming al
 * Anthropic API.
 *
 * Por qué: el SDK de Anthropic usa undici internamente, y los defaults de
 * undici tienen `bodyTimeout` ~5 min. Durante extended thinking + tool_use
 * grandes (especialmente TL/QA con `effort=high` que pueden tardar 5+ min
 * en empezar a emitir el JSON terminal), el body timeout default mata la
 * conexión con `Error: terminated` proveniente de
 * `@anthropic-ai/sdk/src/lib/MessageStream.ts`.
 *
 * Configuración:
 *  - `bodyTimeout: 0` — sin límite entre chunks. Necesario para extended
 *    thinking que pausa la emisión por minutos.
 *  - `headersTimeout: 5 * 60 * 1000` — 5 min para recibir headers de
 *    respuesta. Si Anthropic no responde en 5 min, fail-fast.
 *  - `keepAliveTimeout: 60 * 60 * 1000` — 60 min de keep-alive. Cubre runs
 *    completos PO+TL+QA secuenciales sin que el pool reuse conexiones
 *    expiradas.
 *  - `keepAliveMaxTimeout: 60 * 60 * 1000` — mismo cap.
 *  - `connections: 10` — pool moderado; runs paralelos no exceden esto.
 *
 * Si el `timeout` global del cliente Anthropic (configurado en cada
 * service como `45 * 60 * 1000`) expira antes que cualquier de estos,
 * gana ese — aborta el request entero. Estos timeouts cubren la capa de
 * transporte; el `timeout` del SDK cubre la lógica del request.
 */
const anthropicDispatcher = new Agent({
  bodyTimeout: 0,
  headersTimeout: 5 * 60 * 1000,
  keepAliveTimeout: 60 * 60 * 1000,
  keepAliveMaxTimeout: 60 * 60 * 1000,
  connections: 10,
});

/**
 * Fetch wrapper que el cliente Anthropic puede consumir. Usa `undici.fetch`
 * directamente (NO `globalThis.fetch`, que en algunos runtimes está
 * envuelto y no propaga el campo `dispatcher`).
 *
 * El SDK de Anthropic llama a este fetch con `(url, init)` para CADA
 * request streaming. La firma es compatible con la global Fetch API por
 * design — el cast es necesario porque los tipos de undici y los globales
 * no son nominalmente equivalentes pero sí estructuralmente compatibles.
 */
export const anthropicFetch = ((url: string | URL | Request, init?: RequestInit) => {
  return undiciFetch(url as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: anthropicDispatcher,
  }) as unknown as Promise<Response>;
}) as typeof fetch;
