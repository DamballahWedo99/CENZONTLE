import pino from 'pino';

/**
 * Pino logger compartido por todos los módulos del worker.
 *
 * En development (`NODE_ENV !== 'production'`): usa `pino-pretty` para
 * output legible con colores.
 *
 * En production: JSON estructurado en stdout. Render/Vercel/CloudWatch
 * lo recogen automáticamente.
 *
 * Niveles: configurables via `LOG_LEVEL` env var. CLI flag `--verbose` lo
 * setea a `debug` programáticamente.
 */
// SAFE check: usar `=== 'development'` (positivo) en lugar de `!== 'production'`
// (negativo). Si `NODE_ENV` es undefined (ej. CI sin env, binario standalone),
// `!== 'production'` es true → intenta cargar pino-pretty que NO está disponible
// en producción (es devDep) → crash al import. (qa-reviewer F-10 LOW 2026-05-06)
const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    component: 'factory-worker',
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,component',
          },
        },
      }
    : {}),
});

/**
 * Helper para logs estructurados con `event` siempre presente.
 * Patrón: `logEvent('register.ok', { nodeId }, 'Registered as node')`.
 */
export function logEvent(
  event: string,
  data: Record<string, unknown>,
  message?: string,
): void {
  logger.info({ event, ...data }, message);
}
