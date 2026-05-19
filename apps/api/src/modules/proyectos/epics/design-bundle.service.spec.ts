import { DesignBundleService } from './design-bundle.service';

// AdmZip normaliza paths con `..` en su roundtrip (wrapper/../escape.md →
// escape.md), lo que neutralizaría el ataque ANTES de llegar a nuestro fix.
// Para probar que el fix funciona en escenarios donde otro tool malicioso
// (python zipfile, libzip raw, etc.) produzca un ZIP cuyos entries lleguen
// a `getEntries()` con `..` literal, mockeamos AdmZip y forzamos el shape.
jest.mock('adm-zip');
import AdmZip from 'adm-zip';
import { createMockPinoLogger } from '../../../common/testing/mock-pino-logger';

const MockAdmZip = AdmZip as unknown as jest.Mock;

interface FakeEntry {
  entryName: string;
  isDirectory: boolean;
  getData: () => Buffer;
}

function setupMockEntries(entries: FakeEntry[]): void {
  MockAdmZip.mockImplementation(() => ({
    getEntries: () => entries,
  }));
}

const MINIMAL_README = [
  '# wrapper',
  '',
  'Bundle contents: the `wrapper` project files.',
  '',
  'Read `wrapper/project/index.html` in full.',
  '',
].join('\n');

function entry(entryName: string, content: string): FakeEntry {
  return {
    entryName,
    isDirectory: false,
    getData: () => Buffer.from(content),
  };
}

describe('DesignBundleService — zip-slip path traversal (CWE-22)', () => {
  let service: DesignBundleService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new DesignBundleService(createMockPinoLogger());
    // Silenciar warns en el spec; los verificamos cuando importan.
    warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    warnSpy.mockRestore();
  });

  it('rechaza entradas con `..` en el primer segmento (zip-slip clásico)', async () => {
    setupMockEntries([
      entry('wrapper/README.md', MINIMAL_README),
      entry('wrapper/project/index.html', '<html></html>'),
      // Pasa el check `startsWith('wrapper/')` pero el slice deja
      // `../../../iniciativas/<other>/index.md` — escape de bundle.
      entry(
        'wrapper/../../../iniciativas/other/epics/other/index.md',
        '# pwned',
      ),
    ]);

    const result = await service.extractBundle(Buffer.from('fake-zip'), 'malicious.zip');

    const paths = result.textFiles.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['README.md', 'project/index.html']);
    expect(paths.some((p) => p.includes('..'))).toBe(false);
    // Confirma que el guard sí registró el rechazo.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('path traversal'),
    );
  });

  it('rechaza paths absolutos (relativePath empieza con `/`)', async () => {
    setupMockEntries([
      entry('wrapper/README.md', MINIMAL_README),
      entry('wrapper/project/index.html', '<html></html>'),
      // `wrapper//etc/shadow.md` post-slice = `/etc/shadow.md`.
      entry('wrapper//etc/shadow.md', 'absolute path'),
    ]);

    const result = await service.extractBundle(Buffer.from('fake-zip'), 'malicious.zip');

    const paths = result.textFiles.map((f) => f.relativePath);
    expect(paths.some((p) => p.startsWith('/'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('path traversal'),
    );
  });

  it('rechaza `..` en segmento intermedio (project/../../escape.md)', async () => {
    setupMockEntries([
      entry('wrapper/README.md', MINIMAL_README),
      entry('wrapper/project/index.html', '<html></html>'),
      entry('wrapper/project/../../escape.md', 'escape'),
    ]);

    const result = await service.extractBundle(Buffer.from('fake-zip'), 'malicious.zip');

    const paths = result.textFiles.map((f) => f.relativePath);
    expect(paths.some((p) => p.split('/').includes('..'))).toBe(false);
  });

  it('acepta paths legítimos profundos sin falsos positivos', async () => {
    setupMockEntries([
      entry('wrapper/README.md', MINIMAL_README),
      entry('wrapper/project/index.html', '<html></html>'),
      entry('wrapper/project/components/Header.tsx', 'export {};'),
      entry('wrapper/project/styles/theme.css', 'body{}'),
    ]);

    const result = await service.extractBundle(Buffer.from('fake-zip'), 'clean.zip');

    const paths = result.textFiles.map((f) => f.relativePath).sort();
    expect(paths).toEqual([
      'README.md',
      'project/components/Header.tsx',
      'project/index.html',
      'project/styles/theme.css',
    ]);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('path traversal'),
    );
  });
});
