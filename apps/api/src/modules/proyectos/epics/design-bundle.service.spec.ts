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

// ─────────────────────────────────────────────────────────────────────────────
// componentManifest extraction (2026-05-25)
//
// Cubre la lógica del extractor automático de componentes top-level del primary
// HTML. El gap concreto que arregla: cuando un user sube `aerovia.html` (mockup
// con TopBar, Ticker, Hero, SearchCard, Destinations, Strip, TweaksPanel) y el
// PO solo cubre 4-5 con stories, el sistema necesita SABER qué componentes
// faltan para forzar coverage explícita.
//
// Estos tests verifican:
//  1) Extracción de funciones React top-level (`function ComponentName(...)`)
//     dentro de `<script type="text/babel">`.
//  2) Captura correcta de startLine/endLine via brace matching.
//  3) Caso aerovia.html sintético: extrae los 7+ componentes esperados.
//  4) HTML sin componentes (DOM trivial) → null.
//  5) HTML con secciones estructurales (`<section class="...">`) cuando NO hay
//     funciones React.
//  6) Compat: standalone HTML upload también pasa por el extractor.
// ─────────────────────────────────────────────────────────────────────────────

describe('DesignBundleService — componentManifest extraction', () => {
  let service: DesignBundleService;

  beforeEach(() => {
    service = new DesignBundleService(createMockPinoLogger());
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'info').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Mockup sintético inspirado en el aerovia.html que el user subió. Replica
   * el patrón típico de Claude Design: un HTML standalone con `<script type="text/babel">`
   * que define varias funciones React top-level y las renderiza vía ReactDOM.
   *
   * Componentes esperados (orden de aparición en el archivo):
   *   TopBar, Ticker, Hero, SearchCard, Destinations, Strip, TweaksPanel
   *
   * Cada componente es una `function PascalCase()` con un body simple. El test
   * verifica que el manifest contenga AL MENOS estos 7 nombres.
   */
  function makeAerovia(): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Aerovia</title>
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
function TopBar() {
  return (
    <header className="topbar">
      <span>Aerovia</span>
      <nav>Sign in</nav>
    </header>
  );
}

function Ticker() {
  const items = ['MX -> CUN', 'GDL -> MEX', 'TIJ -> CUN'];
  return (
    <div className="ticker">
      {items.map((it) => <span key={it}>{it}</span>)}
    </div>
  );
}

function Hero() {
  return (
    <section className="hero">
      <h1>Vuela con Aerovia</h1>
      <p>El mejor precio garantizado.</p>
    </section>
  );
}

function SearchCard() {
  const [origin, setOrigin] = React.useState('');
  return (
    <div className="search-card">
      <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
    </div>
  );
}

function Destinations() {
  const cities = ['Cancún', 'Tulum', 'CDMX', 'Puerto Vallarta'];
  return (
    <section className="destinations">
      {cities.map((c) => <article key={c}>{c}</article>)}
    </section>
  );
}

function Strip() {
  return (
    <footer className="strip">
      <span>© 2026 Aerovia</span>
    </footer>
  );
}

function TweaksPanel() {
  return (
    <aside className="tweaks">
      <button>Modo oscuro</button>
    </aside>
  );
}

function App() {
  return (
    <>
      <TopBar />
      <Ticker />
      <Hero />
      <SearchCard />
      <Destinations />
      <Strip />
      <TweaksPanel />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;
  }

  it('extrae al menos TopBar, Ticker, Hero, SearchCard, Destinations, Strip, TweaksPanel del aerovia.html sintético', async () => {
    const html = makeAerovia();
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'Aerovia.html',
    );

    expect(result.componentManifest).not.toBeNull();
    const names = result.componentManifest!.components.map((c) => c.name);

    // Los 7 componentes "del mockup" esperados (más App que es lícito incluir,
    // pero no obligatorio para el test). Verificamos cobertura mínima.
    const expected = ['TopBar', 'Ticker', 'Hero', 'SearchCard', 'Destinations', 'Strip', 'TweaksPanel'];
    for (const name of expected) {
      expect(names).toContain(name);
    }

    // Cada componente trae rango de líneas válido.
    for (const comp of result.componentManifest!.components) {
      expect(comp.kind).toBe('react-component');
      expect(comp.startLine).toBeGreaterThan(0);
      expect(comp.endLine).toBeGreaterThanOrEqual(comp.startLine);
      expect(comp.filePath).toBe('aerovia.html');
    }

    // primaryFilePath debe apuntar al archivo correcto.
    expect(result.componentManifest!.primaryFilePath).toBe('aerovia.html');

    // extractedAt debe ser una fecha ISO válida.
    expect(() => new Date(result.componentManifest!.extractedAt).toISOString()).not.toThrow();
  });

  it('los rangos de línea de aerovia son monotónicos crecientes y no se solapan', async () => {
    const html = makeAerovia();
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'Aerovia.html',
    );

    const comps = result.componentManifest!.components;
    // Sort por startLine (el service ya lo hace, pero validamos).
    const sorted = [...comps].sort((a, b) => a.startLine - b.startLine);
    expect(sorted).toEqual(comps);

    // No overlap: el endLine de uno < startLine del siguiente.
    for (let i = 0; i + 1 < comps.length; i++) {
      expect(comps[i].endLine).toBeLessThan(comps[i + 1].startLine);
    }
  });

  it('retorna null cuando el HTML standalone no tiene funciones React ni secciones identificables', async () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>vacío</title></head>
<body>
  <div>solo un div sin clase ni id</div>
</body>
</html>`;
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'vacio.html',
    );

    expect(result.componentManifest).toBeNull();
  });

  it('extrae secciones HTML (class/id) cuando NO hay funciones React', async () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>HTML puro</title></head>
<body>
  <header class="topbar">
    <span>Logo</span>
  </header>
  <section class="hero">
    <h1>Título</h1>
  </section>
  <section id="ticker-zone">
    <p>Promos</p>
  </section>
  <footer class="strip">
    <span>© 2026</span>
  </footer>
</body>
</html>`;
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'static.html',
    );

    expect(result.componentManifest).not.toBeNull();
    const names = result.componentManifest!.components.map((c) => c.name);
    expect(names).toContain('topbar');
    expect(names).toContain('hero');
    expect(names).toContain('ticker-zone');
    expect(names).toContain('strip');
    // Todos kind='section' porque no hay funciones React.
    for (const c of result.componentManifest!.components) {
      expect(c.kind).toBe('section');
    }
  });

  it('NO duplica secciones HTML cuando ya hay funciones React (decisión de diseño)', async () => {
    // HTML híbrido: <section class="hero"> en el body + function Hero() en el <script>.
    // El extractor reporta SOLO los componentes React (decision: evitar dupes
    // semánticos donde el PO ve "Hero" como section Y como function).
    const html = `<!DOCTYPE html>
<html>
<body>
  <section class="hero">
    <h1>placeholder</h1>
  </section>
  <script type="text/babel">
function Hero() {
  return <div>Real Hero</div>;
}
function App() {
  return <Hero />;
}
  </script>
</body>
</html>`;
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'hybrid.html',
    );

    expect(result.componentManifest).not.toBeNull();
    const names = result.componentManifest!.components.map((c) => c.name);
    expect(names).toContain('Hero');
    expect(names).toContain('App');
    // No debe contener la clase 'hero' como section — el extractor saltea
    // las secciones cuando ya hay funciones React.
    expect(names).not.toContain('hero');
    // Todos kind='react-component'.
    for (const c of result.componentManifest!.components) {
      expect(c.kind).toBe('react-component');
    }
  });

  it('ignora funciones helper camelCase (solo extrae PascalCase)', async () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <script type="text/babel">
function formatPrice(p) { return '$' + p; }
function debounce(fn, ms) { return fn; }
function Hero() {
  return <div>{formatPrice(100)}</div>;
}
  </script>
</body>
</html>`;
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'helpers.html',
    );

    expect(result.componentManifest).not.toBeNull();
    const names = result.componentManifest!.components.map((c) => c.name);
    expect(names).toContain('Hero');
    expect(names).not.toContain('formatPrice');
    expect(names).not.toContain('debounce');
  });

  it('extrae funciones React `async` también', async () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <script type="text/babel">
async function DataFetcher() {
  const data = await fetch('/api/x');
  return <div>{data}</div>;
}
  </script>
</body>
</html>`;
    const result = await service.extractStandaloneHtml(
      Buffer.from(html, 'utf-8'),
      'async.html',
    );

    expect(result.componentManifest).not.toBeNull();
    const names = result.componentManifest!.components.map((c) => c.name);
    expect(names).toContain('DataFetcher');
  });

  it('retorna null cuando el primary file no es HTML (caso defensivo)', async () => {
    // Bundle ZIP donde el primary path es un .md (caso patológico — no
    // debería ocurrir porque Claude Design siempre exporta HTML, pero el
    // sistema debe degradar graciosamente).
    setupMockEntries([
      {
        entryName: 'wrapper/README.md',
        isDirectory: false,
        getData: () =>
          Buffer.from(
            ['# wrapper', '', 'Read `wrapper/project/notes.md` in full.'].join('\n'),
          ),
      },
      {
        entryName: 'wrapper/project/notes.md',
        isDirectory: false,
        getData: () => Buffer.from('# Notes\n\nSome notes.'),
      },
    ]);

    const result = await service.extractBundle(Buffer.from('fake-zip'), 'md-primary.zip');
    expect(result.primaryDesignPath).toBe('project/notes.md');
    expect(result.componentManifest).toBeNull();
  });
});
