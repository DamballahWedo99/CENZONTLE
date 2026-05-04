import type { StoryTechnicalDependency } from '@cenzontle/shared';
import { dedupeRollup, type StoryTitleLookup } from './dedupe-rollup';

function dep(overrides: Partial<StoryTechnicalDependency> & { id: string; storyId: string }): StoryTechnicalDependency {
  return {
    title: 'Some dep',
    description: '',
    category: 'secrets',
    severity: 'medium',
    source: 'discovered',
    vendor: null,
    requiresCredential: false,
    linkedSecretId: null,
    isBlocking: false,
    targetExternalName: null,
    targetEpicId: null,
    status: 'identified',
    owner: '',
    dueDate: null,
    resolutionNotes: '',
    mdContent: null,
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
    ...overrides,
  };
}

const titles: StoryTitleLookup = new Map([
  ['s1', 'Story uno'],
  ['s2', 'Story dos'],
  ['s3', 'Story tres'],
  ['s4', 'Story cuatro'],
]);

describe('dedupeRollup', () => {
  it('deja deps únicas intactas (sin relatedStories)', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'STRIPE_KEY', vendor: 'Stripe' }),
      dep({ id: '2', storyId: 's2', title: 'TWILIO_TOKEN', vendor: 'Twilio' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(2);
    expect(out[0].relatedStories).toBeUndefined();
    expect(out[1].relatedStories).toBeUndefined();
  });

  it('agrupa el caso reportado: AMADEUS_CLIENT_ID en 3 historias', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', category: 'secrets', severity: 'critical', isBlocking: true }),
      dep({ id: '2', storyId: 's2', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', category: 'secrets', severity: 'critical', isBlocking: true }),
      dep({ id: '3', storyId: 's3', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', category: 'secrets', severity: 'critical', isBlocking: true }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(1);
    expect(out[0].relatedStories).toEqual([
      { storyId: 's1', storyTitle: 'Story uno' },
      { storyId: 's2', storyTitle: 'Story dos' },
      { storyId: 's3', storyTitle: 'Story tres' },
    ]);
  });

  it('matchea variantes con prefijo "GitHub Secret:" como mismo grupo', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'VERCEL_TOKEN', vendor: 'Vercel', category: 'secrets' }),
      dep({ id: '2', storyId: 's2', title: 'GitHub Secret: VERCEL_TOKEN', vendor: 'Vercel', category: 'secrets' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(1);
    expect(out[0].relatedStories).toHaveLength(2);
  });

  it('matchea con prefijos comunes en español e inglés', () => {
    const variants = [
      'STRIPE_API_KEY',
      'Secret: STRIPE_API_KEY',
      'Credencial: STRIPE_API_KEY',
      'API Key: STRIPE_API_KEY',
      'Token: STRIPE_API_KEY',
    ];
    const input = variants.map((t, i) =>
      dep({ id: `${i}`, storyId: `s${i + 1}`, title: t, vendor: 'Stripe', category: 'secrets' }),
    );
    const titles5: StoryTitleLookup = new Map([
      ['s1', 'A'], ['s2', 'B'], ['s3', 'C'], ['s4', 'D'], ['s5', 'E'],
    ]);
    const out = dedupeRollup(input, titles5);
    expect(out).toHaveLength(1);
    expect(out[0].relatedStories).toHaveLength(5);
  });

  it('matcheo case-insensitive en title y vendor', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'github_token', vendor: 'GitHub', category: 'secrets' }),
      dep({ id: '2', storyId: 's2', title: 'GITHUB_TOKEN', vendor: 'github', category: 'secrets' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(1);
  });

  it('NO agrupa si distinta categoría', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'API_KEY', vendor: 'X', category: 'secrets' }),
      dep({ id: '2', storyId: 's2', title: 'API_KEY', vendor: 'X', category: 'apis' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(2);
  });

  it('NO agrupa si distinto vendor', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'API_KEY', vendor: 'Stripe', category: 'secrets' }),
      dep({ id: '2', storyId: 's2', title: 'API_KEY', vendor: 'Twilio', category: 'secrets' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(2);
  });

  it('elige canónico con mayor severity', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'X', vendor: 'V', severity: 'low' }),
      dep({ id: '2', storyId: 's2', title: 'X', vendor: 'V', severity: 'critical' }),
      dep({ id: '3', storyId: 's3', title: 'X', vendor: 'V', severity: 'medium' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2');
    expect(out[0].severity).toBe('critical');
  });

  it('en empate de severity, prefiere la que ya tiene linkedSecretId', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'X', vendor: 'V', severity: 'high', linkedSecretId: null }),
      dep({ id: '2', storyId: 's2', title: 'X', vendor: 'V', severity: 'high', linkedSecretId: 'sec-123' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out[0].id).toBe('2');
    expect(out[0].linkedSecretId).toBe('sec-123');
  });

  it('en empate de severity y linkedSecretId, prefiere la bloqueante', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'X', vendor: 'V', severity: 'high', isBlocking: false }),
      dep({ id: '2', storyId: 's2', title: 'X', vendor: 'V', severity: 'high', isBlocking: true }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out[0].id).toBe('2');
    expect(out[0].isBlocking).toBe(true);
  });

  it('NO toca legacy deps (storyId vacío)', () => {
    const input = [
      dep({ id: '1', storyId: '', title: 'LEGACY_DEP', vendor: 'X' }),
      dep({ id: '2', storyId: '', title: 'LEGACY_DEP', vendor: 'X' }),
    ];
    const out = dedupeRollup(input, titles);
    // Las 2 legacy se preservan tal cual (vienen ya deduplicadas del origen)
    expect(out).toHaveLength(2);
    expect(out.every((d) => !d.relatedStories)).toBe(true);
  });

  it('mezcla fresh deduplicadas + legacy preservadas', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'API_KEY', vendor: 'X' }),
      dep({ id: '2', storyId: 's2', title: 'API_KEY', vendor: 'X' }),
      dep({ id: '3', storyId: '', title: 'LEGACY_THING' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(2);
    const fresh = out.find((d) => d.storyId !== '');
    const legacy = out.find((d) => d.storyId === '');
    expect(fresh?.relatedStories).toHaveLength(2);
    expect(legacy?.relatedStories).toBeUndefined();
  });

  it('storyTitle fallback cuando la story no está en el lookup', () => {
    const input = [
      dep({ id: '1', storyId: 'desconocida', title: 'X', vendor: 'V' }),
      dep({ id: '2', storyId: 's1', title: 'X', vendor: 'V' }),
    ];
    const out = dedupeRollup(input, titles);
    // find-based para no depender del orden de inserción del Map
    const unknownEntry = out[0].relatedStories?.find((s) => s.storyId === 'desconocida');
    const knownEntry = out[0].relatedStories?.find((s) => s.storyId === 's1');
    expect(unknownEntry?.storyTitle).toBe('(historia sin título)');
    expect(knownEntry?.storyTitle).toBe('Story uno');
  });

  it('deps vacías retornan array vacío', () => {
    expect(dedupeRollup([], titles)).toEqual([]);
  });

  it('NO strippea prefijo "Token:" si lo que sigue NO es SCREAMING_SNAKE_CASE', () => {
    // El lookahead `(?=[A-Z_])` previene falsos positivos en titles
    // donde "Token" o similares son parte del nombre humano legítimo.
    const input = [
      dep({ id: '1', storyId: 's1', title: 'Token: Bearer Auth Strategy', vendor: 'X', category: 'knowledge' }),
      dep({ id: '2', storyId: 's2', title: 'API Key: rotation policy', vendor: 'X', category: 'knowledge' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(2); // No se fusionan
  });

  it('SÍ strippea prefijo cuando lo que sigue es SCREAMING_SNAKE_CASE', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'Token: GITHUB_TOKEN', vendor: 'GitHub', category: 'secrets' }),
      dep({ id: '2', storyId: 's2', title: 'GITHUB_TOKEN', vendor: 'GitHub', category: 'secrets' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(1);
    expect(out[0].relatedStories).toHaveLength(2);
  });

  it('preserva ordering por category > createdAt', () => {
    const input = [
      dep({ id: '1', storyId: 's1', title: 'A', vendor: 'V1', category: 'apis', createdAt: '2026-02-01T00:00:00Z' }),
      dep({ id: '2', storyId: 's2', title: 'B', vendor: 'V2', category: 'secrets', createdAt: '2026-03-01T00:00:00Z' }),
      dep({ id: '3', storyId: 's3', title: 'C', vendor: 'V3', category: 'secrets', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out.map((d) => d.id)).toEqual(['1', '3', '2']); // apis primero (alfabético), luego secrets por createdAt asc
  });

  it('severity null/undefined no rompe pickCanonical', () => {
    // Cast intencional: simulamos data legacy donde severity podría faltar.
    const input = [
      dep({ id: '1', storyId: 's1', title: 'X', vendor: 'V', severity: undefined as unknown as 'low' }),
      dep({ id: '2', storyId: 's2', title: 'X', vendor: 'V', severity: 'high' }),
    ];
    const out = dedupeRollup(input, titles);
    expect(out).toHaveLength(1);
    // El que tiene severity definida gana (rank 3 > 0 fallback)
    expect(out[0].id).toBe('2');
  });
});
