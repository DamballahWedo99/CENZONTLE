/**
 * Constructor unificado de frontmatter YAML para archivos del vault.
 *
 * Toda escritura de markdown al vault debe serializar su metadata con
 * `buildFrontmatter()` — evita la duplicación de lógica de escape YAML
 * que vivía dispersa en ~10 builders, cada uno con reglas ligeramente
 * distintas (y algunas rotas: arrays de strings sin escape, omisión
 * inconsistente de campos vacíos).
 *
 * Convención de uso:
 *  - `undefined` → la clave se OMITE del output. Útil para campos
 *    opcionales que aún no tienen valor.
 *  - `null` → emite `~` (null YAML explícito). Usa esto cuando quieres
 *    preservar la clave señalizando "sin valor".
 *  - Arrays vacíos emiten `[]`; arrays con elementos usan flow-style
 *    (`[a, b]`) con cada ítem pasado por el escape de string.
 *  - Strings se entrecomillan (via `JSON.stringify`) solo si contienen
 *    caracteres especiales YAML o whitespace en bordes.
 */

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[];

const YAML_SPECIAL_CHARS = /[:#[\]{}&*!,|>'"`?@]/;
// Tab, CR, NUL y otros caracteres de control — YAML prohíbe bytes C0 en
// plain scalars. Incluimos todos los bytes C0 (incluido LF `\x0a`, aunque
// `hasNewline` también lo cubre) y DEL `\x7f`. JSON.stringify los convierte
// a secuencias `\uXXXX` válidas dentro de un double-quoted scalar.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
// Valores que YAML 1.2 parsea como algo distinto a string si van sin comillas:
//  - `~` y `null`/`Null`/`NULL` → null
//  - `true`/`false` (case-insensitive) → boolean
//  - strings que parsean como número (`42`, `3.14`, `0xFF`) → number
// Para preservar el round-trip, forzamos comillas en todos estos casos.
const YAML_RESERVED_VALUES = /^(~|null|Null|NULL|true|True|TRUE|false|False|FALSE)$/;
const YAML_NUMBER_LOOKALIKE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function escapeString(value: string): string {
  if (value === '') return '""';
  // `%` al inicio inicia una directiva YAML (`%YAML 1.2`). Un valor como
  // "%Mejora" sin quotes hace que el parser falle con "found character %
  // that cannot start any token".
  if (value.startsWith('%')) return JSON.stringify(value);
  if (YAML_RESERVED_VALUES.test(value)) return JSON.stringify(value);
  if (YAML_NUMBER_LOOKALIKE.test(value)) return JSON.stringify(value);
  const hasBorderWhitespace = value.trim() !== value;
  const hasSpecialChars = YAML_SPECIAL_CHARS.test(value);
  const hasNewline = value.includes('\n');
  const hasControlChar = CONTROL_CHARS.test(value);
  if (hasBorderWhitespace || hasSpecialChars || hasNewline || hasControlChar) {
    return JSON.stringify(value);
  }
  return value;
}

function serializeValue(value: Exclude<FrontmatterValue, undefined>): string {
  if (value === null) return '~';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map(escapeString).join(', ')}]`;
  }
  return escapeString(value);
}

export function buildFrontmatter(data: Record<string, FrontmatterValue>): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${serializeValue(v as Exclude<FrontmatterValue, undefined>)}`);
  return `---\n${lines.join('\n')}\n---`;
}
