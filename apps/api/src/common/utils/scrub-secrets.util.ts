/**
 * Redacción de secretos: quita patrones de tokens, claves API y URLs con
 * credenciales embebidas antes de loggear, emitir por SSE, o persistir en
 * cache. Defensa contra prompt injection y filtrado accidental en errores.
 *
 * Patrones cubiertos:
 *  - Claves privadas PEM (bloques BEGIN/END ... PRIVATE KEY ...)
 *  - JWT (triple-segmento eyJ.eyJ.firma)
 *  - GitHub PATs: classic (ghp_), fine-grained (github_pat_), OAuth (gho_),
 *    server-to-server (ghs_), user-to-server (ghu_).
 *  - OpenAI: proyecto (sk-proj-), Anthropic (sk-ant-), genérico (sk-).
 *  - Slack: bot (xoxb-), user (xoxp-), y tokens alternos (xoxa-, xoxs-, xoxr-).
 *  - Stripe: live (sk_live_), test (sk_test_).
 *  - Google API key (AIza...).
 *  - AWS Access Key (AKIA...) y Secret Access Key en contexto clave=valor.
 *  - URLs con `x-access-token:<token>@` (clone URL autenticada a GitHub).
 *  - URLs con Basic auth embebido (`https://user:pass@host/...`).
 *
 * ORDEN IMPORTA — los patrones más específicos se aplican ANTES de los más
 * genéricos. En particular:
 *  - Claves PEM primero: el cuerpo contiene caracteres base64 que podrían
 *    hacer match parcial con otros patrones.
 *  - JWT antes que cualquier otro: su forma triple-segmento es distintiva.
 *  - `sk-proj-` y `sk-ant-` ANTES de `sk-` genérico, para que el prefijo
 *    específico gane el reemplazo (si `sk-` va primero, consume el prefijo
 *    y convierte el match en `sk-<REDACTED>` sin distinguir proveedor).
 *  - `sk_live_` / `sk_test_` ANTES de `sk-` por la misma razón (nota que
 *    Stripe usa guion bajo, OpenAI usa guion medio — no solapan, pero
 *    mantener el orden específico→genérico previene regresiones).
 *  - `x-access-token:...@` ANTES del Basic auth genérico en URL, para que
 *    el caso específico gane.
 *
 * Esta función es pura y sin dependencias — se puede importar desde cualquier
 * módulo del backend (servicios de clone, SSE pipeline, cache Redis, etc.).
 * La firma `scrubSecrets(text: string): string` es estable.
 */
export function scrubSecrets(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text
    // Bloques PEM (RSA, EC, OPENSSH, ENCRYPTED, etc.) — lo más específico
    // y lo más destructivo si se filtra, así que va primero.
    .replace(
      /-----BEGIN[\s\w]+PRIVATE KEY-----[\s\S]+?-----END[\s\w]+PRIVATE KEY-----/g,
      '<REDACTED_PRIVATE_KEY>',
    )
    // JWT (header.payload.signature — tres segmentos base64url, los dos
    // primeros empiezan con "eyJ" una vez decodificados como JSON).
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '<REDACTED_JWT>',
    )
    // AWS Secret Access Key en contexto clave=valor (no se puede detectar
    // solo por formato porque son 40 chars base64-ish sin prefijo distintivo).
    .replace(
      /aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/gi,
      'aws_secret_access_key=<REDACTED>',
    )
    // AWS Access Key ID (prefijo AKIA + 16 chars mayúsculas/dígitos).
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA<REDACTED>')
    // Google API key (prefijo AIza + 35 chars).
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, 'AIza<REDACTED>')
    // GitHub tokens (classic, fine-grained, OAuth, server/user-to-server).
    // Umbral `+` en lugar de `{20,}`: PATs reales siempre son >=20 chars,
    // pero el prefijo distintivo reduce el riesgo de falsos positivos en prosa
    // a casi cero, y cierra el gap si GitHub cambia el formato.
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_<REDACTED>')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_<REDACTED>')
    .replace(/gho_[A-Za-z0-9_]+/g, 'gho_<REDACTED>')
    .replace(/ghs_[A-Za-z0-9_]+/g, 'ghs_<REDACTED>')
    .replace(/ghu_[A-Za-z0-9_]+/g, 'ghu_<REDACTED>')
    // OpenAI / Anthropic — ORDEN CRÍTICO: los prefijos específicos ANTES
    // que el genérico `sk-`, si no el genérico consume "sk-" y el resto
    // se considera cuerpo, oscureciendo el match del proveedor.
    .replace(/\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, 'sk-proj-<REDACTED>')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'sk-ant-<REDACTED>')
    // Stripe — específicos antes de cualquier `sk-` genérico. Stripe usa
    // guion bajo, OpenAI usa guion medio, pero mantenemos el orden
    // específico→genérico por disciplina.
    .replace(/\bsk_live_[A-Za-z0-9]{24,}\b/g, 'sk_live_<REDACTED>')
    .replace(/\bsk_test_[A-Za-z0-9]{24,}\b/g, 'sk_test_<REDACTED>')
    // OpenAI genérico (u otros proveedores que adopten `sk-` sin sub-prefijo).
    // Va DESPUÉS de sk-proj- y sk-ant- para no consumir sus prefijos.
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, 'sk-<REDACTED>')
    // Slack — tokens bot, user y variantes alternas.
    .replace(/\bxoxb-[A-Za-z0-9-]{20,}\b/g, 'xoxb-<REDACTED>')
    .replace(/\bxoxp-[A-Za-z0-9-]{20,}\b/g, 'xoxp-<REDACTED>')
    .replace(/\bxoxa-[A-Za-z0-9-]{20,}\b/g, 'xoxa-<REDACTED>')
    .replace(/\bxoxs-[A-Za-z0-9-]{20,}\b/g, 'xoxs-<REDACTED>')
    .replace(/\bxoxr-[A-Za-z0-9-]{20,}\b/g, 'xoxr-<REDACTED>')
    // URL autenticada con x-access-token (patrón GitHub clone con PAT).
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:<REDACTED>@')
    // Basic auth genérico en URL: https://user:pass@host/...
    // Se aplica DESPUÉS de x-access-token para que el caso específico gane.
    .replace(/(https?):\/\/[^:/@\s]+:[^@\s]+@/g, '$1://<REDACTED>@');
}
