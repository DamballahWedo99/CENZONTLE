/**
 * Heurística de medición de texto para SVG/HTML labels sin depender del DOM.
 *
 * Usamos un factor fijo `fontSize * CHAR_WIDTH_FACTOR` en vez de `canvas.measureText`
 * porque:
 *   1. `canvas` / `OffscreenCanvas` no están disponibles en SSR ni en Vitest (jsdom).
 *   2. Una aproximación de ±10 % es más que suficiente para decidir truncado —
 *      el único efecto de error es truncar 1 carácter extra en el peor caso.
 *   3. Nuestra UI usa una familia sans-serif fija (system-ui/Inter), cuyo ancho
 *      medio por carácter ronda 0.55–0.65× el tamaño de fuente.
 */

const CHAR_WIDTH_FACTOR = 0.6;
const ELLIPSIS = '\u2026';

/**
 * Estimación de ancho en píxeles para `text` a `fontSizePx`.
 *
 * Asume ancho uniforme por carácter. Para diagnósticos de "cuánto mide el label"
 * a la hora de dibujar un `<rect>` de fondo detrás del texto.
 */
export function measureLabelPx(text: string, fontSizePx: number): number {
  if (!text || fontSizePx <= 0) return 0;
  return text.length * fontSizePx * CHAR_WIDTH_FACTOR;
}

/**
 * Trunca `text` para que quepa en `maxWidthPx` con la elipsis `…` añadida.
 *
 * Contratos:
 *   - Si `text` ya cabe, lo devuelve intacto (sin ellipsis).
 *   - Si ni siquiera la ellipsis cabe, devuelve `''` (el caller decide si
 *     dibuja algo o no).
 *   - `text` vacío, `maxWidthPx <= 0`, o `fontSizePx <= 0` → `''`.
 */
export function truncateToFitPx(
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
): string {
  if (!text) return '';
  if (maxWidthPx <= 0 || fontSizePx <= 0) return '';

  const charWidth = fontSizePx * CHAR_WIDTH_FACTOR;
  const fullWidth = text.length * charWidth;
  if (fullWidth <= maxWidthPx) return text;

  const ellipsisWidth = charWidth; // '…' es un solo carácter
  const availableWidth = maxWidthPx - ellipsisWidth;
  if (availableWidth <= 0) return '';

  const keepChars = Math.floor(availableWidth / charWidth);
  if (keepChars <= 0) return '';

  return text.slice(0, keepChars) + ELLIPSIS;
}
