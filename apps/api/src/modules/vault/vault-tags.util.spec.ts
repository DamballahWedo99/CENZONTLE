import {
  buildExcerpt,
  extractTitle,
  joinFrontmatter,
  normalizeTag,
  parseFrontmatterTags,
  sameTagSet,
  splitFrontmatter,
  updateFrontmatterTags,
} from './vault-tags.util';

describe('vault-tags.util', () => {
  describe('splitFrontmatter', () => {
    it('separa frontmatter y body', () => {
      const { frontmatter, body } = splitFrontmatter('---\nid: abc\ntags: [a, b]\n---\n\n# Título\nTexto');
      expect(frontmatter).toBe('---\nid: abc\ntags: [a, b]\n---');
      expect(body).toBe('# Título\nTexto');
    });

    it('devuelve null sin frontmatter', () => {
      const { frontmatter, body } = splitFrontmatter('# Solo body');
      expect(frontmatter).toBeNull();
      expect(body).toBe('# Solo body');
    });

    it('normaliza CRLF — un archivo de Windows no pierde su frontmatter', () => {
      const { frontmatter, body } = splitFrontmatter('---\r\nid: abc\r\ntags: [a]\r\n---\r\n\r\n# T\r\nbody');
      expect(frontmatter).toBe('---\nid: abc\ntags: [a]\n---');
      expect(body).toBe('# T\nbody');
      expect(parseFrontmatterTags(frontmatter)).toEqual(['a']);
    });
  });

  describe('parseFrontmatterTags', () => {
    it('parsea flow-style', () => {
      expect(parseFrontmatterTags('---\ntags: [pagos, checkout, "v1"]\n---')).toEqual(['pagos', 'checkout', 'v1']);
    });

    it('array vacío y frontmatter sin tags', () => {
      expect(parseFrontmatterTags('---\ntags: []\n---')).toEqual([]);
      expect(parseFrontmatterTags('---\nid: abc\n---')).toEqual([]);
      expect(parseFrontmatterTags(null)).toEqual([]);
    });

    it('parsea block-style (docs editados con Obsidian/GitHub web)', () => {
      expect(parseFrontmatterTags('---\nid: x\ntags:\n  - pagos\n  - "checkout"\ntype: epic\n---')).toEqual([
        'pagos',
        'checkout',
      ]);
    });

    it('valor escalar inesperado devuelve vacío sin romper', () => {
      expect(parseFrontmatterTags('---\ntags: pagos\n---')).toEqual([]);
    });
  });

  describe('updateFrontmatterTags', () => {
    it('reemplaza la línea tags preservando el resto', () => {
      const fm = '---\nid: abc\ntags: [viejo]\ntype: epic\n---';
      expect(updateFrontmatterTags(fm, ['nuevo-a', 'nuevo-b'])).toBe(
        '---\nid: abc\ntags: [nuevo-a, nuevo-b]\ntype: epic\n---',
      );
    });

    it('agrega la línea si no existía', () => {
      expect(updateFrontmatterTags('---\nid: abc\n---', ['x-y'])).toBe('---\nid: abc\ntags: [x-y]\n---');
    });

    it('crea frontmatter desde cero', () => {
      expect(updateFrontmatterTags(null, ['solo'])).toBe('---\ntags: [solo]\n---');
    });

    it('elimina la línea con tags vacío y colapsa frontmatter vacío', () => {
      expect(updateFrontmatterTags('---\ntags: [a]\n---', [])).toBe('');
      expect(updateFrontmatterTags('---\nid: abc\ntags: [a]\n---', [])).toBe('---\nid: abc\n---');
    });

    it('round-trip: lo que escribe se vuelve a parsear igual', () => {
      const fm = updateFrontmatterTags('---\nid: abc\n---', ['flujo-pagos', 'auth']);
      expect(parseFrontmatterTags(fm)).toEqual(['flujo-pagos', 'auth']);
    });

    it('reemplaza tags block-style sin dejar items colgando (corrupción YAML)', () => {
      const fm = '---\nid: x\ntags:\n  - viejo-a\n  - viejo-b\ntype: epic\n---';
      expect(updateFrontmatterTags(fm, ['nuevo'])).toBe('---\nid: x\ntags: [nuevo]\ntype: epic\n---');
    });

    it('elimina tags block-style completos cuando tags queda vacío', () => {
      const fm = '---\nid: x\ntags:\n  - a\n  - b\n---';
      expect(updateFrontmatterTags(fm, [])).toBe('---\nid: x\n---');
    });

    it('round-trip block-style → flow-style preserva la semántica', () => {
      const fm = '---\ntags:\n  - pagos\n  - checkout\n---';
      const existing = parseFrontmatterTags(fm);
      const updated = updateFrontmatterTags(fm, [...existing, 'nuevo']);
      expect(parseFrontmatterTags(updated)).toEqual(['pagos', 'checkout', 'nuevo']);
    });

    it('block-style con línea en blanco entre items (YAML válido) no deja items colgando', () => {
      const fm = '---\nid: x\ntags:\n\n  - viejo-a\n  - viejo-b\ntype: epic\n---';
      expect(parseFrontmatterTags(fm)).toEqual(['viejo-a', 'viejo-b']);
      expect(updateFrontmatterTags(fm, ['nuevo'])).toBe('---\nid: x\ntags: [nuevo]\ntype: epic\n---');
    });

    it('blancas tras tags: sin items no se comen la clave siguiente', () => {
      const fm = '---\ntags:\n\ntype: epic\n---';
      expect(updateFrontmatterTags(fm, ['nuevo'])).toBe('---\ntags: [nuevo]\ntype: epic\n---');
    });
  });

  describe('joinFrontmatter', () => {
    it('reconstruye el documento completo', () => {
      expect(joinFrontmatter('---\ntags: [a]\n---', '# T\nbody')).toBe('---\ntags: [a]\n---\n\n# T\nbody');
      expect(joinFrontmatter(null, '# T')).toBe('# T');
    });
  });

  describe('normalizeTag', () => {
    it('kebab-case sin acentos', () => {
      expect(normalizeTag('Autenticación')).toBe('autenticacion');
      expect(normalizeTag('Flujo de Pagos')).toBe('flujo-de-pagos');
      expect(normalizeTag('  infra_deploy ')).toBe('infra-deploy');
      expect(normalizeTag('#tag!!')).toBe('tag');
    });

    it('rechaza slugs inutilizables', () => {
      expect(normalizeTag('')).toBeNull();
      expect(normalizeTag('a')).toBeNull();
      expect(normalizeTag('!!!')).toBeNull();
      expect(normalizeTag('x'.repeat(41))).toBeNull();
    });
  });

  describe('sameTagSet', () => {
    it('ignora orden y duplicados', () => {
      expect(sameTagSet(['a', 'b'], ['b', 'a'])).toBe(true);
      expect(sameTagSet(['a', 'a', 'b'], ['b', 'a'])).toBe(true);
      expect(sameTagSet(['a'], ['a', 'b'])).toBe(false);
    });
  });

  describe('extractTitle', () => {
    it('usa el primer heading o el nombre de archivo', () => {
      expect(extractTitle('intro\n# Mi Título\ntexto', 'doc.md')).toBe('Mi Título');
      expect(extractTitle('sin heading', 'flujo-pagos.md')).toBe('flujo pagos');
    });
  });

  describe('buildExcerpt', () => {
    it('colapsa saltos múltiples y corta con elipsis', () => {
      expect(buildExcerpt('a\n\n\n\nb', 100)).toBe('a\n\nb');
      const cut = buildExcerpt('x'.repeat(50), 10);
      expect(cut).toHaveLength(11);
      expect(cut.endsWith('…')).toBe(true);
    });
  });
});
