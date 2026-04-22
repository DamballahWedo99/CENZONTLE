import { load as parseYaml, JSON_SCHEMA } from 'js-yaml';
import { buildFrontmatter, type FrontmatterValue } from './vault-frontmatter';

function extractYamlBody(frontmatter: string): string {
  const match = frontmatter.match(/^---\n([\s\S]*?)\n---$/);
  if (!match) throw new Error(`Frontmatter no delimitado por --- ... ---: ${frontmatter}`);
  return match[1];
}

function roundTrip(input: Record<string, FrontmatterValue>): Record<string, unknown> {
  const fm = buildFrontmatter(input);
  const body = extractYamlBody(fm);
  // JSON_SCHEMA evita auto-parseo de fechas ISO a Date — mantiene strings,
  // que es como los consumen los parsers del proyecto (regex-based).
  return parseYaml(body, { schema: JSON_SCHEMA }) as Record<string, unknown>;
}

describe('buildFrontmatter', () => {
  describe('estructura base', () => {
    it('envuelve el output con `---` al inicio y al final', () => {
      const fm = buildFrontmatter({ id: 'abc' });
      expect(fm.startsWith('---\n')).toBe(true);
      expect(fm.endsWith('\n---')).toBe(true);
    });

    it('emite objeto vacío con solo los delimitadores', () => {
      expect(buildFrontmatter({})).toBe('---\n\n---');
    });
  });

  describe('strings simples', () => {
    it('emite strings planos sin comillas', () => {
      const fm = buildFrontmatter({ name: 'proyecto-alpha' });
      expect(fm).toContain('name: proyecto-alpha');
    });

    it('emite string vacío como ""', () => {
      const fm = buildFrontmatter({ name: '' });
      expect(fm).toContain('name: ""');
    });
  });

  describe('escape de caracteres especiales YAML', () => {
    const specialChars = [':', '#', '|', '>', '"', "'", '`', '[', '{', ',', '&', '*', '!', '?', '@'];

    it.each(specialChars)('entrecomilla strings con %s', (char) => {
      const input = `texto con ${char} dentro`;
      const fm = buildFrontmatter({ field: input });
      const parsed = roundTrip({ field: input });
      expect(parsed.field).toBe(input);
      expect(fm).toContain(`field: ${JSON.stringify(input)}`);
    });

    it('entrecomilla strings con newline embebida', () => {
      const input = 'primera\nsegunda';
      expect(roundTrip({ field: input }).field).toBe(input);
    });

    it('entrecomilla strings con whitespace en bordes', () => {
      expect(roundTrip({ field: ' hola' }).field).toBe(' hola');
      expect(roundTrip({ field: 'hola ' }).field).toBe('hola ');
    });

    it('preserva emojis UTF-8 sin necesidad de escape', () => {
      expect(roundTrip({ emoji: '🚀' }).emoji).toBe('🚀');
    });
  });

  describe('arrays de strings', () => {
    it('emite array vacío como []', () => {
      const fm = buildFrontmatter({ labels: [] });
      expect(fm).toContain('labels: []');
      expect(roundTrip({ labels: [] }).labels).toEqual([]);
    });

    it('emite array plano en flow-style', () => {
      const fm = buildFrontmatter({ labels: ['auth', 'api'] });
      expect(fm).toContain('labels: [auth, api]');
      expect(roundTrip({ labels: ['auth', 'api'] }).labels).toEqual(['auth', 'api']);
    });

    it('escapa ítems con caracteres YAML especiales (el bug original de labels)', () => {
      const labels = ['auth', 'tag with "quote"', 'name:colon'];
      expect(roundTrip({ labels }).labels).toEqual(labels);
    });

    it('escapa ítems con comillas y backslashes', () => {
      const labels = ['a\\b', 'c"d', "e'f"];
      expect(roundTrip({ labels }).labels).toEqual(labels);
    });
  });

  describe('booleanos y números', () => {
    it('emite boolean sin comillas', () => {
      expect(roundTrip({ flag: true }).flag).toBe(true);
      expect(roundTrip({ flag: false }).flag).toBe(false);
    });

    it('emite números enteros y decimales', () => {
      expect(roundTrip({ count: 42 }).count).toBe(42);
      expect(roundTrip({ count: 0 }).count).toBe(0);
      expect(roundTrip({ count: -7 }).count).toBe(-7);
      expect(roundTrip({ ratio: 3.14 }).ratio).toBe(3.14);
    });
  });

  describe('null y undefined', () => {
    it('emite null como ~', () => {
      const fm = buildFrontmatter({ owner: null });
      expect(fm).toContain('owner: ~');
      expect(roundTrip({ owner: null }).owner).toBeNull();
    });

    it('omite claves con valor undefined', () => {
      const fm = buildFrontmatter({ id: 'x', owner: undefined });
      expect(fm).not.toContain('owner');
      expect(fm).toContain('id: x');
    });
  });

  describe('date-like strings', () => {
    it('emite fechas ISO como string sin comillas (no tienen caracteres especiales)', () => {
      const fm = buildFrontmatter({ created: '2026-04-21' });
      expect(fm).toContain('created: 2026-04-21');
    });

    it('round-trip preserva fechas ISO como string', () => {
      // js-yaml 4 con safe schema por default NO auto-parsea fechas ISO a Date
      const parsed = roundTrip({ created: '2026-04-21' });
      expect(parsed.created).toBe('2026-04-21');
    });
  });

  describe('valores peligrosos YAML (fixes post-review)', () => {
    it('entrecomilla strings que empiezan con % (directiva YAML)', () => {
      expect(roundTrip({ title: '%YAML 1.2' }).title).toBe('%YAML 1.2');
      expect(roundTrip({ title: '%Mejora del 50% throughput' }).title).toBe('%Mejora del 50% throughput');
    });

    it('entrecomilla strings que coinciden con valores reservados YAML (null/bool)', () => {
      expect(roundTrip({ x: '~' }).x).toBe('~');
      expect(roundTrip({ x: 'null' }).x).toBe('null');
      expect(roundTrip({ x: 'Null' }).x).toBe('Null');
      expect(roundTrip({ x: 'NULL' }).x).toBe('NULL');
      expect(roundTrip({ x: 'true' }).x).toBe('true');
      expect(roundTrip({ x: 'false' }).x).toBe('false');
      expect(roundTrip({ x: 'True' }).x).toBe('True');
      expect(roundTrip({ x: 'TRUE' }).x).toBe('TRUE');
    });

    it('entrecomilla strings que parecen número (evita coerción)', () => {
      expect(roundTrip({ version: '42' }).version).toBe('42');
      expect(roundTrip({ version: '3.14' }).version).toBe('3.14');
      expect(roundTrip({ version: '-7' }).version).toBe('-7');
      expect(roundTrip({ version: '1e10' }).version).toBe('1e10');
    });

    it('entrecomilla strings con tabs y carriage returns', () => {
      expect(roundTrip({ field: 'col\tsep' }).field).toBe('col\tsep');
      expect(roundTrip({ field: 'line\rend' }).field).toBe('line\rend');
    });

    it('entrecomilla strings con NUL y otros control chars', () => {
      expect(roundTrip({ field: 'null\x00byte' }).field).toBe('null\x00byte');
      expect(roundTrip({ field: 'bell\x07here' }).field).toBe('bell\x07here');
    });
  });

  describe('round-trip completo con shape real de vault', () => {
    it('preserva un frontmatter estilo story con labels adversarios', () => {
      const input: Record<string, FrontmatterValue> = {
        id: 'abc-123',
        type: 'story',
        title: 'Título con | pipe y > arrow',
        epicId: 'epic-xyz',
        status: 'backlog',
        storyPoints: 5,
        labels: ['auth', 'tag:with:colons', 'with "quotes"'],
        podId: undefined,
        created: '2026-04-21',
      };
      const parsed = roundTrip(input);
      expect(parsed).toEqual({
        id: 'abc-123',
        type: 'story',
        title: 'Título con | pipe y > arrow',
        epicId: 'epic-xyz',
        status: 'backlog',
        storyPoints: 5,
        labels: ['auth', 'tag:with:colons', 'with "quotes"'],
        created: '2026-04-21',
      });
    });

    it('preserva un frontmatter estilo discovered-dependency', () => {
      const input: Record<string, FrontmatterValue> = {
        id: 'ai-dep-af307c82-f319-4656-81b5-bed7458edcc1',
        type: 'dependency',
        title: 'Factory Agent Tools API',
        severity: 'critical',
        depType: 'api',
        created: '2026-04-21',
      };
      const parsed = roundTrip(input);
      expect(parsed).toEqual(input);
    });
  });
});
