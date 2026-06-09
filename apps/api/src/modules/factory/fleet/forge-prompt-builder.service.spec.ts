import { ForgePromptBuilderService } from './forge-prompt-builder.service';

/**
 * Spec del parser `extractAcceptanceCriteria` — fuente de truth de la
 * Fase 1 (verifier per-criterion) del refactor DoD 2026-05-13.
 *
 * Cubre los casos que el qa-reviewer identificó como gaps (BUG-02, BUG-03,
 * BUG-10) y la defensa cost-bomb DoS (SEC-01: cap MAX_ACCEPTANCE_CRITERIA).
 *
 * La función es pura (input: string|null, output: string[]) — no requiere
 * mock de Logger/Prisma. console.warn se espía cuando el cap se dispara.
 */
describe('ForgePromptBuilderService.extractAcceptanceCriteria', () => {
  // ───────────────────────────────────────────────────────────────────────
  // Happy paths — sintaxis válida estándar
  // ───────────────────────────────────────────────────────────────────────

  describe('happy paths', () => {
    it('extrae criterios bajo heading h2 con prefijo `1.`', () => {
      const md = [
        '# Story',
        '',
        '## Criterios de aceptación',
        '',
        '1. El endpoint responde 200',
        '2. El body contiene `userId`',
        '',
        '## Notas',
        'extra',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([
        'El endpoint responde 200',
        'El body contiene `userId`',
      ]);
    });

    it('extrae criterios bajo heading h3 (BUG-03 fix)', () => {
      const md = [
        '## Producto',
        '',
        '### Criterios de aceptación',
        '',
        '- existe `SETUP.md`',
        '- contiene sección Instalación',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([
        'existe `SETUP.md`',
        'contiene sección Instalación',
      ]);
    });

    it('acepta variantes de heading: sin acento + "Acceptance criteria"', () => {
      const mdSinAcento = '## Criterios de aceptacion\n\n- foo';
      const mdInglés = '## Acceptance criteria\n\n- bar';
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(mdSinAcento)).toEqual(['foo']);
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(mdInglés)).toEqual(['bar']);
    });

    it('acepta prefijos de lista heterogéneos en la misma sección', () => {
      const md = [
        '## Criterios de aceptación',
        '',
        '1. uno',
        '2) dos',
        '- tres',
        '* cuatro',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([
        'uno',
        'dos',
        'tres',
        'cuatro',
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Edge cases — input degenerado
  // ───────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('retorna [] cuando el markdown es null', () => {
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(null)).toEqual([]);
    });

    it('retorna [] cuando el markdown no tiene la sección', () => {
      const md = '# Story\n\n## Antecedentes\n\nfoo bar baz';
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([]);
    });

    it('retorna [] cuando la sección existe pero está vacía', () => {
      const md = '## Criterios de aceptación\n\n## Siguiente sección';
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([]);
    });

    it('concatena líneas multi-línea sin prefijo al criterio previo (BUG-02 fix)', () => {
      const md = [
        '## Criterios de aceptación',
        '',
        '1. El endpoint /api/stories retorna 200 OK con paginación',
        '   correcta cuando hay más de 50 resultados.',
        '2. El body tiene shape `{ data, total }`',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([
        'El endpoint /api/stories retorna 200 OK con paginación correcta cuando hay más de 50 resultados.',
        'El body tiene shape `{ data, total }`',
      ]);
    });

    it('preserva criterios duplicados (no deduplica — eso es responsabilidad del verifier)', () => {
      const md = [
        '## Criterios de aceptación',
        '- foo',
        '- foo',
        '- bar',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([
        'foo',
        'foo',
        'bar',
      ]);
    });

    it('no matchea heading sin espacio entre `##` y el texto', () => {
      const md = '##Criterios de aceptación\n\n- foo';
      // El regex exige `\s+` entre `##` y el texto del heading — `##Criterios`
      // queda fuera del patrón. Retorna [].
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([]);
    });

    it('preserva caracteres especiales en el texto del criterio', () => {
      const md = [
        '## Criterios de aceptación',
        '- El `<script>` debe escaparse a `&lt;script&gt;` en el output',
        '- "Comillas" y emojis ✓ ✗ deben preservarse',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual([
        'El `<script>` debe escaparse a `&lt;script&gt;` en el output',
        '"Comillas" y emojis ✓ ✗ deben preservarse',
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Defensa cost-bomb DoS — SEC-01
  // ───────────────────────────────────────────────────────────────────────

  describe('defensa cost-bomb (SEC-01)', () => {
    it('trunca a MAX_ACCEPTANCE_CRITERIA cuando excede el cap + emite warning', () => {
      const cap = ForgePromptBuilderService.MAX_ACCEPTANCE_CRITERIA;
      const bullets = Array.from({ length: cap + 20 }, (_, i) => `- criterio ${i + 1}`);
      const md = ['## Criterios de aceptación', '', ...bullets].join('\n');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const result = ForgePromptBuilderService.extractAcceptanceCriteria(md);
        expect(result).toHaveLength(cap);
        expect(result[0]).toBe('criterio 1');
        expect(result[cap - 1]).toBe(`criterio ${cap}`);
        // El warning debe haberse emitido con el conteo original (cap + 20).
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain(`${cap + 20} criterios extraídos`);
        expect(warnSpy.mock.calls[0][0]).toContain(`truncando a ${cap}`);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('no dispara warning si el conteo está en el cap exacto', () => {
      const cap = ForgePromptBuilderService.MAX_ACCEPTANCE_CRITERIA;
      const bullets = Array.from({ length: cap }, (_, i) => `- c${i}`);
      const md = ['## Criterios de aceptación', '', ...bullets].join('\n');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const result = ForgePromptBuilderService.extractAcceptanceCriteria(md);
        expect(result).toHaveLength(cap);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Boundary detection — fin correcto de la sección
  // ───────────────────────────────────────────────────────────────────────

  describe('boundary detection', () => {
    it('para de extraer al encontrar el siguiente heading h2', () => {
      const md = [
        '## Criterios de aceptación',
        '- dentro',
        '',
        '## Notas adicionales',
        '- afuera',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual(['dentro']);
    });

    it('para de extraer al encontrar el siguiente heading h3 cuando la sección es h3', () => {
      const md = [
        '## Producto',
        '',
        '### Criterios de aceptación',
        '- dentro',
        '',
        '### Notas',
        '- afuera',
      ].join('\n');
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual(['dentro']);
    });

    it('captura hasta el final del documento si no hay siguiente heading', () => {
      const md = '## Criterios de aceptación\n- uno\n- dos';
      expect(ForgePromptBuilderService.extractAcceptanceCriteria(md)).toEqual(['uno', 'dos']);
    });
  });
});

/**
 * Spec de `buildDesignReferenceSection` — inline del diseño de referencia en el
 * prompt del coder (fix pixel-perfect 2026-06-02). Cubre los gaps que el
 * qa-reviewer marcó (F-07): fence anti-colisión, caps de tamaño, filtro de
 * vacíos (sin header huérfano), y el banner anti-prompt-injection (security).
 * Función estática pura (input: archivos, output: string[]).
 */
describe('ForgePromptBuilderService.buildDesignReferenceSection', () => {
  const build = (files?: Array<{ path: string; content: string }>): string =>
    ForgePromptBuilderService.buildDesignReferenceSection(files).join('\n');

  it('devuelve [] sin archivos (undefined o lista vacía)', () => {
    expect(ForgePromptBuilderService.buildDesignReferenceSection(undefined)).toEqual([]);
    expect(ForgePromptBuilderService.buildDesignReferenceSection([])).toEqual([]);
  });

  it('omite la sección entera si ningún archivo tiene contenido real (sin header huérfano)', () => {
    expect(
      ForgePromptBuilderService.buildDesignReferenceSection([{ path: 'a.html', content: '   \n  ' }]),
    ).toEqual([]);
  });

  it('inlinea el contenido con header, banner anti-inyección y path del archivo', () => {
    const out = build([{ path: 'disenos/home/aerovia.html', content: '<div>hola</div>' }]);
    expect(out).toContain('DISEÑO DE REFERENCIA');
    expect(out).toContain('DATOS de referencia'); // banner anti-prompt-injection (security)
    expect(out).toContain('### Archivo: disenos/home/aerovia.html');
    expect(out).toContain('<div>hola</div>');
  });

  it('usa fence mínimo de 4 backticks cuando el HTML no tiene backticks', () => {
    const out = build([{ path: 'a.html', content: '<p>sin backticks</p>' }]);
    expect(out).toContain('````');
  });

  it('el fence es más largo que la corrida máxima de backticks del HTML (anti-colisión)', () => {
    // contenido con 4 backticks seguidos → el fence DEBE ser ≥5 para no colisionar
    const out = build([{ path: 'a.html', content: 'antes ```` despues' }]);
    expect(out).toContain('`````'); // 5 backticks (fence)
    expect(out).toContain('antes ```` despues'); // el contenido sobrevive intacto
  });

  it('trunca un archivo que excede el cap por-archivo', () => {
    const huge = 'x'.repeat(ForgePromptBuilderService.MAX_DESIGN_FILE_CHARS + 50);
    const out = build([{ path: 'big.html', content: huge }]);
    expect(out).toContain('TRUNCADO');
  });
});
