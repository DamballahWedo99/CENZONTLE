import { extname } from 'path';
import { Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';

/**
 * Extracción de TEXTO server-side de documentos adjuntos, para el dual-write al
 * vault (cada documento subido a una iniciativa/épica se escribe ADEMÁS como
 * una nota markdown con su texto extraído — "consciencia total" del vault).
 *
 * IMPORTANTE — diferencia con `agent-tools/document-readers/`:
 *   Aquel dispatcher prepara documentos MULTIMODALES para Claude (PDF/imagen
 *   como content blocks base64 que el modelo lee nativo, NO texto plano). Aquí
 *   necesitamos texto literal para persistirlo en el vault, así que SÍ parseamos
 *   el PDF con `pdf-parse`. Son objetivos distintos; no se reusa.
 *
 * SEGURIDAD: el input son archivos subidos por usuarios (no confiables).
 *  - `pdf-parse` (pdfjs-dist por debajo) corre con `isEvalSupported: false`
 *    para no ejecutar funciones JS embebidas en el PDF, y `verbosity: 0`.
 *  - TODO el parseo va en try/catch: un PDF corrupto, encriptado o malicioso
 *    NUNCA lanza — devuelve un fallback. El binario siempre sigue en storage.
 *  - El texto extraído se capea a `MAX_EXTRACTED_CHARS` para no inflar el vault
 *    ni el repo de GitHub con documentos enormes.
 */

const logger = new Logger('DocumentTextExtractor');

/**
 * Cap del texto extraído que se persiste en la nota del vault. 500k chars ≈
 * 500KB de markdown — suficiente para documentos largos sin reventar el repo
 * de GitHub (que tiene límites de tamaño por archivo y por push). Por encima
 * se trunca con un marcador explícito.
 */
const MAX_EXTRACTED_CHARS = 500_000;

/**
 * Magic bytes de un PDF (`%PDF-`). Defensa barata antes de pasar el buffer al
 * parser: si los primeros 5 bytes no matchean, ni intentamos parsear (evita
 * trabajo y posibles edge-cases del parser con archivos mal etiquetados).
 */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

/** Extensiones cuyo contenido es texto plano legible directo (UTF-8). */
const PLAIN_TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
]);

export interface DocumentTextInput {
  /** Bytes del archivo (leídos por el caller vía DocumentsService.getFilePath). */
  buffer: Buffer;
  /** Nombre original del archivo — fuente primaria para detectar el tipo por extensión. */
  name: string;
  /**
   * Storage key del archivo (opcional). Se usa como FALLBACK para derivar la
   * extensión cuando `name` no la trae (dato legacy o manipulado). La key
   * generada por el upload preserva la extensión real del archivo
   * (`<folder>/<uuid>-<safeName>` con `safeName` conservando el `.ext`), así
   * que es una fuente confiable del tipo cuando el `name` es ambiguo.
   */
  key?: string;
}

/**
 * Devuelve el texto extraído del documento, listo para escribir como cuerpo de
 * una nota markdown en el vault. Nunca lanza: ante cualquier problema devuelve
 * un fallback informativo (el binario siempre queda accesible en storage y, para
 * iniciativas, legible por el agente vía `read_initiative_documents`).
 */
export async function extractDocumentText(
  input: DocumentTextInput,
): Promise<string> {
  // Extensión del `name`; si no tiene (ej. "doc1" sin sufijo), caer a la de la
  // `key`, que preserva el `.ext` real del archivo en storage.
  const nameExt = extname(input.name).toLowerCase();
  const ext = nameExt || (input.key ? extname(input.key).toLowerCase() : '');

  let text: string;
  if (ext === '.pdf') {
    text = await extractPdfText(input.buffer, input.name);
  } else if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    text = extractPlainText(input.buffer);
  } else {
    text = buildBinaryStub(ext);
  }

  return capText(text);
}

async function extractPdfText(buffer: Buffer, name: string): Promise<string> {
  if (!buffer.subarray(0, 5).equals(PDF_MAGIC)) {
    return '[no se pudo extraer texto del PDF — archivo no es un PDF válido (magic bytes inválidos); binario disponible en storage]';
  }

  let parser: PDFParse | null = null;
  try {
    // SEGURIDAD: input no confiable. `isEvalSupported: false` evita ejecución de
    // funciones JS embebidas; `verbosity: 0` silencia pdfjs. El Buffer se
    // convierte a Uint8Array internamente por la librería.
    parser = new PDFParse({
      data: buffer,
      isEvalSupported: false,
      verbosity: 0,
    });
    const result = await parser.getText();
    const extracted = result.text?.trim() ?? '';
    if (extracted.length === 0) {
      return '[PDF sin texto extraíble (probablemente escaneado/solo imágenes) — binario disponible en storage]';
    }
    return extracted;
  } catch (err: unknown) {
    // NO exponer err.message hacia datos persistidos: puede traer rutas
    // absolutas o internals de pdfjs. Log server-side acotado, fallback estable.
    logger.warn(
      `extractPdfText falló para "${name}": ${err instanceof Error ? err.constructor.name : 'desconocido'}`,
    );
    return '[no se pudo extraer texto del PDF — binario disponible en storage]';
  } finally {
    // pdf-parse mantiene recursos del worker de pdfjs; liberarlos siempre.
    if (parser) {
      await parser.destroy().catch(() => undefined);
    }
  }
}

function extractPlainText(buffer: Buffer): string {
  // `toString('utf-8')` nunca lanza: bytes inválidos se reemplazan por U+FFFD.
  return buffer.toString('utf-8');
}

function buildBinaryStub(ext: string): string {
  const label = ext ? ext.replace(/^\./, '').toUpperCase() : 'archivo';
  return `[${label} — binario; contenido legible por el agente vía read_initiative_documents]`;
}

function capText(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return (
    text.slice(0, MAX_EXTRACTED_CHARS) +
    `\n\n[...texto truncado a ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')} caracteres — binario completo disponible en storage]`
  );
}
