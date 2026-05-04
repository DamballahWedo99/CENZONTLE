import { readFileSync } from 'fs';
import { extname } from 'path';
import { Logger } from '@nestjs/common';
import type { MultimodalToolResult } from '../agent-tool.interface';
import { readPdf } from './pdf-reader';
import { readImage } from './image-reader';

const TEXT_MAX_CHARS = 25000;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css']);
const UNSUPPORTED_V1 = new Set(['.xlsx', '.xls', '.csv', '.docx', '.doc', '.pptx', '.drawio']);

/**
 * Dispatcher único para leer un documento adjunto de una iniciativa.
 *
 * - PDF → document content block base64 (Claude lo lee nativo)
 * - PNG/JPG/GIF/WEBP/SVG → image content block JPEG resized (sharp)
 * - TXT/MD/JSON/... → texto plano truncado
 * - XLSX/DOCX/PPTX/DRAWIO → error informativo (fuera de scope v1)
 *
 * Try/catch envolvente: ningún reader crashea el stream SSE.
 * Ante cualquier excepción, retorna un error estructurado que el agente
 * puede interpretar y continuar con otros documentos.
 */
export async function readDocument(
  path: string,
  name: string,
): Promise<MultimodalToolResult> {
  const ext = extname(name).toLowerCase();

  try {
    if (ext === '.pdf') {
      return readPdf(path, name);
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      return await readImage(path, name);
    }

    if (UNSUPPORTED_V1.has(ext)) {
      return {
        text: JSON.stringify({
          error: 'Formato no soportado aún — sube el contenido como PDF, imagen o markdown',
          name,
          format: ext,
        }),
      };
    }

    if (TEXT_EXTENSIONS.has(ext) || ext === '') {
      const raw = readFileSync(path, 'utf-8');
      const truncated = raw.slice(0, TEXT_MAX_CHARS);
      return {
        text: truncated + (raw.length > TEXT_MAX_CHARS ? '\n\n[...truncado...]' : ''),
      };
    }

    return {
      text: JSON.stringify({
        error: 'Extensión desconocida',
        name,
        format: ext,
      }),
    };
  } catch (err: unknown) {
    // Log server-side pero NO exponer err.message al cliente: puede contener
    // paths absolutos, info de libvips/sharp, o metadatos del sistema.
    new Logger('DocumentReader').warn(
      `Failed to read "${name}" (${ext}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      text: JSON.stringify({
        error: 'No se pudo leer el documento',
        name,
        format: ext,
      }),
    };
  }
}
