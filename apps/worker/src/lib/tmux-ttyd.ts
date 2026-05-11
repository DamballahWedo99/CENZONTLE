import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { hostname } from 'os';
import { createServer } from 'net';
import { logger } from './logger.js';

/**
 * Helper para arrancar `tail -f LOG_FILE` dentro de tmux + ttyd, exponiendo
 * el log al frontend del Forge como terminal en streaming view-only.
 *
 * Esto es HITO 1.5 — Opción B (pivote 2026-05-08): tras intentar correr
 * claude TUI interactivo dentro del pane (quoting hell, bypass-screen
 * fragility, timing no determinístico), pivoteamos a un patrón más simple
 * y deterministico:
 *
 *   1. El runner spawn-ea `claude -p PROMPT` directamente como antes
 *      (modo headless — sin TUI, sin escape codes raw, exit code claro).
 *   2. Stdout/stderr de claude se escriben (redactados) a un archivo log.
 *   3. tmux corre `tail -f LOG_FILE` y ttyd lo expone vía HTTP.
 *   4. El frontend incrusta el iframe — ve el output fluyendo en tiempo
 *      real como streaming, sin escape codes.
 *
 * Trade-off aceptado: el user NO puede interactuar con claude desde el
 * iframe (no hay TUI corriendo, solo tail). A cambio: confiabilidad total,
 * cero quoting issues, cero timing flaky.
 */

export interface TtydSession {
  /** Puerto que ttyd está escuchando (random en rango 8000-8999). */
  port: number;
  /** URL completa del ttyd (http://hostname:port/) — para reportar al backend. */
  ttydUrl: string;
  /** Path al archivo log que tail -f está siguiendo. */
  outputLogPath: string;
  /** Socket name único de tmux (para no colisionar con tmux sessions del user). */
  tmuxSocket: string;
  /** Process del ttyd — cleanupSession lo mata. */
  ttydProcess: ChildProcess;
}

/** Resuelve el binario `tmux` o lanza con mensaje accionable. */
export function resolveTmuxBin(): string {
  const candidate = process.env.TMUX_BIN ?? 'tmux';
  const result = spawnSync(candidate, ['-V'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `tmux no encontrado en PATH (probado "${candidate}"). ` +
        `Instala con: brew install tmux (macOS) o apt install tmux (Linux). ` +
        `Set TMUX_BIN env var si está en otro path.`,
    );
  }
  return candidate;
}

/** Resuelve el binario `ttyd` o lanza con mensaje accionable. */
export function resolveTtydBin(): string {
  const candidate = process.env.TTYD_BIN ?? 'ttyd';
  const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `ttyd no encontrado en PATH (probado "${candidate}"). ` +
        `Instala con: brew install ttyd (macOS) o ` +
        `https://github.com/tsl0922/ttyd#installation (Linux). ` +
        `Set TTYD_BIN env var si está en otro path.`,
    );
  }
  return candidate;
}

/** Determina si el host tiene tmux+ttyd disponibles. Sin throw. */
export function hasTmuxAndTtyd(): boolean {
  try {
    resolveTmuxBin();
    resolveTtydBin();
    return true;
  } catch {
    return false;
  }
}

/**
 * Busca un puerto TCP libre en rango 8000-8999. Lanza si no encuentra
 * ninguno tras 50 intentos (improbable salvo carga extrema).
 */
async function findFreePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = 8000 + Math.floor(Math.random() * 1000);
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('No free port found in range 8000-8999 after 50 attempts');
}

/**
 * Determina el hostname al que el frontend va a conectar el iframe del
 * ttyd. En desarrollo local, esto es `localhost`. En producción multi-host,
 * podría ser el hostname externo del worker — set FACTORY_WORKER_PUBLIC_HOST
 * para override.
 */
function resolvePublicHost(): string {
  return process.env.FACTORY_WORKER_PUBLIC_HOST ?? 'localhost';
}

/**
 * Arranca `tail -f LOG_FILE` dentro de tmux y expone el pane via ttyd.
 * El caller es responsable de:
 *   - Crear el archivo `logFilePath` (con `fs.writeFile(path, '')`) ANTES
 *     de llamar a esta función — `tail -f` falla si el archivo no existe.
 *   - Escribir output (redactado) al archivo conforme claude corre.
 *   - Llamar a `cleanupSession` cuando termine.
 *
 * Retorna `TtydSession` con la URL pública para reportar al backend.
 */
export async function startTailFollowSession(input: {
  runId: string;
  /** Path absoluto al archivo log que tail -f va a seguir. DEBE existir. */
  logFilePath: string;
}): Promise<TtydSession> {
  const tmuxBin = resolveTmuxBin();
  const ttydBin = resolveTtydBin();
  const port = await findFreePort();
  const publicHost = resolvePublicHost();
  const ttydUrl = `http://${publicHost}:${port}/`;

  const tmuxSocket = `cenzontle-${input.runId.slice(0, 8)}`;
  const sessionName = 'main';

  // 1. Verificar que el log file existe (tail -f falla si no). El caller
  //    debe haberlo creado antes — emitimos un error claro si no.
  try {
    await fs.access(input.logFilePath);
  } catch {
    throw new Error(
      `Log file ${input.logFilePath} no existe. El caller debe crearlo (touch) ` +
        `ANTES de llamar a startTailFollowSession.`,
    );
  }

  // 2. Crear sesión tmux con socket dedicado (-L) corriendo tail -f.
  //    -d = detached, -x/-y = tamaño del pane.
  //    Pasamos `tail -f LOG_FILE` como comando inicial — tmux lo arranca
  //    directamente en el pane sin necesidad de send-keys ni quoting.
  const newSession = spawnSync(
    tmuxBin,
    [
      '-L',
      tmuxSocket,
      'new-session',
      '-d',
      '-s',
      sessionName,
      '-x',
      '220',
      '-y',
      '50',
      'tail',
      '-f',
      input.logFilePath,
    ],
    { stdio: 'pipe' },
  );
  if (newSession.status !== 0) {
    throw new Error(
      `tmux new-session falló: ${newSession.stderr?.toString() ?? 'sin output'}`,
    );
  }

  logger.info(
    { event: 'tmux.tail.started', runId: input.runId, logFilePath: input.logFilePath, tmuxSocket },
    `tmux corriendo tail -f del log file`,
  );

  // 3. Arrancar ttyd contra la sesión. SIN --writable: el iframe es view-only
  //    (no hay claude interactivo, solo un tail). Esto previene que el user
  //    pueda accidentalmente Ctrl-C el tail y romper el streaming.
  //    --max-clients 4 = soporta hasta 4 viewers concurrentes.
  const ttydArgs = [
    '--port',
    String(port),
    '--max-clients',
    '4',
    '-t',
    'fontSize=13',
    '-t',
    'theme={"background":"#0a0a0a","foreground":"#d4d4d4"}',
    tmuxBin,
    '-L',
    tmuxSocket,
    'attach-session',
    '-t',
    sessionName,
  ];

  const ttydProcess = spawn(ttydBin, ttydArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  ttydProcess.stdout?.on('data', (chunk: Buffer) => {
    logger.debug({ event: 'ttyd.stdout', runId: input.runId }, chunk.toString().trim());
  });
  ttydProcess.stderr?.on('data', (chunk: Buffer) => {
    logger.debug({ event: 'ttyd.stderr', runId: input.runId }, chunk.toString().trim());
  });
  ttydProcess.on('error', (err) => {
    logger.error({ event: 'ttyd.error', runId: input.runId, error: err.message }, 'ttyd error');
  });

  // Pequeña espera para que ttyd levante. Si falla, se ve en los logs y el
  // primer fetch al iframe va a fallar — el frontend muestra error.
  await new Promise((resolve) => setTimeout(resolve, 500));

  logger.info(
    { event: 'ttyd.ready', runId: input.runId, port, ttydUrl, tmuxSocket },
    `ttyd ready at ${ttydUrl} (tmux socket=${tmuxSocket})`,
  );

  return {
    port,
    ttydUrl,
    outputLogPath: input.logFilePath,
    tmuxSocket,
    ttydProcess,
  };
}

/**
 * Lee las últimas N bytes del log file. Usado por el worker para reportar
 * lastOutput al backend en cada progress.
 */
export async function readOutputTail(outputLogPath: string, maxBytes: number): Promise<string> {
  try {
    const stat = await fs.stat(outputLogPath);
    if (stat.size === 0) return '';
    const start = Math.max(0, stat.size - maxBytes);
    const handle = await fs.open(outputLogPath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Mata ttyd + tmux session + borra archivos temporales. Idempotente:
 * llamarlo varias veces no rompe nada.
 */
export async function cleanupSession(session: TtydSession): Promise<void> {
  // Kill ttyd primero (cierra el HTTP server)
  try {
    if (!session.ttydProcess.killed) {
      session.ttydProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!session.ttydProcess.killed) {
        session.ttydProcess.kill('SIGKILL');
      }
    }
  } catch (err) {
    logger.warn({ event: 'ttyd.kill.fail', error: (err as Error).message }, 'Failed to kill ttyd');
  }

  // Kill server tmux (mata todas las sesiones del socket dedicado, incluido
  // el `tail -f` que sigue corriendo)
  try {
    const tmuxBin = resolveTmuxBin();
    spawnSync(tmuxBin, ['-L', session.tmuxSocket, 'kill-server'], {
      stdio: 'ignore',
      timeout: 3000,
    });
  } catch (err) {
    logger.warn({ event: 'tmux.kill.fail', error: (err as Error).message }, 'Failed to kill tmux server');
  }

  // Cleanup archivo de log
  try {
    await fs.unlink(session.outputLogPath);
  } catch {
    // ok si no existe
  }
}

// Exportado para futuras integraciones (e.g. health check en heartbeat)
export function getTtydPublicUrl(port: number): string {
  return `http://${resolvePublicHost()}:${port}/`;
}

// Re-exportamos hostname para que el caller pueda loggear si quiere
export { hostname };
