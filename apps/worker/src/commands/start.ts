import { promises as fs } from 'fs';
import { join } from 'path';
import { ApiClient, ApiError } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import {
  runStory,
  getPendingCompletesDir,
  recoverOnePendingComplete,
  type ClaimedStory,
} from '../lib/runner.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_CLAIM_INTERVAL_MS = 5_000;
/**
 * Cuánto tiempo esperamos a que los runs activos terminen antes de hacer
 * exit forzado en SIGINT/SIGTERM. 60s es generoso para que claude pueda
 * terminar limpiamente; si excede, asumimos que está colgado y matamos.
 *
 * Refactor QA-reviewer F-05 2026-05-06: antes era 5s con `unref()` —
 * lo cual era peor que nada porque salía aunque hubiera runs corriendo.
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 60_000;
const SHUTDOWN_POLL_INTERVAL_MS = 500;

/**
 * Comando `factory-worker start`. Daemon que mantiene el nodo "alive" en el
 * dashboard mediante heartbeats periódicos (cada 30s).
 *
 * Sprint 1: solo heartbeat (no claim-story todavía).
 * Sprint 2: añade poll de claim-story + spawn Claude Code en worktree.
 *
 * Comportamiento:
 *  - Carga config de `~/.factory-worker/config.json` (debe haber `register`
 *    primero o falla con mensaje claro)
 *  - setInterval de 30s para heartbeat
 *  - SIGINT/SIGTERM → shutdown graceful (cancela heartbeat, exit 0)
 *
 * @param opts.slotsOverride si está set, ignora config.totalSlots y usa este
 *   valor. Útil para iterar concurrencia sin tener que correr `register`
 *   de nuevo (que persiste el cambio en disco).
 */
export async function startCommand(opts: { slotsOverride?: number } = {}): Promise<void> {
  const config = await loadConfig();
  if (!config || !config.nodeId) {
    logger.error(
      { event: 'start.fail', reason: 'not_registered' },
      'Worker not registered. Run `factory-worker register --dashboard <url> --token <token>` first.',
    );
    process.exit(1);
  }

  // Bootstrap del slot count:
  //  - Si pasaron `--slots N` flag → fija ese valor y NUNCA sincroniza con
  //    el backend (override explícito del operador, prioridad máxima).
  //  - Si NO hay flag → arranca con `config.totalSlots` (lo persistido en
  //    disk del último register) y el primer heartbeat lo sobrescribe con
  //    el valor del dashboard. Después se actualiza vivo cada 30s.
  //
  // El dashboard (UI) es la SOURCE OF TRUTH — si el operador cambia slots
  // de 4 a 8 en `/factory/settings/Nodos de cómputo`, el worker se entera
  // en el siguiente heartbeat sin necesidad de re-registrar.
  const slotsLocked = opts.slotsOverride !== undefined;
  let totalSlots = opts.slotsOverride ?? config.totalSlots;
  if (slotsLocked) {
    logger.info(
      { event: 'start.slots_override', registered: config.totalSlots, override: opts.slotsOverride },
      `Slot count locked via --slots flag (no sync with dashboard, fixed at ${opts.slotsOverride})`,
    );
  }

  const client = new ApiClient({
    dashboardUrl: config.dashboardUrl,
    token: config.token,
  });

  // Tracking de runs activos — `slotsUsed` se calcula del Set en cada heartbeat.
  // Cuando un run inicia entra al Set; al complete se remueve. Esto permite
  // backpressure: no hacemos claim si ya tenemos `totalSlots` runs activos.
  const activeRuns = new Set<string>();
  let shuttingDown = false;

  logger.info(
    {
      event: 'start.ok',
      nodeId: config.nodeId,
      dashboard: config.dashboardUrl,
      totalSlots,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      pollIntervalMs: POLL_CLAIM_INTERVAL_MS,
    },
    `Daemon started. Heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s, claim poll every ${POLL_CLAIM_INTERVAL_MS / 1000}s.`,
  );

  /**
   * Envoltura del heartbeat que sincroniza `totalSlots` desde la response
   * del backend cuando NO hay override de CLI. Esto hace que el dashboard
   * sea verdaderamente source of truth: el operador cambia slots en la UI
   * y el worker se actualiza al siguiente heartbeat sin re-registrar.
   */
  const heartbeatAndSync = async (): Promise<void> => {
    const result = await sendHeartbeat(client, activeRuns.size);
    if (slotsLocked || result === null) return;
    if (typeof result.totalSlots === 'number' && result.totalSlots !== totalSlots) {
      logger.info(
        { event: 'slots.synced', from: totalSlots, to: result.totalSlots },
        `Slot count synced from dashboard: ${totalSlots} → ${result.totalSlots}`,
      );
      totalSlots = result.totalSlots;
    }
  };

  // Primer heartbeat inmediato — confirma que la conexión funciona Y trae
  // el `totalSlots` del dashboard antes de que el poll loop empiece.
  await heartbeatAndSync();

  // Boot recovery — re-reportar `/complete` payloads que quedaron pendientes
  // en disco por fallos previos del backend (network down, restart en pleno
  // post). El daemon recién verificó conectividad arriba, así que es el
  // momento correcto para intentar drenar el backlog antes de empezar a
  // clamar nuevas stories. Fire-and-forget: si falla, no impide arranque.
  void recoverPendingCompletes(client).catch((err) => {
    logger.warn(
      { event: 'complete.recovery.boot_fail', error: (err as Error).message },
      'Boot recovery del pending-completes falló — se reintentará en el próximo restart',
    );
  });

  const heartbeatHandle = setInterval(() => {
    if (shuttingDown) return;
    void heartbeatAndSync();
  }, HEARTBEAT_INTERVAL_MS);

  // Loop de poll de claim-story: drain serial.
  //
  // En cada tick hago 1 request. Si el backend retorna una story, hago
  // INMEDIATAMENTE otro request (sin esperar 5s) hasta drenar la queue
  // (204 No Content) o llenar todos los slots libres. Si retorna 204
  // a la primera, paro y espero al siguiente tick.
  //
  // Por qué este patrón vs N requests paralelos por tick:
  //   - Queue vacío → 1 request/tick = 12/min (cabe en rate limit 15/min)
  //   - Queue con K stories → K requests rápidos UNA VEZ y luego idle
  //   - Burst paralelo desperdiciaba rate limit con 204s al queue vacío
  //
  // El paralelismo NO se pierde: `runStory` sigue siendo fire-and-forget
  // (`void`), así que K runs corren en paralelo aunque los CLAIMS sean
  // serial. Lo serial es solo la negociación con el backend (~ms cada una).
  const pollHandle = setInterval(() => {
    if (shuttingDown) return;
    if (activeRuns.size >= totalSlots) {
      logger.debug(
        { event: 'poll.skip', activeRuns: activeRuns.size, totalSlots },
        'All slots busy, skipping claim',
      );
      return;
    }
    void (async () => {
      while (!shuttingDown && activeRuns.size < totalSlots) {
        const claimed = await tryClaimAndRun(client, activeRuns, totalSlots);
        if (!claimed) break; // 204, error, o rate limit → para hasta el próximo tick
      }
    })();
  }, POLL_CLAIM_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const startedAt = Date.now();
    logger.info(
      { event: 'shutdown.start', signal, activeRuns: activeRuns.size },
      'Shutting down gracefully...',
    );
    clearInterval(heartbeatHandle);
    clearInterval(pollHandle);

    // Si no hay runs activos, exit inmediato.
    if (activeRuns.size === 0) {
      logger.info({ event: 'shutdown.complete', durationMs: 0 }, 'Goodbye.');
      process.exit(0);
    }

    // QA-reviewer F-05 2026-05-06: ESPERA REAL hasta que activeRuns drene
    // o expire el timeout. Antes era setTimeout(5s) sin verificación —
    // los runs se cortaban en seco aunque estuvieran a 1s de terminar.
    logger.warn(
      { event: 'shutdown.draining', count: activeRuns.size, timeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
      `Waiting up to ${SHUTDOWN_DRAIN_TIMEOUT_MS / 1000}s for ${activeRuns.size} active run(s) to finish...`,
    );

    // Poll loop: cada 500ms checa si activeRuns drenó. El runner.finally()
    // remueve runIds del Set cuando termina (success o fail) → cuando
    // size === 0 sabemos que todos los promises ya resolvieron.
    while (activeRuns.size > 0 && Date.now() - startedAt < SHUTDOWN_DRAIN_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_INTERVAL_MS));
    }

    const elapsedMs = Date.now() - startedAt;
    if (activeRuns.size > 0) {
      // Timeout — runs aún no terminan. Loguamos advertencia con runIds
      // para que ops pueda investigar (probablemente claude colgado).
      logger.error(
        {
          event: 'shutdown.timeout',
          stuckRuns: activeRuns.size,
          runIds: Array.from(activeRuns),
          elapsedMs,
        },
        `Shutdown timeout — ${activeRuns.size} run(s) still active. Backend sweeper will mark as abandoned.`,
      );
    } else {
      logger.info(
        { event: 'shutdown.complete', durationMs: elapsedMs },
        'All runs drained. Goodbye.',
      );
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

/**
 * Intenta reclamar una historia y, si lo logra, lanza el run en paralelo
 * (no bloquea el poll loop). El runId se trackea en `activeRuns` para
 * backpressure correcto.
 *
 * Retorna `true` si reclamó (caller debe seguir intentando para drenar
 * queue), `false` si no hay nada / error / rate limit (caller debe parar
 * hasta el próximo tick).
 */
async function tryClaimAndRun(
  client: ApiClient,
  activeRuns: Set<string>,
  totalSlots: number,
): Promise<boolean> {
  let claimed: ClaimedStory | null;
  try {
    // El response del claim es 204 (vacío) cuando no hay nada claimable,
    // o el payload completo cuando sí. ApiClient retorna `undefined` para
    // 204 — lo tratamos como null.
    const response = await client.post<ClaimedStory | undefined>(
      '/factory/workers/claim-story',
      undefined,
    );
    claimed = response ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      logger.error(
        { event: 'claim.unauthorized' },
        'Token rejected during claim — exiting',
      );
      process.exit(1);
    }
    if (err instanceof ApiError && err.status === 429) {
      // Rate limited — paramos el drain inmediatamente. El próximo tick
      // (5s después) reintenta y la ventana del rate limit ya habrá
      // movido. Logueamos warn sin spam — un solo log por tick basta.
      logger.warn(
        { event: 'claim.rate_limited' },
        'claim-story rate limited (429), waiting until next tick',
      );
      return false;
    }
    logger.warn(
      { event: 'claim.fail', error: (err as Error).message },
      'Claim request failed, will retry next cycle',
    );
    return false;
  }

  if (!claimed) {
    logger.debug({ event: 'claim.empty' }, 'No stories ready, polling again');
    return false;
  }

  // Trackea el run como activo ANTES del await — backpressure correcto
  // si el siguiente poll dispara mientras este run está corriendo.
  activeRuns.add(claimed.runId);
  logger.info(
    {
      event: 'claim.received',
      runId: claimed.runId,
      storyId: claimed.storyId,
      storyTitle: claimed.storyTitle,
      activeRuns: activeRuns.size,
      totalSlots,
    },
    'Story claimed, dispatching to runner',
  );

  // Dispatch fire-and-forget. El runner reporta back al backend
  // independientemente. Cuando termine, removemos del Set.
  void runStory(client, claimed)
    .catch((err) => {
      logger.error(
        {
          event: 'run.uncaught',
          runId: claimed!.runId,
          error: (err as Error).message,
          stack: (err as Error).stack,
        },
        'Uncaught error in runner — backend sweeper will mark abandoned',
      );
    })
    .finally(() => {
      activeRuns.delete(claimed!.runId);
    });

  return true;
}

interface HeartbeatResponse {
  ok?: boolean;
  nextHeartbeatInMs?: number;
  /** Slot count desde el dashboard — autoritative. */
  totalSlots?: number;
}

/**
 * Envía un heartbeat y devuelve la respuesta del backend (que incluye
 * `totalSlots` para sync dinámico). Devuelve `null` si la llamada falló
 * y NO debe sincronizarse — el caller mantiene su valor previo.
 */
async function sendHeartbeat(
  client: ApiClient,
  slotsUsed: number,
): Promise<HeartbeatResponse | null> {
  try {
    const response = await client.post<HeartbeatResponse>(
      '/factory/workers/heartbeat',
      { slotsUsed },
    );
    logger.debug({ event: 'heartbeat.sent', slotsUsed }, 'Heartbeat ok');
    return response ?? {};
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      logger.error(
        { event: 'heartbeat.unauthorized' },
        'Token rejected mid-flight — was the token revoked? Exiting.',
      );
      process.exit(1);
    }
    if (err instanceof ApiError && err.status === 404) {
      // Nodo retirado en el dashboard — ya no existe. Salir limpio.
      logger.error(
        { event: 'heartbeat.node_gone' },
        'Node has been retired in dashboard — exiting',
      );
      process.exit(1);
    }
    logger.warn(
      { event: 'heartbeat.fail', error: (err as Error).message, slotsUsed },
      'Heartbeat failed, will retry next cycle',
    );
    return null;
  }
}

/**
 * Boot recovery del directorio `~/.factory-worker/pending-completes/`.
 *
 * Cuando un run termina pero el `/complete` al backend falla persistentemente
 * (network outage, backend down durante el restart de dev), el worker persiste
 * el payload a disco en `{runId}.json`. Al arrancar el daemon de nuevo,
 * intentamos drenar ese directorio: para cada archivo, re-postear al backend.
 * En éxito → borrar el archivo; en 409/410 (run ya terminal) → borrar también
 * (no hay nada que recuperar); en otro error → conservar para el próximo boot.
 *
 * No fatal: errores individuales se loguean pero no detienen el arranque del
 * worker. El loop secuencial (no paralelo) es intencional — preserva el
 * orden de finalización y evita stampede sobre un backend que justo arrancó.
 */
async function recoverPendingCompletes(client: ApiClient): Promise<void> {
  const dir = getPendingCompletesDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    // ENOENT esperado en el primer arranque — no es error.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(
        { event: 'complete.recovery.skip', reason: 'no_dir' },
        'No pending-completes dir — boot recovery skip',
      );
      return;
    }
    logger.warn(
      {
        event: 'complete.recovery.boot_fail',
        error: (err as Error).message,
      },
      'No se pudo leer el directorio de pending-completes',
    );
    return;
  }
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    logger.debug(
      { event: 'complete.recovery.skip', reason: 'empty' },
      'No hay pending-completes para recuperar',
    );
    return;
  }
  logger.info(
    { event: 'complete.recovery.start', count: jsonFiles.length, dir },
    `[recovery] Re-reportando ${jsonFiles.length} pending-complete(s) al backend...`,
  );
  let recovered = 0;
  let pending = 0;
  for (const file of jsonFiles) {
    const filePath = join(dir, file);
    try {
      const ok = await recoverOnePendingComplete(client, filePath);
      if (ok) recovered += 1;
      else pending += 1;
    } catch (err) {
      // recoverOnePendingComplete no debe throwear, pero defensa en profundidad
      pending += 1;
      logger.warn(
        {
          event: 'complete.recovery.unexpected_error',
          filePath,
          error: (err as Error).message,
        },
        'Error inesperado en recoverOnePendingComplete',
      );
    }
  }
  logger.info(
    {
      event: 'complete.recovery.done',
      total: jsonFiles.length,
      recovered,
      stillPending: pending,
    },
    `[recovery] Resumen: ${recovered}/${jsonFiles.length} reportados, ${pending} aún pendientes`,
  );
}
