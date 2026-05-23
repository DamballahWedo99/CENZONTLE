// ════════════════════════════════════════════════════════════════════════
// secrets.ts — secretos externos del org en el worker del Forge
// ════════════════════════════════════════════════════════════════════════
//
// El backend forwardea TODOS los `ExternalSecret` de la org (API keys de
// Stripe/Twilio/Amadeus/etc.) en cada `ClaimedStory`, ya desencriptados.
// Este módulo centraliza el manejo seguro de esos valores:
//
//   - `sanitizeExternalSecrets` — descarta nombres reservados/inválidos.
//   - `buildSecretEnv`          — mapa `name → value` para los spawns.
//   - `serializeDotenv`         — render `.env` con quoting seguro.
//   - `makeRedactor`            — redacción del output (por valor exacto +
//                                 patrones estáticos por prefijo).
//
// Vive aparte de `runner.ts`/`dod-verifier.ts` por dos razones: evita
// duplicar la lógica entre los callsites (el runner spawnea `claude`, el
// verifier corre `pnpm test`), y es unit-testeable sin levantar el flow.
//
// Contrato de seguridad: ver `ExternalSecretForWorker` en
// `@cenzontle/shared`. En resumen — los valores nunca se loguean, el `.env`
// es efímero (modo 0600, gitignoreado, borrado pre-commit), y el output del
// agente se redacta por el valor literal antes de persistirse.

import type { ExternalSecretForWorker } from '@cenzontle/shared';
import { logger } from './logger.js';

/**
 * Nombres de variables de entorno que un `ExternalSecret` NO puede usar:
 * pisarlas corrompería el proceso hijo (`claude`, `pnpm test`, `git`).
 *
 *  - `PATH`/`HOME`/`USER`/`LANG` — el spawn las setea explícitamente; un
 *    secret con ese nombre rompería la resolución de binarios o el HOME.
 *  - `ANTHROPIC_API_KEY` — desviaría la facturación del coder/verifier.
 *  - `NODE_OPTIONS`/`LD_PRELOAD`/`LD_LIBRARY_PATH` — vectores clásicos de
 *    inyección de código en el proceso hijo.
 *  - `CI` — altera el comportamiento de test runners y build tools.
 *  - El prefijo `GIT_*` (`GIT_DIR`, `GIT_INDEX_FILE`, …) se rechaza aparte
 *    en `sanitizeExternalSecrets` — desviaría las operaciones git.
 *
 * Defensa en profundidad: el backend ya rechaza estos nombres al crear el
 * secret (`create-external-secret.dto.ts` → `RESERVED_ENV_NAMES`), pero el
 * worker filtra de nuevo — un claim de un backend desincronizado, o un
 * secret creado antes de que la validación existiera, no debe poder pisar
 * una env var crítica. Mantener ambas listas en sync.
 */
export const RESERVED_ENV_NAMES: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'CI',
  'ANTHROPIC_API_KEY',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
]);

/**
 * Identificador de variable de entorno válido para POSIX: empieza con letra
 * o `_`, sigue con alfanuméricos o `_`. A propósito más permisivo que el
 * contrato UPPER_SNAKE del backend — esto es un filtro defensivo de runtime,
 * no la validación de input. Rechaza nombres con espacios, `=`, `-`, etc.
 * que romperían el `.env` o el objeto `env` del spawn.
 */
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Longitud mínima de un valor para redactarlo por valor exacto sin riesgo
 * de sobre-redacción. Un valor más corto (ej. "1234") borraría todas sus
 * apariciones legítimas del output. `sanitizeExternalSecrets` descarta los
 * valores `< 8` chars: no se pueden proteger (ni redactar del output ni
 * escanear en un diff) y forwardearlos sería un secreto sin defensa posible.
 */
const MIN_REDACTABLE_LENGTH = 8;

/**
 * Filtra la lista de secretos del claim, descartando los que no se pueden
 * inyectar con seguridad como variable de entorno:
 *  - nombre que no es un identificador de env var válido,
 *  - valor que no es un string (claim malformado),
 *  - nombre reservado (`RESERVED_ENV_NAMES`) o con prefijo `GIT_`.
 * Cada descarte emite `logger.error` — es una anomalía, el backend ya
 * debería haberlo rechazado en origen.
 *
 * Los valores `< MIN_REDACTABLE_LENGTH` chars también SE DESCARTAN (con
 * `logger.error`): un valor tan corto no se puede redactar del output ni
 * escanear en un diff sin falsos positivos masivos, así que forwardearlo
 * sería un secreto sin protección posible. Real-world las API keys de
 * terceros son siempre largas — un valor corto es casi siempre un error de
 * configuración del operador.
 *
 * NUNCA loguea el valor de un secreto, solo el `name`.
 */
export function sanitizeExternalSecrets(
  secrets: ExternalSecretForWorker[],
): ExternalSecretForWorker[] {
  const safe: ExternalSecretForWorker[] = [];
  for (const secret of secrets) {
    const name = secret?.name;
    if (typeof name !== 'string' || !VALID_ENV_NAME.test(name)) {
      logger.error(
        { event: 'secrets.sanitize.invalid_name', name: String(name) },
        `External secret descartado: nombre "${String(name)}" no es un ` +
          `identificador de variable de entorno válido`,
      );
      continue;
    }
    if (RESERVED_ENV_NAMES.has(name) || name.startsWith('GIT_')) {
      logger.error(
        { event: 'secrets.sanitize.reserved_name', name },
        `External secret descartado: "${name}" colisiona con una variable ` +
          `de entorno reservada del sistema`,
      );
      continue;
    }
    if (typeof secret.value !== 'string' || secret.value.length === 0) {
      logger.error(
        { event: 'secrets.sanitize.invalid_value', name },
        `External secret "${name}" descartado: el valor está vacío o no es ` +
          `un string`,
      );
      continue;
    }
    if (secret.value.length < MIN_REDACTABLE_LENGTH) {
      logger.error(
        {
          event: 'secrets.sanitize.short_value',
          name,
          valueLength: secret.value.length,
        },
        `External secret "${name}" DESCARTADO: su valor tiene ` +
          `${secret.value.length} chars (< ${MIN_REDACTABLE_LENGTH}) — un ` +
          `valor tan corto no se puede redactar del output ni escanear en el ` +
          `diff con seguridad, así que NO se forwardea al agente`,
      );
      continue;
    }
    safe.push({ name, value: secret.value, vendor: secret.vendor ?? null });
  }
  return safe;
}

/**
 * Construye el mapa `name → value` para pasar como `env` a un spawn. Asume
 * que `secrets` ya pasó por `sanitizeExternalSecrets`.
 *
 * IMPORTANTE para el caller: este objeto debe ir ANTES de las env vars
 * fijas en el spread — `{ ...buildSecretEnv(safe), HOME, PATH, … }` — para
 * que si un nombre (pese al filtro) colisionara con una var fija, la fija
 * lo pise. Nunca al revés.
 */
export function buildSecretEnv(
  secrets: ExternalSecretForWorker[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const secret of secrets) {
    env[secret.name] = secret.value;
  }
  return env;
}

/**
 * Serializa los secretos a formato `.env` (`NAME="value"`, una por línea).
 * Asume que `secrets` ya pasó por `sanitizeExternalSecrets`.
 *
 * El valor SIEMPRE se envuelve en comillas dobles, con `\`, `"`, `\n` y
 * `\r` escapados. Escapar `\n` es lo crítico para la seguridad: un valor
 * con un salto de línea real podría, sin escape, inyectar una línea
 * `NAME=value` extra en el `.env`. Escapar `"` impide cerrar el string
 * antes de tiempo. Para el caso realista (API keys alfanuméricas) ninguna
 * regex matchea y el valor queda intacto.
 *
 * El `.env` es un canal de conveniencia para frameworks file-based
 * (Next.js/Vite). El canal autoritativo siguen siendo las env vars del
 * spawn (`buildSecretEnv`) — si un valor patológico no round-trippea por
 * algún parser de `.env`, el valor exacto igual llegó vía `process.env`.
 */
export function serializeDotenv(secrets: ExternalSecretForWorker[]): string {
  if (secrets.length === 0) return '';
  const lines = secrets.map((s) => {
    const escaped = s.value
      .replace(/\\/g, '\\\\') // backslash primero, para no doble-escapar
      .replace(/"/g, '\\"') // comillas que cerrarían el string
      .replace(/\n/g, '\\n') // newline → evita inyectar líneas NAME=v extra
      .replace(/\r/g, '\\r');
    return `${s.name}="${escaped}"`;
  });
  return lines.join('\n') + '\n';
}

/**
 * Escanea el texto de un `git diff` por los valores literales de secretos,
 * mirando SOLO las líneas AÑADIDAS (`+`, excluyendo el header `+++`). Una
 * línea de contexto o eliminada que contenga un secreto no es una fuga que
 * el agente esté introduciendo en este commit — así se evitan falsos
 * positivos cuando el secreto ya vivía en la branch base.
 *
 * Devuelve los NOMBRES de los secretos cuyo valor aparece en alguna línea
 * añadida. Solo considera valores `>= MIN_REDACTABLE_LENGTH` chars (un valor
 * corto daría demasiados falsos positivos — mismo criterio que la redacción).
 *
 * Lo usa el worker antes del `git push`: si devuelve algo, el agente
 * incrustó el valor de un secreto en un archivo commiteado (en vez de leerlo
 * de `process.env`) y el push se aborta (ver `runner.ts`).
 */
export function scanDiffForSecrets(
  diffText: string,
  secrets: ExternalSecretForWorker[],
): string[] {
  const addedLines = diffText
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');
  if (addedLines.length === 0) return [];
  return secrets
    .filter(
      (s) =>
        typeof s.value === 'string' &&
        s.value.length >= MIN_REDACTABLE_LENGTH &&
        addedLines.includes(s.value),
    )
    .map((s) => s.name);
}

/**
 * Patrones de redacción por PREFIJO — cubren secretos con formato conocido
 * (claves `sk-ant-`, tokens `ghp_`, credenciales en URLs, etc.). Se aplican
 * al output del agente ANTES de escribirlo al log file (que el frontend lee
 * vía `tail -f`) y de mandarlo al backend (security-reviewer F-02).
 *
 * NO cubren los secretos externos del org (Stripe/Twilio/Amadeus): esos
 * tienen formato arbitrario y no matchean ningún prefijo — se redactan por
 * VALOR EXACTO en `makeRedactor`.
 */
const REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Anthropic / OpenAI / generic sk- keys (incluye sk-proj-AB-CD- con dashes)
  [/sk-ant-[a-zA-Z0-9_-]+/g, 'sk-ant-[REDACTED]'],
  [/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-[REDACTED]'],
  [/sk_live_[a-zA-Z0-9]{20,}/g, 'sk_live_[REDACTED]'], // Stripe live secret
  [/rk_live_[a-zA-Z0-9]{20,}/g, 'rk_live_[REDACTED]'], // Stripe restricted key
  // GitHub
  [/ghp_[A-Za-z0-9]{30,}/g, 'ghp_[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]{22,}/g, 'github_pat_[REDACTED]'],
  [/gho_[A-Za-z0-9]{30,}/g, 'gho_[REDACTED]'], // OAuth tokens
  [/ghs_[A-Za-z0-9]{30,}/g, 'ghs_[REDACTED]'], // server-to-server
  // GitLab
  [/glpat-[A-Za-z0-9_-]{20,}/g, 'glpat-[REDACTED]'],
  // AWS
  [/(AKIA|ASIA)[A-Z0-9]{16}/g, '[AWS_ACCESS_KEY_REDACTED]'],
  // Slack
  [/xox[abposr]-[A-Za-z0-9-]{10,}/g, 'xox[REDACTED]'],
  // Google API
  [/AIza[0-9A-Za-z_-]{35}/g, 'AIza[REDACTED]'],
  // Credenciales en URLs (cubre x-access-token: y user:pass@ genérico)
  [/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@'],
  [
    /(https?|postgres|postgresql|mongodb|redis|amqp|mysql):\/\/[^:\s]+:[^@\s]+@/g,
    '$1://[CREDS_REDACTED]@',
  ],
  // Worker tokens del propio fleet
  [/worker_[a-z2-7]{20,}/g, 'worker_[REDACTED]'],
  // JWT en headers Bearer (genérico)
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
];

/**
 * Construye un redactor del output del agente. Redacta en dos pasadas:
 *
 *  1. **Por valor exacto** — cada secreto externo del org se reemplaza por
 *     `[REDACTED]` allá donde aparezca literalmente. Necesario porque los
 *     secretos de terceros NO matchean los patrones por prefijo. Solo se
 *     redactan valores de `>= MIN_REDACTABLE_LENGTH` chars: uno más corto
 *     causaría sobre-redacción masiva. El reemplazo es por substring
 *     LITERAL (`String.prototype.replaceAll` con string, no regex), así
 *     que un valor con metacaracteres (`.`, `*`, `$`) se redacta tal cual.
 *  2. **Por patrón** — los `REDACTION_PATTERNS` estáticos.
 *
 * El orden importa: primero por valor (el secreto literal), después por
 * patrón. Los valores se ordenan por longitud DESC — si un valor es
 * substring de otro, redactar el más largo primero evita dejar expuesto
 * el fragmento sobrante.
 *
 * `makeRedactor([])` reproduce exactamente la redacción legacy de
 * solo-patrones (ver `redactSecrets`).
 *
 * Filosofía: mejor falsa-positiva (algo legítimo redactado de más) que
 * falsa-negativa (un secreto persistido en DB / visible en el iframe).
 */
export function makeRedactor(secretValues: string[]): (text: string) => string {
  // Solo valores suficientemente largos para redactar sin sobre-redactar.
  // Dedup vía Set; orden por longitud DESC para manejar substrings anidados.
  const redactable = Array.from(
    new Set(
      secretValues.filter(
        (v) => typeof v === 'string' && v.length >= MIN_REDACTABLE_LENGTH,
      ),
    ),
  ).sort((a, b) => b.length - a.length);

  return (text: string): string => {
    if (!text) return text;
    let out = text;
    // Pasada 1 — por valor exacto (substring literal, sin interpretación regex).
    for (const value of redactable) {
      out = out.replaceAll(value, '[REDACTED]');
    }
    // Pasada 2 — patrones estáticos por prefijo.
    for (const [pattern, replacement] of REDACTION_PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  };
}

/**
 * Redactor solo-patrones (sin secretos por valor). Equivale a la
 * `redactSecrets` legacy del worker — se mantiene exportado para callers y
 * tests que no tienen secretos externos en contexto.
 */
export const redactSecrets = makeRedactor([]);
