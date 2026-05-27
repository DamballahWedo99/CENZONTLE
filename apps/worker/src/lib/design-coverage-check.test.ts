import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ComponentManifest } from '@cenzontle/shared';
import {
  buildComponentRegex,
  flattenManifests,
  runDesignCoverageCheck,
} from './design-coverage-check.js';

/**
 * Tests unitarios del Layer 1 DoD check `design-coverage-check`.
 *
 * Estrategia: usar workdirs reales con archivos creados con `fs.writeFile`
 * en `mkdtemp`. El check ejecuta `grep` real — más confiable que mockear
 * un binario (el comportamiento de grep entre BSD/GNU es la fuente de
 * incidentes más probable y queremos testearla end-to-end). El cleanup
 * en `afterEach` borra el workdir.
 */

describe('buildComponentRegex', () => {
  it('escapa caracteres especiales de regex en el nombre del componente', () => {
    const regex = buildComponentRegex('My.Component');
    // El punto debe estar escapado en cada uno de los alternantes.
    expect(regex).toContain('My\\.Component');
    // Por seguridad: el regex NO debe contener el punto sin escapar.
    // Cada `.` literal del nombre debe aparecer como `\.` en el output.
    const unescapedDots = regex.match(/(?<!\\)\.[A-Z]/g);
    expect(unescapedDots).toBeNull();
  });

  it('incluye los 6 alternantes esperados (function/export/const/class/JSX)', () => {
    const regex = buildComponentRegex('TopBar');
    expect(regex).toContain('function[[:space:]]+TopBar[[:space:]]*\\(');
    expect(regex).toContain('function[[:space:]]+TopBar[[:space:]]*<');
    expect(regex).toContain('export[[:space:]]+function[[:space:]]+TopBar\\b');
    expect(regex).toContain('const[[:space:]]+TopBar[[:space:]]*=');
    expect(regex).toContain('class[[:space:]]+TopBar\\b');
    expect(regex).toContain('<TopBar[[:space:]/>]');
  });
});

describe('flattenManifests', () => {
  it('retorna [] cuando manifests es undefined', () => {
    expect(flattenManifests(undefined)).toEqual([]);
  });

  it('retorna [] cuando manifests es array vacío', () => {
    expect(flattenManifests([])).toEqual([]);
  });

  it('aplana múltiples manifests preservando orden de aparición', () => {
    const m1: ComponentManifest = {
      components: [
        { name: 'TopBar', kind: 'section', startLine: 1, endLine: 10, filePath: 'a.html' },
        { name: 'Ticker', kind: 'section', startLine: 11, endLine: 20, filePath: 'a.html' },
      ],
      primaryFilePath: 'a.html',
      extractedAt: '2026-05-25T00:00:00Z',
    };
    const m2: ComponentManifest = {
      components: [
        { name: 'Hero', kind: 'react-component', startLine: 1, endLine: 30, filePath: 'b.tsx' },
      ],
      primaryFilePath: 'b.tsx',
      extractedAt: '2026-05-25T00:00:00Z',
    };
    const flat = flattenManifests([m1, m2]);
    expect(flat.map((c) => c.name)).toEqual(['TopBar', 'Ticker', 'Hero']);
  });

  it('dedupea componentes por name (un componente repetido entre manifests aparece una vez)', () => {
    const m1: ComponentManifest = {
      components: [
        { name: 'TopBar', kind: 'section', startLine: 1, endLine: 10, filePath: 'desktop.html' },
      ],
      primaryFilePath: 'desktop.html',
      extractedAt: '2026-05-25T00:00:00Z',
    };
    const m2: ComponentManifest = {
      components: [
        { name: 'TopBar', kind: 'section', startLine: 1, endLine: 10, filePath: 'mobile.html' },
        { name: 'Footer', kind: 'section', startLine: 11, endLine: 20, filePath: 'mobile.html' },
      ],
      primaryFilePath: 'mobile.html',
      extractedAt: '2026-05-25T00:00:00Z',
    };
    const flat = flattenManifests([m1, m2]);
    expect(flat.map((c) => c.name)).toEqual(['TopBar', 'Footer']);
    // El TopBar representativo debe ser el del PRIMER manifest (desktop), no el del segundo.
    expect(flat[0].filePath).toBe('desktop.html');
  });
});

describe('runDesignCoverageCheck — degradación por falta de manifest', () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'design-coverage-test-'));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it('retorna skipped cuando componentManifests es undefined', async () => {
    const result = await runDesignCoverageCheck(workdir, undefined);
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/sin.*manifest|backend-only|backend desactualizado/i);
    expect(result.perComponent).toEqual([]);
  });

  it('retorna skipped cuando componentManifests es array vacío', async () => {
    const result = await runDesignCoverageCheck(workdir, []);
    expect(result.status).toBe('skipped');
    expect(result.perComponent).toEqual([]);
  });

  it('retorna skipped cuando los manifests no tienen componentes parseables', async () => {
    const result = await runDesignCoverageCheck(workdir, [
      {
        components: [],
        primaryFilePath: 'empty.html',
        extractedAt: '2026-05-25T00:00:00Z',
      },
    ]);
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/no listan componentes parseables|sin.*manifests|backend-only/i);
  });
});

describe('runDesignCoverageCheck — passed/failed contra archivos reales', () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'design-coverage-test-'));
    await fs.mkdir(join(workdir, 'src'), { recursive: true });
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  const makeManifest = (
    componentNames: string[],
  ): ComponentManifest => ({
    components: componentNames.map((name, i) => ({
      name,
      kind: 'react-component',
      startLine: i * 10,
      endLine: i * 10 + 9,
      filePath: 'design.tsx',
    })),
    primaryFilePath: 'design.tsx',
    extractedAt: '2026-05-25T00:00:00Z',
  });

  it('passed cuando todos los componentes están implementados como function NAME', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'TopBar.tsx'),
      `export function TopBar() { return <header>Hi</header>; }\n`,
    );
    await fs.writeFile(
      join(workdir, 'src', 'Hero.tsx'),
      `export function Hero(props: { title: string }) { return <h1>{props.title}</h1>; }\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [
      makeManifest(['TopBar', 'Hero']),
    ]);
    expect(result.status).toBe('passed');
    expect(result.perComponent).toHaveLength(2);
    expect(result.perComponent.every((v) => v.found)).toBe(true);
    expect(result.perComponent[0].matchedPaths.length).toBeGreaterThan(0);
  });

  it('passed con const NAME = (arrow function / FC)', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'Ticker.tsx'),
      `const Ticker = ({ price }: { price: number }) => <span>{price}</span>;\nexport default Ticker;\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['Ticker'])]);
    expect(result.status).toBe('passed');
  });

  it('passed con class NAME (class components legacy)', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'Modal.jsx'),
      `class Modal extends React.Component { render() { return null; } }\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['Modal'])]);
    expect(result.status).toBe('passed');
  });

  it('passed cuando el componente solo se usa como elemento JSX (<TopBar ...>)', async () => {
    // El componente está definido en otro lugar (e.g. node_modules) pero se
    // USA en src — esto es válido para el check de coverage.
    await fs.writeFile(
      join(workdir, 'src', 'Page.tsx'),
      `import { TopBar } from 'ui-kit';\nexport default function Page() {\n  return <TopBar />;\n}\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('passed');
  });

  it('failed cuando un componente falta — reason lista los nombres', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'TopBar.tsx'),
      `export function TopBar() { return null; }\n`,
    );
    // No creamos Ticker ni Hero.
    const result = await runDesignCoverageCheck(workdir, [
      makeManifest(['TopBar', 'Ticker', 'Hero']),
    ]);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Ticker');
    expect(result.reason).toContain('Hero');
    expect(result.reason).not.toContain('TopBar');
    const found = result.perComponent.filter((v) => v.found);
    const missing = result.perComponent.filter((v) => !v.found);
    expect(found.map((v) => v.component.name)).toEqual(['TopBar']);
    expect(missing.map((v) => v.component.name).sort()).toEqual(['Hero', 'Ticker']);
  });

  it('no matchea componentes con boundary partial (TopBarLite NO matchea TopBar)', async () => {
    // Si TopBar NO existe pero TopBarLite SÍ, el check debe reportar TopBar
    // como faltante. El `\b` boundary del regex defiende contra falso positivo.
    await fs.writeFile(
      join(workdir, 'src', 'TopBarLite.tsx'),
      `export function TopBarLite() { return null; }\nconst TopBarLiteVariant = () => null;\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('TopBar');
    expect(result.perComponent[0].found).toBe(false);
  });

  it('es case-sensitive (topbar NO matchea TopBar)', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'lowercase.tsx'),
      `export function topbar() { return null; }\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('failed');
    expect(result.perComponent[0].found).toBe(false);
  });

  it('ignora archivos en node_modules / .git / dist (exclude-dir activo)', async () => {
    await fs.mkdir(join(workdir, 'src', 'node_modules', 'fake-lib'), { recursive: true });
    await fs.writeFile(
      join(workdir, 'src', 'node_modules', 'fake-lib', 'index.js'),
      `function TopBar() {}\n`,
    );
    // No hay TopBar en el resto del workdir → debe fallar aunque exista en node_modules.
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('failed');
    expect(result.perComponent[0].found).toBe(false);
  });

  it('escanea solo extensiones .ts/.tsx/.js/.jsx — ignora .py/.md/.css', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'styles.css'),
      `.TopBar { color: red; }\n`,
    );
    await fs.writeFile(
      join(workdir, 'src', 'TopBar.md'),
      `# TopBar Component\n\nThis component does X.\n`,
    );
    // Match en archivos no-JS no debe contar.
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('failed');
  });

  it('cuando `src/` no existe, escanea el workdir raíz como fallback', async () => {
    await rm(join(workdir, 'src'), { recursive: true, force: true });
    await fs.writeFile(
      join(workdir, 'TopBar.tsx'),
      `export function TopBar() { return null; }\n`,
    );
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('passed');
  });

  it('aplana y dedupea componentes de múltiples manifests antes de grepear', async () => {
    await fs.writeFile(
      join(workdir, 'src', 'Shared.tsx'),
      `export function Header() { return null; }\nexport function Footer() { return null; }\n`,
    );
    const desktop: ComponentManifest = {
      components: [
        { name: 'Header', kind: 'section', startLine: 1, endLine: 10, filePath: 'desktop.html' },
      ],
      primaryFilePath: 'desktop.html',
      extractedAt: '2026-05-25T00:00:00Z',
    };
    const mobile: ComponentManifest = {
      components: [
        { name: 'Header', kind: 'section', startLine: 1, endLine: 10, filePath: 'mobile.html' },
        { name: 'Footer', kind: 'section', startLine: 11, endLine: 20, filePath: 'mobile.html' },
      ],
      primaryFilePath: 'mobile.html',
      extractedAt: '2026-05-25T00:00:00Z',
    };
    const result = await runDesignCoverageCheck(workdir, [desktop, mobile]);
    expect(result.status).toBe('passed');
    // Dedup: 2 componentes únicos, no 3.
    expect(result.perComponent).toHaveLength(2);
    expect(result.perComponent.map((v) => v.component.name).sort()).toEqual([
      'Footer',
      'Header',
    ]);
  });

  it('cap matchedPaths a 5 — repos grandes no inflan el output', async () => {
    // Creamos 7 archivos que cada uno menciona TopBar.
    for (let i = 0; i < 7; i++) {
      await fs.writeFile(
        join(workdir, 'src', `File${i}.tsx`),
        `export function TopBar${i === 0 ? '' : 'Variant' + i}() { return null; }\nconst _x = <TopBar />;\n`,
      );
    }
    const result = await runDesignCoverageCheck(workdir, [makeManifest(['TopBar'])]);
    expect(result.status).toBe('passed');
    expect(result.perComponent[0].matchedPaths.length).toBeLessThanOrEqual(5);
  });
});
