import { readFileSync, statSync } from 'fs';
import type { MultimodalToolResult } from '../agent-tool.interface';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

/**
 * Lee un PDF local y lo prepara como document content block base64 para Claude.
 *
 * Anthropic soporta PDFs nativos via `{ type: 'document', source: { type: 'base64',
 * media_type: 'application/pdf', ... } }` en Sonnet 3.5 v2 y superiores. No requiere
 * parseo server-side — el modelo lee el PDF (texto, tablas, imágenes embebidas).
 */
export function readPdf(path: string, name: string): MultimodalToolResult {
  const size = statSync(path).size;
  if (size > MAX_PDF_BYTES) {
    return {
      text: JSON.stringify({
        error: 'PDF excede el máximo de 20 MB soportado por Anthropic',
        name,
        sizeMB: +(size / 1024 / 1024).toFixed(2),
      }),
    };
  }

  const buffer = readFileSync(path);

  if (!buffer.subarray(0, 5).equals(PDF_MAGIC)) {
    return {
      text: JSON.stringify({
        error: 'Archivo no es un PDF válido (magic bytes inválidos)',
        name,
      }),
    };
  }

  return {
    text: `PDF "${name}" adjuntado como documento nativo. El contenido está en el siguiente mensaje — léelo directamente.`,
    attachments: [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: buffer.toString('base64'),
        },
        title: name,
        citations: { enabled: true },
      },
    ],
  };
}
