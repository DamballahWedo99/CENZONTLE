/**
 * Normaliza el label de un node del diagrama.
 *
 * El prompt del agente LLM indica usar `\n` para saltos de línea, pero el
 * modelo frecuentemente emite el string literal (backslash + letra n,
 * 2 chars) en lugar del caracter newline real (1 char, 0x0A). Cuando el
 * payload pasa por `JSON.parse`, ese literal se mantiene como 2 chars y
 * se renderiza tal cual en el DOM, mostrando `\n` visible al usuario.
 *
 * Esta función es defensiva:
 * - Acepta `\\n` doubly-escaped (por si pasa por algún serializer extra).
 * - Acepta `\n` literal (backslash+n) emitido por el LLM.
 * - Pasa newlines reales sin tocar.
 *
 * Combinar con `whitespace-pre-line` (Tailwind) o `white-space: pre-line`
 * en el contenedor del label para que los `\n` reales se respeten
 * visualmente.
 */
export function normalizeNodeLabel(label: string | null | undefined): string {
  // Null-safety: la signature declara string pero los datos vienen de JSON
  // externo (LLM output) sin garantía runtime. Si el agente omite `label` o
  // emite `null`, sin este guard `null.replace(...)` lanza TypeError y
  // crashea el render del node (QA-flag BLOCK resuelto).
  if (!label) return '';
  return label.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
}
