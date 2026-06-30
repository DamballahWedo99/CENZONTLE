import { scrubSecrets } from '../../../common/utils/scrub-secrets.util';

/**
 * Constantes del pipeline de QA automático. Los modelos están hardcodeados
 * aquí (no en AgentTokenSettings) siguiendo el precedente del
 * ConflictResolverService, que también hardcodea su `SONNET_MODEL` — mantiene
 * el módulo QA self-contained sin tocar la superficie de settings.
 */

/** Modelos Claude por rol del pipeline QA. */
export const QA_MODELS = {
  /** Refutadores adversariales — necesitan capacidad de razonamiento. */
  verifier: 'claude-sonnet-4-6',
  /** Revisión de seguridad sobre el diff mergeado. */
  security: 'claude-sonnet-4-6',
  /** Narrativa del QAReport. */
  synthesizer: 'claude-sonnet-4-6',
} as const;

/** Número de refutadores por fallo. Impar → sin empates en la mayoría. */
export const QA_REFUTER_COUNT = 3;

/**
 * Backpressure: máximo de campañas QA corriendo en paralelo. Cada campaña
 * clona + instala + sirve el app en el host del API, así que limitamos para
 * no saturar CPU/RAM/puertos (mismo espíritu que el slot-cap de la flota).
 */
export const QA_MAX_CONCURRENT_RUNS = 2;

/** Timeout por lente (build/serve/run incluidos). */
export const QA_LENS_TIMEOUT_MS = 10 * 60 * 1000;

/** Timeout del `install` del workspace compartido. */
export const QA_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** Timeout del clone del repo. */
export const QA_CLONE_TIMEOUT_MS = 3 * 60 * 1000;

/** Cuánto esperamos a que el dev server efímero acepte conexiones. */
export const QA_SERVE_READY_TIMEOUT_MS = 60_000;

/** El sweeper marca un lente `abandoned` si no progresa en este tiempo. */
export const QA_STALE_LENS_MS = 20 * 60 * 1000;

/** Rango de puertos para los entornos efímeros (separado del 9200-9299 del
 *  PreviewService para no colisionar con previews manuales del operador). */
export const QA_PORT_MIN = 9300;
export const QA_PORT_MAX = 9399;

// Pricing Sonnet 4.6 por token — idéntico al ConflictResolver/Planner. No hay
// tarifa de cache porque las llamadas QA no usan prompt caching.
export const SONNET_INPUT_PRICE_PER_TOKEN = 0.000003;
export const SONNET_OUTPUT_PRICE_PER_TOKEN = 0.000015;

export function estimateSonnetCostUsd(
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    inputTokens * SONNET_INPUT_PRICE_PER_TOKEN +
    outputTokens * SONNET_OUTPUT_PRICE_PER_TOKEN
  );
}

/**
 * Patrones de secretos para DETECCIÓN (el escaneo diferencial del lente de
 * seguridad los usa para crear findings "posible secreto hardcodeado", de ahí
 * los labels). Para REDACTAR la evidencia se usa el scrubber canónico
 * `scrubSecrets` (más completo: JWT, github_pat_, ghs_/ghu_/gho_, sk-proj-,
 * etc.), no esta lista — ver `redactSecrets` abajo.
 */
export const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-ant-[a-zA-Z0-9_-]{20,}/, label: 'Anthropic API key' },
  { re: /ghp_[a-zA-Z0-9]{30,}/, label: 'GitHub PAT' },
  { re: /gho_[a-zA-Z0-9]{30,}/, label: 'GitHub OAuth token' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'Private key' },
  { re: /xox[baprs]-[a-zA-Z0-9-]{10,}/, label: 'Slack token' },
  // x-access-token:<token>@ — credencial embebida en URL de clone de git.
  { re: /x-access-token:[^@\s]+@/, label: 'Git clone token' },
];

/**
 * Redacta cualquier secreto conocido de un texto antes de persistirlo o
 * exponerlo. Crítico: la evidencia de los lentes (salida de tests, body del
 * app servido, líneas del diff) puede contener secretos del código generado.
 *
 * Delega en el scrubber canónico del backend (`scrubSecrets`) — más completo
 * que una lista propia y mantenido en un solo lugar (DRY); cubre JWT, PATs
 * fine-grained, sk-proj-, claves PEM, Basic-auth en URLs, etc.
 */
export function redactSecrets(text: string): string {
  return scrubSecrets(text);
}
