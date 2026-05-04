import type { DiscoveredDependency } from '@cenzontle/shared';
import { dedupCrossStoriesPure, dedupKeyForPersisted } from './dedup-cross-stories';

function dep(overrides: Partial<DiscoveredDependency> & { id: string; title: string }): DiscoveredDependency {
  return {
    description: '',
    severity: 'medium',
    type: 'api',
    mdContent: '',
    ...overrides,
  };
}

describe('dedupCrossStoriesPure', () => {
  it('mapa vacío retorna vacío', () => {
    const result = dedupCrossStoriesPure(new Map());
    expect(result.depsByIndex.size).toBe(0);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.consolidations).toEqual([]);
  });

  it('una sola historia con deps únicas no toca nada', () => {
    const input = new Map([
      [0, [
        dep({ id: '1', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        dep({ id: '2', title: 'TWILIO_TOKEN', vendor: 'Twilio', type: 'api' }),
      ]],
    ]);
    const result = dedupCrossStoriesPure(input);
    expect(result.depsByIndex.get(0)).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('caso reportado por user: AMADEUS_CLIENT_ID en historias 0, 1, 2 → solo en 0', () => {
    const amadeus = (id: string) => dep({
      id,
      title: 'AMADEUS_CLIENT_ID',
      vendor: 'Amadeus',
      type: 'api',
      severity: 'critical',
    });
    const input = new Map([
      [0, [amadeus('a0')]],
      [1, [amadeus('a1')]],
      [2, [amadeus('a2')]],
    ]);
    const result = dedupCrossStoriesPure(input);
    expect(result.depsByIndex.get(0)).toHaveLength(1);
    expect(result.depsByIndex.has(1)).toBe(false); // mapa filtra entries vacías
    expect(result.depsByIndex.has(2)).toBe(false);
    expect(result.duplicatesRemoved).toBe(2);
    expect(result.consolidations).toHaveLength(1);
    expect(result.consolidations[0].keptInIndex).toBe(0);
    expect(result.consolidations[0].droppedFromIndices).toEqual([1, 2]);
  });

  it('mantiene la primera por outlineIndex aún si hay deps mixtas', () => {
    const input = new Map([
      [2, [dep({ id: '2a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
      [0, [dep({ id: '0a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
      [1, [dep({ id: '1a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
    ]);
    const result = dedupCrossStoriesPure(input);
    // Mantiene index 0 aunque venga después en el Map (sort por idx interno)
    expect(result.depsByIndex.get(0)).toHaveLength(1);
    expect(result.depsByIndex.has(1)).toBe(false);
    expect(result.depsByIndex.has(2)).toBe(false);
  });

  it('matchea variantes con prefijo "GitHub Secret:" como mismo grupo', () => {
    const input = new Map([
      [0, [dep({ id: 'a', title: 'VERCEL_TOKEN', vendor: 'Vercel', type: 'service' })]],
      [1, [dep({ id: 'b', title: 'GitHub Secret: VERCEL_TOKEN', vendor: 'Vercel', type: 'service' })]],
    ]);
    const result = dedupCrossStoriesPure(input);
    expect(result.depsByIndex.get(0)).toHaveLength(1);
    expect(result.depsByIndex.has(1)).toBe(false);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('NO mezcla credenciales con distinto vendor aunque title coincida', () => {
    const input = new Map([
      [0, [dep({ id: 'a', title: 'API_KEY', vendor: 'Stripe', type: 'api' })]],
      [1, [dep({ id: 'b', title: 'API_KEY', vendor: 'Twilio', type: 'api' })]],
    ]);
    const result = dedupCrossStoriesPure(input);
    expect(result.depsByIndex.get(0)).toHaveLength(1);
    expect(result.depsByIndex.get(1)).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('mismo vendor+title con distinto type SE deduplica (vendor+title es discriminador suficiente)', () => {
    // Decisión documentada en `dedup-cross-stories.ts`: la key es solo
    // `vendor::normalizedTitle`, sin segmento de tipo. Razón: el batch usa
    // `DiscoveredDependencyType` ('api'|'service'|...) y la BD persiste
    // `StoryTechnicalDependencyCategory` ('apis'|'services'|'secrets'|...);
    // los enums no son bidireccionalmente compatibles, así que dropear el
    // segmento es la única forma de matchear cross-batch sin falsos
    // negativos. El caso "misma credencial conceptual con dos types
    // distintos" es justamente lo que queremos consolidar.
    const input = new Map([
      [0, [dep({ id: 'a', title: 'AMADEUS_KEY', vendor: 'Amadeus', type: 'api' })]],
      [1, [dep({ id: 'b', title: 'AMADEUS_KEY', vendor: 'Amadeus', type: 'service' })]],
    ]);
    const result = dedupCrossStoriesPure(input);
    expect(result.depsByIndex.get(0)).toHaveLength(1);
    expect(result.depsByIndex.has(1)).toBe(false);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('preserva deps no-duplicadas en historias que también tenían duplicadas', () => {
    const input = new Map([
      [0, [
        dep({ id: 'a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        dep({ id: 'b', title: 'UNIQUE_TO_0', vendor: 'X', type: 'api' }),
      ]],
      [1, [
        dep({ id: 'c', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        dep({ id: 'd', title: 'UNIQUE_TO_1', vendor: 'Y', type: 'api' }),
      ]],
    ]);
    const result = dedupCrossStoriesPure(input);
    // index 0: ambas mantenidas
    expect(result.depsByIndex.get(0)).toHaveLength(2);
    // index 1: solo la única (UNIQUE_TO_1), no STRIPE_KEY
    expect(result.depsByIndex.get(1)).toHaveLength(1);
    expect(result.depsByIndex.get(1)?.[0].id).toBe('d');
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('matcheo case-insensitive vendor y title', () => {
    const input = new Map([
      [0, [dep({ id: 'a', title: 'github_token', vendor: 'GitHub', type: 'api' })]],
      [1, [dep({ id: 'b', title: 'GITHUB_TOKEN', vendor: 'github', type: 'api' })]],
    ]);
    const result = dedupCrossStoriesPure(input);
    expect(result.depsByIndex.has(1)).toBe(false);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('múltiples credenciales distintas duplicadas en distintas historias', () => {
    const input = new Map([
      [0, [
        dep({ id: 'a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        dep({ id: 'b', title: 'TWILIO_TOKEN', vendor: 'Twilio', type: 'api' }),
      ]],
      [1, [
        dep({ id: 'c', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        dep({ id: 'd', title: 'OPENAI_KEY', vendor: 'OpenAI', type: 'api' }),
      ]],
      [2, [
        dep({ id: 'e', title: 'TWILIO_TOKEN', vendor: 'Twilio', type: 'api' }),
        dep({ id: 'f', title: 'OPENAI_KEY', vendor: 'OpenAI', type: 'api' }),
      ]],
    ]);
    const result = dedupCrossStoriesPure(input);
    // index 0: stripe + twilio (ambas primeras)
    expect(result.depsByIndex.get(0)).toHaveLength(2);
    // index 1: solo openai (stripe ya estaba en 0)
    expect(result.depsByIndex.get(1)).toHaveLength(1);
    expect(result.depsByIndex.get(1)?.[0].id).toBe('d');
    // index 2: vacío (twilio en 0, openai en 1)
    expect(result.depsByIndex.has(2)).toBe(false);
    expect(result.duplicatesRemoved).toBe(3);
  });

  it('intra-story duplicates en misma historia se preservan (los filtra otro merger)', () => {
    // El dedup intra-story (TL+QA en misma historia) lo hace
    // mergeDiscoveredDependencies — este helper SOLO opera cross-story.
    const input = new Map([
      [0, [
        dep({ id: 'a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        dep({ id: 'b', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
      ]],
    ]);
    const result = dedupCrossStoriesPure(input);
    // Las 2 entries con mismo idx se preservan — no se considera duplicado cross
    expect(result.depsByIndex.get(0)).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  describe('existingKeys (cross-batch dedup contra historias persistidas)', () => {
    it('descarta dep del batch si ya existe una historia previa con la misma credencial', () => {
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Amadeus', title: 'AMADEUS_CLIENT_ID' }),
      ]);
      const input = new Map([
        [0, [dep({ id: 'a', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', type: 'api' })]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.size).toBe(0);
      expect(result.collidedWithExisting).toBe(1);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.consolidations).toHaveLength(1);
      expect(result.consolidations[0].keptInIndex).toBe(-1);
      expect(result.consolidations[0].droppedFromIndices).toEqual([0]);
    });

    it('matchea aunque el batch use type distinto del category persistido (api vs apis vs secrets)', () => {
      // Caso real del bug: persistido como 'apis' o 'secrets', batch emite con 'api'.
      // La key ya no incluye type/category, así que matchea por vendor+title.
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Amadeus', title: 'AMADEUS_CLIENT_ID' }),
      ]);
      const input = new Map([
        [0, [dep({ id: 'a', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', type: 'api' })]],
        [1, [dep({ id: 'b', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', type: 'service' })]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.size).toBe(0);
      expect(result.collidedWithExisting).toBe(2);
    });

    it('descarta deps de TODAS las historias del batch si la key ya está en existingKeys', () => {
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Stripe', title: 'STRIPE_KEY' }),
      ]);
      const input = new Map([
        [0, [dep({ id: 'a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
        [1, [dep({ id: 'b', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
        [2, [dep({ id: 'c', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.size).toBe(0);
      expect(result.collidedWithExisting).toBe(3);
      expect(result.duplicatesRemoved).toBe(0);
    });

    it('preserva deps NUEVAS aunque otras del batch colisionen con existingKeys', () => {
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Amadeus', title: 'AMADEUS_CLIENT_ID' }),
      ]);
      const input = new Map([
        [0, [
          dep({ id: 'a', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', type: 'api' }),
          dep({ id: 'b', title: 'NEW_STRIPE_KEY', vendor: 'Stripe', type: 'api' }),
        ]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.get(0)).toHaveLength(1);
      expect(result.depsByIndex.get(0)?.[0].id).toBe('b');
      expect(result.collidedWithExisting).toBe(1);
    });

    it('aplica normalización de prefijos también contra existingKeys', () => {
      // Persistido sin prefijo → batch llega con "Secret: VERCEL_TOKEN" → match.
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Vercel', title: 'VERCEL_TOKEN' }),
      ]);
      const input = new Map([
        [0, [dep({ id: 'a', title: 'Secret: VERCEL_TOKEN', vendor: 'Vercel', type: 'service' })]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.size).toBe(0);
      expect(result.collidedWithExisting).toBe(1);
    });

    it('case-insensitive: vendor existente "amadeus" matchea batch "Amadeus"', () => {
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'amadeus', title: 'AMADEUS_CLIENT_ID' }),
      ]);
      const input = new Map([
        [0, [dep({ id: 'a', title: 'AMADEUS_CLIENT_ID', vendor: 'Amadeus', type: 'api' })]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.size).toBe(0);
      expect(result.collidedWithExisting).toBe(1);
    });

    it('existingKeys vacío o ausente → comportamiento original (intra-batch only)', () => {
      const input = new Map([
        [0, [dep({ id: 'a', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
        [1, [dep({ id: 'b', title: 'STRIPE_KEY', vendor: 'Stripe', type: 'api' })]],
      ]);
      const r1 = dedupCrossStoriesPure(input);
      const r2 = dedupCrossStoriesPure(input, new Set());
      expect(r1.depsByIndex.get(0)).toHaveLength(1);
      expect(r2.depsByIndex.get(0)).toHaveLength(1);
      expect(r1.collidedWithExisting).toBe(0);
      expect(r2.collidedWithExisting).toBe(0);
    });

    it('NO descarta deps con vendor distinto aunque title coincida con existingKey', () => {
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Stripe', title: 'API_KEY' }),
      ]);
      const input = new Map([
        [0, [dep({ id: 'a', title: 'API_KEY', vendor: 'Twilio', type: 'api' })]],
      ]);
      const result = dedupCrossStoriesPure(input, existingKeys);
      expect(result.depsByIndex.get(0)).toHaveLength(1);
      expect(result.collidedWithExisting).toBe(0);
    });

    it('batch vacío + existingKeys con entries: no-op limpio (Finding 3 del QA)', () => {
      // Cuando una nueva generación produce 0 deps mientras la épica ya tiene
      // historias previas con deps. El dedup debe ser idempotente.
      const existingKeys = new Set<string>([
        dedupKeyForPersisted({ vendor: 'Stripe', title: 'STRIPE_KEY' }),
        dedupKeyForPersisted({ vendor: 'Twilio', title: 'TWILIO_TOKEN' }),
      ]);
      const result = dedupCrossStoriesPure(new Map(), existingKeys);
      expect(result.depsByIndex.size).toBe(0);
      expect(result.collidedWithExisting).toBe(0);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.consolidations).toEqual([]);
    });
  });
});
