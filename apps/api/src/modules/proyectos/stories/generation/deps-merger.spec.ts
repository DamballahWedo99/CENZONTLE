import type { DiscoveredDependency } from '@cenzontle/shared';
import { mergeDiscoveredDependencies, maxSeverity } from './deps-merger';

function dep(overrides: Partial<DiscoveredDependency> & { title: string }): DiscoveredDependency {
  return {
    id: `ai-dep-${Math.random().toString(36).slice(2)}`,
    description: '',
    severity: 'medium',
    type: 'other',
    mdContent: '',
    ...overrides,
  };
}

describe('maxSeverity', () => {
  it('critical > high > medium > low', () => {
    expect(maxSeverity('critical', 'low')).toBe('critical');
    expect(maxSeverity('low', 'high')).toBe('high');
    expect(maxSeverity('medium', 'medium')).toBe('medium');
    expect(maxSeverity('high', 'critical')).toBe('critical');
  });
});

describe('mergeDiscoveredDependencies', () => {
  describe('sin overlaps', () => {
    it('retorna [] cuando ambas entradas son vacías', () => {
      expect(mergeDiscoveredDependencies([], [])).toEqual([]);
    });

    it('concatena cuando no hay overlap', () => {
      const tl = [dep({ title: 'Stripe API Key', vendor: 'Stripe', type: 'api' })];
      const qa = [dep({ title: 'Mock fixture users', type: 'data' })];
      const result = mergeDiscoveredDependencies(tl, qa);
      expect(result).toHaveLength(2);
    });
  });

  describe('dedup por vendor+normalizedTitle', () => {
    // Decisión documentada en `deps-merger.ts`: la key de dedup es
    // `vendor + normalizedTitle`, paritaria con `dedupCrossStoriesPure`.
    // Antes la key era `vendor + type` lo cual era buggy: colapsaba deps
    // realmente distintas con mismo vendor (ej. "Stripe API Key" vs
    // "Stripe Webhooks Service") y NO colapsaba aliases nominales del
    // mismo concepto (ej. "VERCEL_TOKEN" vs "GitHub Secret: VERCEL_TOKEN").

    it('colapsa "Stripe API Key" TL + "stripe api key" QA (case-insensitive vendor + title)', () => {
      const tl = [dep({ title: 'Stripe API Key', vendor: 'Stripe', type: 'api' })];
      const qa = [dep({ title: 'stripe api key', vendor: 'stripe', type: 'api' })];
      const result = mergeDiscoveredDependencies(tl, qa);
      expect(result).toHaveLength(1);
    });

    it('mantiene separadas dos deps del mismo vendor pero TÍTULOS distintos', () => {
      // Antes este test verificaba "distinto type". Ahora distinto type
      // ya no separa — el discriminador real es el title.
      const tl = [
        dep({ title: 'Stripe API Key', vendor: 'Stripe', type: 'api' }),
        dep({ title: 'Stripe Webhooks Service', vendor: 'Stripe', type: 'service' }),
      ];
      const result = mergeDiscoveredDependencies(tl, []);
      expect(result).toHaveLength(2);
    });

    it('colapsa "VERCEL_TOKEN" TL + "GitHub Secret: VERCEL_TOKEN" QA (normalize de prefijo)', () => {
      // Caso real reportado por user: TL emitía VERCEL_TOKEN y QA emitía
      // la misma con prefijo "GitHub Secret:". El merger las trataba como
      // distintas y persistía 2 rows.
      const tl = [dep({ title: 'VERCEL_TOKEN', vendor: 'Vercel', type: 'api' })];
      const qa = [dep({ title: 'GitHub Secret: VERCEL_TOKEN', vendor: 'Vercel', type: 'service' })];
      const result = mergeDiscoveredDependencies(tl, qa);
      expect(result).toHaveLength(1);
    });

    it('trim del vendor: "Stripe " y "Stripe" se tratan como uno (mismo title)', () => {
      const tl = [dep({ title: 'Stripe API Key', vendor: 'Stripe ', type: 'api' })];
      const qa = [dep({ title: 'Stripe API Key', vendor: 'Stripe', type: 'api' })];
      const result = mergeDiscoveredDependencies(tl, qa);
      expect(result).toHaveLength(1);
    });
  });

  describe('dedup por título (fallback sin vendor)', () => {
    it('colapsa dos deps con mismo título y sin vendor', () => {
      const tl = [dep({ title: 'Redis staging' })];
      const qa = [dep({ title: 'Redis staging' })];
      const result = mergeDiscoveredDependencies(tl, qa);
      expect(result).toHaveLength(1);
    });

    it('alias por título: TL con vendor + QA sin vendor pero mismo título se dedup', () => {
      const tl = [dep({ title: 'Stripe API Key', vendor: 'Stripe', type: 'api' })];
      // QA describe la misma integración sin aportar vendor — el fix HIGH del review
      const qa = [dep({ title: 'Stripe API Key', type: 'api', mdContent: 'mock para testing' })];
      const result = mergeDiscoveredDependencies(tl, qa);
      expect(result).toHaveLength(1);
      // El resultado mantiene vendor del TL y toma mdContent del QA (más largo)
      expect(result[0].vendor).toBe('Stripe');
      expect(result[0].mdContent).toBe('mock para testing');
    });
  });

  describe('fusión de campos al dedup', () => {
    it('prefiere mdContent más largo del QA aunque el TL emitió primero', () => {
      const tl = [dep({ title: 'X', vendor: 'X', type: 'api', mdContent: 'corto' })];
      const qa = [dep({ title: 'X', vendor: 'X', type: 'api', mdContent: 'descripción mucho más detallada con naturaleza, mock, owner' })];
      const [result] = mergeDiscoveredDependencies(tl, qa);
      expect(result.mdContent).toContain('mock, owner');
    });

    it('preserva requiresCredential/isBlocking del TL cuando QA no los emite', () => {
      const tl = [dep({ title: 'X', vendor: 'X', type: 'api', requiresCredential: true, isBlocking: true })];
      const qa = [dep({ title: 'X', vendor: 'X', type: 'api' })]; // sin flags
      const [result] = mergeDiscoveredDependencies(tl, qa);
      expect(result.requiresCredential).toBe(true);
      expect(result.isBlocking).toBe(true);
    });

    it('severity final es el máximo de ambas', () => {
      const tl = [dep({ title: 'X', vendor: 'X', type: 'api', severity: 'medium' })];
      const qa = [dep({ title: 'X', vendor: 'X', type: 'api', severity: 'critical' })];
      const [result] = mergeDiscoveredDependencies(tl, qa);
      expect(result.severity).toBe('critical');
    });
  });

  describe('re-keying cuando el QA aporta el vendor ausente en el TL', () => {
    it('migra la entry del map de titleKey a vendorKey cuando el incoming QA aporta vendor', () => {
      const tl = [dep({ title: 'Service X', type: 'api' })]; // sin vendor → key = 'n:service x'
      const qa = [dep({ title: 'Service X', vendor: 'Vendor', type: 'api' })]; // con vendor
      const result = mergeDiscoveredDependencies(tl, qa);
      // Solo una entry, con vendor aportado
      expect(result).toHaveLength(1);
      expect(result[0].vendor).toBe('Vendor');
    });
  });

  describe('callback onDedup', () => {
    it('se invoca cuando hay dedup, con detalles', () => {
      const tl = [dep({ title: 'X', vendor: 'X', type: 'api' })];
      const qa = [dep({ title: 'X', vendor: 'X', type: 'api' })];
      const spy = jest.fn();
      mergeDiscoveredDependencies(tl, qa, spy);
      expect(spy).toHaveBeenCalledWith({ input: 2, output: 1, tl: 1, qa: 1 });
    });

    it('NO se invoca cuando no hay dedup', () => {
      const tl = [dep({ title: 'X', vendor: 'X', type: 'api' })];
      const qa = [dep({ title: 'Y', vendor: 'Y', type: 'service' })];
      const spy = jest.fn();
      mergeDiscoveredDependencies(tl, qa, spy);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
