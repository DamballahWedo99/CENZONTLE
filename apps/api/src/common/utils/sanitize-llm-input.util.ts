/**
 * Saneamiento de input del usuario antes de inyectarlo en un prompt LLM
 * o en logs estructurados.
 *
 * Dos vectores cubiertos:
 *   1. Prompt injection: si un valor del usuario se concatena dentro de un
 *      bloque delimitado por pseudo-XML (ej. `<user_instructions>...</user_instructions>`),
 *      el usuario podría cerrar el tag y emitir instrucciones adversariales
 *      (ej. pedir al agente que use tools para exfiltrar secretos). Escapamos
 *      `<` y `>` para que el modelo vea texto literal, no delimitadores.
 *   2. Log injection (CWE-117): newlines y caracteres de control en input
 *      del usuario contaminan logs estructurados. Los reemplazamos por un
 *      espacio y truncamos.
 */

const MAX_PROMPT_LEN = 2000;
const MAX_LOG_LEN = 200;

/**
 * Sanea el prompt del usuario antes de inyectarlo en el contexto de un LLM.
 * - Escapa `<` / `>` para evitar cierre de tags de estructura.
 * - Trunca a MAX_PROMPT_LEN caracteres (defense in depth sobre la validación
 *   del DTO, que también debería limitar).
 */
export function sanitizeUserPromptForLLM(input: string): string {
  const truncated = input.length > MAX_PROMPT_LEN ? input.slice(0, MAX_PROMPT_LEN) : input;
  return truncated.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanea un string proveniente del usuario antes de pasarlo a Logger.
 * Reemplaza newlines, tabs y caracteres de control por espacios, y trunca.
 */
export function sanitizeForLog(input: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ');
  return cleaned.length > MAX_LOG_LEN ? cleaned.slice(0, MAX_LOG_LEN) + '…' : cleaned;
}
