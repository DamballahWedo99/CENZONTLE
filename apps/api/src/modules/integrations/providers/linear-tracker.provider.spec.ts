/**
 * Tests unitarios para los métodos PUROS del provider Linear:
 *   - `mapPriority` — defensa null/undefined.
 *   - `sanitizeLinearError` — defensa contra info-disclosure de la SDK
 *     (Linear `GraphQLClientError.message` incluye un JSON dump del request
 *     y response que NO debe filtrarse al cliente).
 *   - `escapeMarkdown` — defensa contra phishing markdown en Linear issues.
 *   - `buildEpicDescription` / `buildStoryDescription` — composición correcta
 *     y aplicación de escape.
 *
 * Mockeamos `@linear/sdk` para evitar el peso del módulo y network calls.
 * No testeamos `publishEpic`/`publishStory` end-to-end aquí — eso pide un
 * mock más elaborado del LinearClient y queda para integration-test.
 */
jest.mock('@linear/sdk', () => ({
  LinearClient: jest.fn().mockImplementation(() => ({})),
  // El type `IssueRelationType` es un enum runtime ('blocks', 'related', etc).
  // Sin este shim el mock devuelve undefined y `IssueRelationType.Blocks`
  // arroja TypeError silencioso dentro del try/catch de publishStoryRelations,
  // engañando al test ok=0 sin entries en failed.
  IssueRelationType: {
    Blocks: 'blocks',
    Duplicate: 'duplicate',
    Related: 'related',
    Similar: 'similar',
  },
}));

import { LinearTrackerProvider } from './linear-tracker.provider';
import type { LinearConfig } from '@cenzontle/shared';
import type { EpicPayload, StoryPayload } from './tracker-provider.interface';

function buildProvider(): LinearTrackerProvider {
  const config: LinearConfig = {
    apiKey: '',
    teamId: 'team-uuid',
    teamName: 'Engineering',
    workspaceSlug: 'acme',
    projectId: null,
    projectName: null,
  };
  return new LinearTrackerProvider('lin_api_test_xxxxxxxxxxxxxxxx', config);
}

describe('LinearTrackerProvider — mapPriority', () => {
  const callMap = (priority: unknown) =>
    (buildProvider() as any).mapPriority(priority) as number;

  it('retorna 0 (No priority) para null/undefined/empty — no crashea', () => {
    expect(callMap(null)).toBe(0);
    expect(callMap(undefined)).toBe(0);
    expect(callMap('')).toBe(0);
  });

  it('mapea correctamente urgent/high/medium/low (case-insensitive)', () => {
    expect(callMap('urgent')).toBe(1);
    expect(callMap('CRITICAL')).toBe(1);
    expect(callMap('High')).toBe(2);
    expect(callMap('medium')).toBe(3);
    expect(callMap('low')).toBe(4);
  });

  it('valor desconocido cae a 0 (No priority)', () => {
    expect(callMap('mega-urgent')).toBe(0);
    expect(callMap('p0')).toBe(0);
  });
});

describe('LinearTrackerProvider — sanitizeLinearError', () => {
  const sanitize = (raw: string) =>
    (buildProvider() as any).sanitizeLinearError(raw) as string;

  it('descarta el JSON dump que la SDK de Linear concatena al mensaje', () => {
    // Forma real del error de @linear/sdk: "<message>: { "request": {...}, "response": {...} }"
    const dump = `Argument Validation Error: { "request": { "query": "mutation { issueCreate ... }", "variables": { "title": "secreto" } }, "response": { ... } }`;
    const out = sanitize(dump);
    expect(out).not.toContain('issueCreate');
    expect(out).not.toContain('secreto');
    expect(out).not.toContain('"variables"');
  });

  it('trunca a 200 chars max', () => {
    const long = 'X'.repeat(500);
    expect(sanitize(long).length).toBeLessThanOrEqual(200);
  });

  it('mantiene la primera línea legible', () => {
    expect(sanitize('Invalid API key\nExtra debug noise')).toBe('Invalid API key');
  });

  it('input vacío devuelve placeholder', () => {
    expect(sanitize('')).toBe('Error desconocido contactando Linear');
  });
});

describe('LinearTrackerProvider — escapeMarkdown', () => {
  const esc = (input: string) =>
    (buildProvider() as any).escapeMarkdown(input) as string;

  it('escapa brackets para neutralizar links phishing', () => {
    const phishing = '[Click for refund](https://attacker.example/phish)';
    const out = esc(phishing);
    expect(out).toContain('\\[');
    expect(out).toContain('\\]');
  });

  it('escapa headers en línea propia para evitar imitar el footer CENZONTLE', () => {
    const fake = '# Sincronizado desde CENZONTLE';
    expect(esc(fake)).toBe('\\# Sincronizado desde CENZONTLE');
  });

  it('preserva contenido legible', () => {
    expect(esc('Texto normal sin markdown')).toBe('Texto normal sin markdown');
  });
});

describe('LinearTrackerProvider — buildEpicDescription', () => {
  const build = (epic: Partial<EpicPayload>) =>
    (buildProvider() as any).buildEpicDescription({
      id: 'epic-1',
      title: 'T',
      markdown: '',
      priority: 'medium',
      startDate: new Date('2026-01-01'),
      targetDate: new Date('2026-06-30'),
      stories: [],
      ...epic,
    }) as string;

  it('siempre incluye el footer de sincronización con el epic id', () => {
    expect(build({})).toContain('épica id `epic-1`');
  });

  it('passthrough markdown literal cuando viene v2 con headings', () => {
    const out = build({
      markdown: '## Descripción\n\nRediseño de checkout\n\n## Beneficios cualitativos\n\nMejor UX',
    });
    expect(out).toContain('## Descripción');
    expect(out).toContain('Rediseño de checkout');
    expect(out).toContain('## Beneficios cualitativos');
    expect(out).toContain('Mejor UX');
  });

  it('strip HTML tags peligrosos del markdown como defense-in-depth', () => {
    const out = build({
      markdown: '## Descripción\n\n<script>alert(1)</script><img onerror="x()" src="">Texto seguro',
    });
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).toContain('Texto seguro');
  });
});

describe('LinearTrackerProvider — buildStoryDescription', () => {
  const build = (story: Partial<StoryPayload>) =>
    (buildProvider() as any).buildStoryDescription({
      id: 's-1',
      title: 'T',
      storyPoints: 0,
      labels: [],
      ...story,
    }) as string;

  it('incluye la sección PO como markdown único', () => {
    const out = build({
      content: {
        po: {
          markdown:
            '## Antecedentes\n\nContexto de negocio\n\n## Objetivo\n\nReducir abandonos\n\n## Historia de usuario\n\nComo user quiero X',
        },
      },
    });
    expect(out).toContain('Definición de negocio');
    expect(out).toContain('Contexto de negocio');
    expect(out).toContain('Reducir abandonos');
    expect(out).toContain('Como user quiero X');
  });

  it('incluye la sección Technical como markdown único', () => {
    const out = build({
      content: {
        technical: {
          markdown:
            '## Arquitectura y componentes\n\nNestJS module + Prisma\n\n## Flujo de integración\n\nAPI → service → DB\n\n## Validaciones\n\n- Validar email\n- Validar fecha\n\n## Manejo de errores\n\n- HTTP 400 si falla',
        },
      },
    });
    expect(out).toContain('Solución técnica');
    expect(out).toContain('NestJS module');
    expect(out).toContain('API → service → DB');
    expect(out).toContain('Validar email');
    expect(out).toContain('HTTP 400 si falla');
  });

  it('incluye la sección QA como markdown único', () => {
    const out = build({
      content: {
        qa: { markdown: '## Pruebas unitarias\n\nUnit tests + integration tests con MSW' },
      },
    });
    expect(out).toContain('Estrategia QA');
    expect(out).toContain('Unit tests + integration tests con MSW');
  });

  it('omite secciones cuando el markdown viene vacío o solo whitespace', () => {
    const out = build({
      content: {
        po: { markdown: '' },
        technical: { markdown: '   \n  ' },
        qa: { markdown: '## Pruebas unitarias\n\nContenido' },
      },
    });
    expect(out).not.toContain('Definición de negocio');
    expect(out).not.toContain('Solución técnica');
    expect(out).toContain('Estrategia QA');
  });

  it('escapa labels antes de concatenar (defensa phishing)', () => {
    const out = build({ labels: ['[evil](javascript:1)', 'normal'] });
    expect(out).toContain('\\[evil\\]');
    expect(out).toContain('normal');
  });

  it('omite secciones cuando los campos están vacíos', () => {
    const out = build({});
    expect(out).not.toContain('Definición de negocio');
    expect(out).not.toContain('Solución técnica');
    expect(out).not.toContain('Testing strategy');
    expect(out).toContain('story id `s-1`');
  });

  it('renderiza sección "🔗 Dependencias técnicas" agrupada por categoría cuando hay techDeps', () => {
    const out = build({
      technicalDependencies: [
        {
          id: 'd1',
          storyId: 's-1',
          title: 'Stripe API key',
          description: 'Para checkout',
          category: 'secrets',
          severity: 'critical',
          source: 'discovered',
          vendor: 'Stripe',
          requiresCredential: true,
          linkedSecretId: null,
          isBlocking: true,
          targetExternalName: null,
          targetEpicId: null,
          status: 'identified',
          owner: '',
          dueDate: null,
          resolutionNotes: '',
          mdContent: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
        {
          id: 'd2',
          storyId: 's-1',
          title: 'Endpoint /api/users',
          description: '',
          category: 'apis',
          severity: 'medium',
          source: 'manual',
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
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    });
    expect(out).toContain('🔗 Dependencias técnicas');
    expect(out).toContain('🔑 Secrets y credenciales');
    expect(out).toContain('🔌 APIs e integraciones');
    expect(out).toContain('Stripe API key');
    expect(out).toContain('Stripe');
    expect(out).toContain('[CRITICAL]');
    expect(out).toContain('⚠️ Bloqueante');
    expect(out).toContain('🔑 Requiere credencial');
    expect(out).toContain('Endpoint /api/users');
  });

  it('omite la sección de dependencias cuando techDeps está vacío o ausente', () => {
    const a = build({ technicalDependencies: [] });
    expect(a).not.toContain('🔗 Dependencias técnicas');
    const b = build({});
    expect(b).not.toContain('🔗 Dependencias técnicas');
  });
});

describe('LinearTrackerProvider — publishStoryRelations', () => {
  it('crea N relaciones blocks via SDK y devuelve ok=N failed=0 en happy path', async () => {
    const provider = buildProvider();
    const calls: any[] = [];
    (provider as any).client = {
      createIssueRelation: jest.fn(async (input: any) => {
        calls.push(input);
        return { success: true };
      }),
    };
    const result = await provider.publishStoryRelations([
      { blockedExternalId: 'b1', blockingExternalId: 'a1' },
      { blockedExternalId: 'b2', blockingExternalId: 'a2' },
    ]);
    expect(result.ok).toBe(2);
    expect(result.failed).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      issueId: 'b1',
      relatedIssueId: 'a1',
      type: 'blocks',
    });
  });

  it('failure parcial NO aborta el resto: ok=1 failed=1 cuando una llamada lanza', async () => {
    const provider = buildProvider();
    let callIdx = 0;
    (provider as any).client = {
      createIssueRelation: jest.fn(async () => {
        callIdx += 1;
        if (callIdx === 1) throw new Error('Linear rate limited');
        return { success: true };
      }),
    };
    const result = await provider.publishStoryRelations([
      { blockedExternalId: 'b1', blockingExternalId: 'a1' },
      { blockedExternalId: 'b2', blockingExternalId: 'a2' },
    ]);
    expect(result.ok).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      blockedExternalId: 'b1',
      blockingExternalId: 'a1',
    });
    expect(result.failed[0].error).toContain('Linear rate limited');
  });

  it('lista vacía → ok=0 failed=0 sin llamar al SDK', async () => {
    const provider = buildProvider();
    const spy = jest.fn();
    (provider as any).client = { createIssueRelation: spy };
    const result = await provider.publishStoryRelations([]);
    expect(result.ok).toBe(0);
    expect(result.failed).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
