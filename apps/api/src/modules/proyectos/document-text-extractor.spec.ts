import { extractDocumentText } from './document-text-extractor';

/**
 * Construye un PDF mínimo VÁLIDO (un objeto de catálogo + página vacía) con la
 * cabecera `%PDF-` real, para ejercer el camino "magic OK + parseable". No tiene
 * texto extraíble (página sin contenido de texto) → debe caer al fallback de
 * "PDF sin texto extraíble", NO lanzar.
 */
function buildMinimalPdf(): Buffer {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'latin1');
}

describe('extractDocumentText', () => {
  describe('tipos de texto plano (lectura directa UTF-8)', () => {
    it.each(['.txt', '.md', '.markdown', '.csv', '.json'])(
      'devuelve el contenido literal para %s',
      async (ext) => {
        const body = 'línea uno\nlínea dos — con acentos €';
        const out = await extractDocumentText({
          buffer: Buffer.from(body, 'utf-8'),
          name: `archivo${ext}`,
        });
        expect(out).toBe(body);
      },
    );

    it('reemplaza bytes inválidos por U+FFFD sin lanzar (toString utf-8)', async () => {
      const out = await extractDocumentText({
        buffer: Buffer.from([0xff, 0xfe, 0x41]),
        name: 'corrupto.txt',
      });
      expect(typeof out).toBe('string');
      expect(out).toContain('A');
    });
  });

  describe('PDF', () => {
    it('NO lanza y da fallback ante magic bytes inválidos (no es PDF)', async () => {
      const out = await extractDocumentText({
        buffer: Buffer.from('esto no es un pdf', 'utf-8'),
        name: 'falso.pdf',
      });
      expect(out).toContain('no es un PDF válido');
      expect(out).toContain('binario disponible en storage');
    });

    it('NO lanza ante un PDF corrupto (magic OK pero cuerpo basura) → fallback', async () => {
      // %PDF- válido seguido de bytes que rompen el parser.
      const corrupt = Buffer.concat([
        Buffer.from('%PDF-1.4\n', 'latin1'),
        Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x00, 0x00]),
      ]);
      const out = await extractDocumentText({ buffer: corrupt, name: 'roto.pdf' });
      expect(typeof out).toBe('string');
      // Cualquiera de los dos fallbacks de PDF es aceptable: el parser puede
      // fallar (→ "no se pudo extraer") o devolver vacío (→ "sin texto extraíble").
      expect(out).toMatch(/no se pudo extraer texto del PDF|sin texto extraíble/);
      expect(out).toContain('binario disponible en storage');
    });

    it('da fallback "sin texto extraíble" para un PDF válido sin texto', async () => {
      const out = await extractDocumentText({ buffer: buildMinimalPdf(), name: 'vacio.pdf' });
      // PDF parseable pero sin contenido de texto → fallback de escaneado/imágenes.
      // (El parser podría también rechazarlo; ambos fallbacks son válidos.)
      expect(out).toMatch(/sin texto extraíble|no se pudo extraer texto del PDF/);
    });
  });

  describe('tipos no soportados (stub de binario)', () => {
    it.each(['.xlsx', '.png', '.docx', '.zip'])(
      'devuelve un stub legible para %s sin intentar parsear',
      async (ext) => {
        const out = await extractDocumentText({
          buffer: Buffer.from([0x00, 0x01, 0x02]),
          name: `archivo${ext}`,
        });
        expect(out).toContain(ext.replace('.', '').toUpperCase());
        expect(out).toContain('read_initiative_documents');
      },
    );

    it('usa la extensión de la `key` cuando el `name` no la trae', async () => {
      const out = await extractDocumentText({
        buffer: Buffer.from('contenido plano', 'utf-8'),
        name: 'doc-sin-extension',
        key: 'initiatives/abc/uuid-archivo.txt',
      });
      // La key dice `.txt` → se lee como texto plano, no como stub binario.
      expect(out).toBe('contenido plano');
    });

    it('cae a stub "archivo" cuando no hay extensión ni en name ni en key', async () => {
      const out = await extractDocumentText({
        buffer: Buffer.from([0x00, 0x01]),
        name: 'sinext',
      });
      expect(out).toContain('archivo');
    });
  });

  describe('cap de tamaño', () => {
    it('trunca el texto extraído al cap con un marcador explícito', async () => {
      const huge = 'a'.repeat(600_000);
      const out = await extractDocumentText({
        buffer: Buffer.from(huge, 'utf-8'),
        name: 'enorme.txt',
      });
      expect(out.length).toBeLessThan(huge.length);
      expect(out).toContain('texto truncado a 500,000 caracteres');
      expect(out).toContain('binario completo disponible en storage');
    });

    it('NO trunca texto por debajo del cap', async () => {
      const small = 'b'.repeat(1000);
      const out = await extractDocumentText({
        buffer: Buffer.from(small, 'utf-8'),
        name: 'chico.txt',
      });
      expect(out).toBe(small);
    });
  });
});
