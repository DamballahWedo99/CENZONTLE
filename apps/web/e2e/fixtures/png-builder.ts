/**
 * Helper para generar PNGs válidos en runtime desde un base64 hardcoded.
 *
 * Usar PNG generado in-memory (en lugar de checkear un binario en el repo)
 * mantiene los fixtures inmutables y portátiles entre sistemas (no hay
 * diferencias en bytes por line endings o git autocrlf).
 *
 * Los PNGs son 1×1 px — el smallest valid PNG posible, ~67 bytes. Suficiente
 * para validar el roundtrip de upload + serve sin gastar bandwidth.
 */

/**
 * PNG 1×1 transparente (signature 89 PNG + IHDR + IDAT + IEND). Base64
 * standard del PNG canónico que muchos suites de testing usan como
 * placeholder. 67 bytes decoded.
 */
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function makeTestPng(): Buffer {
  return Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');
}

/**
 * PNG válido pero con bytes distintos al `makeTestPng` para tests que
 * necesitan upload de A → assert A; upload de B → assert B (sin colisión).
 * Generado al cambiar un solo byte del IDAT.
 */
const ALT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAACklEQVR4AWMAAAACAAH8/2nGAAAAAElFTkSuQmCC';

export function makeAltTestPng(): Buffer {
  return Buffer.from(ALT_PNG_BASE64, 'base64');
}
