import { statSync } from 'fs';
import sharp from 'sharp';
import type { MultimodalToolResult } from '../agent-tool.interface';

const MAX_PRE_RESIZE_BYTES = 30 * 1024 * 1024;
const MAX_POST_RESIZE_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 50_000_000; // 50 MP cap para bloquear decompression bombs
const TARGET_DIMENSION = 1568;

/**
 * Lee una imagen local, la reescala a máximo 1568x1568 y la re-encodea a JPEG
 * quality 80 (best practice oficial de Anthropic para vision). Retorna un
 * image content block base64 que Claude interpreta multimodalmente.
 *
 * Si el resultado sigue > 5MB, hace un segundo pase con quality 60.
 * SVG se rasteriza automáticamente (sharp detecta el formato y convierte).
 */
export async function readImage(path: string, name: string): Promise<MultimodalToolResult> {
  const stats = statSync(path);
  if (stats.size > MAX_PRE_RESIZE_BYTES) {
    return {
      text: JSON.stringify({
        error: 'Imagen excede 30 MB antes de resize — probablemente corrupta o demasiado grande',
        name,
        sizeMB: +(stats.size / 1024 / 1024).toFixed(2),
      }),
    };
  }

  // Chequear dimensiones antes del pipeline para bloquear decompression bombs
  // (un PNG de 50KB puede decodificar a 100000×100000 pixels).
  const meta = await sharp(path, { limitInputPixels: MAX_PIXELS }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width * height > MAX_PIXELS) {
    return {
      text: JSON.stringify({
        error: 'Imagen excede límite de 50 megapíxeles',
        name,
        width,
        height,
      }),
    };
  }

  let buffer = await sharp(path, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({
      width: TARGET_DIMENSION,
      height: TARGET_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (buffer.length > MAX_POST_RESIZE_BYTES) {
    buffer = await sharp(buffer).jpeg({ quality: 60 }).toBuffer();
  }

  if (buffer.length > MAX_POST_RESIZE_BYTES) {
    return {
      text: JSON.stringify({
        error: 'Imagen sigue excediendo 5 MB después de recomprimir',
        name,
        sizeMB: +(buffer.length / 1024 / 1024).toFixed(2),
      }),
    };
  }

  return {
    text: `Imagen "${name}" adjuntada como bloque nativo. El contenido visual está en el siguiente mensaje — descríbelo y úsalo.`,
    attachments: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: buffer.toString('base64'),
        },
      },
    ],
  };
}
