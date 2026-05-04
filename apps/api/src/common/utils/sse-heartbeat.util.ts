import type { Response } from 'express';

/**
 * Default interval entre heartbeats SSE — 15 segundos.
 *
 * Por qué 15s: el `bodyTimeout` default de undici (cliente HTTP de Node 18+)
 * es de 5 minutos. Cualquier proxy intermedio (Next.js, Cloudflare,
 * load balancer) suele aplicar su propio idle-timeout en el rango de
 * 30-300s. Un heartbeat cada 15s nos da margen seguro para el proxy más
 * agresivo (30s) y mantiene la conexión viva durante operaciones de
 * agentes IA que pueden tardar minutos entre eventos significativos
 * (deep research, web search, large prompts).
 *
 * Por qué NO menos: 15s es suficientemente frecuente para todos los
 * timeouts comunes y suficientemente espaciado para no generar tráfico
 * innecesario.
 */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Configura un heartbeat SSE que envía un comentario `: ping\n\n` cada
 * `intervalMs` para mantener viva la conexión durante operaciones largas.
 *
 * El comentario SSE (líneas que empiezan con `:`) es ignorado por
 * EventSource del navegador y por cualquier consumer SSE estándar — solo
 * mantiene la conexión TCP activa y resetea idle timeouts en proxies
 * intermedios (undici, Next.js proxy, Cloudflare, load balancers).
 *
 * Sin esto, una corrida larga sin eventos puede cortarse con
 * `UND_ERR_BODY_TIMEOUT` (undici default = 5 min) u otros idle timeouts,
 * incluso si el agente sigue trabajando en background.
 *
 * Devuelve un cleanup function que DEBE llamarse en `complete`, `error`
 * y `req.on('close')` del controller para evitar fugas del interval.
 *
 * Errores de write se silencian: si el socket murió, ya no hay nada que
 * mantener vivo y el cleanup vendrá del `req.on('close')` del controller.
 *
 * @example
 * ```ts
 * res.flushHeaders();
 * const stopHeartbeat = setupSseHeartbeat(res);
 * try {
 *   // ... stream events
 * } finally {
 *   stopHeartbeat();
 * }
 * ```
 */
export function setupSseHeartbeat(
  res: Response,
  intervalMs: number = SSE_HEARTBEAT_INTERVAL_MS,
): () => void {
  const id = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // Socket muerto; el req.on('close') del controller hará el cleanup.
    }
  }, intervalMs);
  // Permite que el process termine aunque el interval esté activo (no bloquea
  // el event loop al apagar el server).
  id.unref?.();
  return () => clearInterval(id);
}
