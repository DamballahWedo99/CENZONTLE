import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from './logger.js';

/**
 * Configuración persistente del worker — vive en `~/.factory-worker/config.json`
 * con permisos 0600 (solo el user puede leerla).
 *
 * Almacena el token plaintext localmente para que el daemon (`factory-worker
 * start`) no lo necesite cada vez en CLI args. Esto significa que cualquier
 * proceso corriendo como el mismo user puede leerlo — aceptable para un
 * worker local que ya tiene acceso a Anthropic API key, GitHub token, etc.
 */
export interface WorkerConfig {
  dashboardUrl: string;
  token: string;
  /** Slots concurrentes que el nodo acepta. Default 1 — usuario lo overridea con --slots. */
  totalSlots: number;
  /** UUID del nodo asignado por el backend al `register`. Persiste para que
   * heartbeat/poll futuros sepan a qué nodeId pertenecen sin pedir register
   * cada vez. */
  nodeId?: string;
}

const CONFIG_DIR = join(homedir(), '.factory-worker');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export async function loadConfig(): Promise<WorkerConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as WorkerConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.error({ err: (err as Error).message }, 'Failed to load config');
    throw err;
  }
}

export async function saveConfig(config: WorkerConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  logger.debug({ path: CONFIG_PATH }, 'Config saved');
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
