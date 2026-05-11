import { hostname, type, release } from 'os';
import { ApiClient, ApiError } from '../lib/api-client.js';
import { saveConfig, loadConfig } from '../lib/config.js';
import { logger } from '../lib/logger.js';

interface RegisterOptions {
  dashboardUrl: string;
  token: string;
  totalSlots: number;
}

interface RegisterResponse {
  nodeId: string;
  name: string;
}

/**
 * Comando `factory-worker register --dashboard <url> --token worker_xxx`.
 *
 * Hace el handshake inicial con el backend:
 *  1. Manda os/hostname/totalSlots
 *  2. Backend valida el token, marca el nodo `online`, retorna `nodeId`
 *  3. Worker guarda `{dashboardUrl, token, nodeId, totalSlots}` en
 *     `~/.factory-worker/config.json` para que el daemon `start` lo lea.
 */
export async function registerCommand(opts: RegisterOptions): Promise<void> {
  const reportedOs = `${type()} ${release()}`;
  const reportedHostname = hostname();

  logger.info(
    {
      event: 'register.start',
      dashboard: opts.dashboardUrl,
      tokenPrefix: opts.token.slice(0, 12),
      hostname: reportedHostname,
      os: reportedOs,
      totalSlots: opts.totalSlots,
    },
    'Connecting to dashboard',
  );

  const client = new ApiClient({ dashboardUrl: opts.dashboardUrl, token: opts.token });

  let response: RegisterResponse;
  try {
    response = await client.post<RegisterResponse>('/factory/workers/register', {
      os: reportedOs,
      hostname: reportedHostname,
      totalSlots: opts.totalSlots,
      version: '0.1.0',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      logger.error(
        { event: 'register.fail', reason: 'unauthorized' },
        'Token rejected — verify it is correct and not revoked',
      );
      process.exit(1);
    }
    logger.error(
      { event: 'register.fail', error: (err as Error).message },
      'Registration failed',
    );
    process.exit(1);
  }

  // Sobrescribe config existente si la había (re-registration es idempotente).
  const existing = await loadConfig();
  await saveConfig({
    dashboardUrl: opts.dashboardUrl,
    token: opts.token,
    totalSlots: opts.totalSlots,
    nodeId: response.nodeId,
  });

  logger.info(
    {
      event: 'register.ok',
      nodeId: response.nodeId,
      nodeName: response.name,
      replaced: existing !== null,
    },
    `Registered as "${response.name}". Run 'factory-worker start' to begin heartbeat.`,
  );
}
