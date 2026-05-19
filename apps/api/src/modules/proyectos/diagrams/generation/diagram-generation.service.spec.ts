/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests para los validadores privados de cobertura narrativa
 * bidireccional nodo ↔ step y rango numérico (3-10):
 *
 *   - `validateDiagramInput(input, opts)` — Fase 7 (requireStepCoverage)
 *   - `validateIntegrationDocInput(input, diagram)` — path de backfill
 *
 * Estrategia: los métodos son puros sobre el input (no tocan deps
 * inyectadas), así que instanciamos el servicio con stubs triviales y
 * accedemos via `(service as any).method(...)`. Testear vía `generate()`
 * exigiría mockear Anthropic/Prisma/Redis y matar el aislamiento.
 */

// ---------------------------------------------------------------------------
// Mocks de transitive deps ESM-only que rompen el parser de Jest al cargar
// `diagram-generation.service.ts`. Jest 29 + ts-jest no procesan ESM de
// node_modules por defecto — mockearlos con stubs CJS evita el error
// "Cannot use import statement outside a module" sin tocar la config global.
//
// Cadena observada: diagram-generation → code-glob.tool → code-repo-clone →
// code-repository-config → @octokit/rest (ESM-only desde v22).
// ---------------------------------------------------------------------------
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue({}),
}));

import type { EpicDiagram } from '@cenzontle/shared';
import { DiagramGenerationService } from './diagram-generation.service';
import { createMockPinoLogger } from '../../../../common/testing/mock-pino-logger';

// ---------------------------------------------------------------------------
// Stubs de deps — el constructor solo las guarda como refs privadas; los
// validators bajo test no las invocan, así que basta con objetos vacíos.
// ---------------------------------------------------------------------------

function createService(): DiagramGenerationService {
  const configStub = { get: jest.fn().mockReturnValue(undefined) } as any;
  const emptyStub = {} as any;

  return new DiagramGenerationService(
    configStub, // ConfigService
    emptyStub,  // PrismaService
    emptyStub,  // InitiativeDocumentsTool
    emptyStub,  // CodeGlobTool
    emptyStub,  // CodeGrepTool
    emptyStub,  // CodeReadTool
    emptyStub,  // VaultGlobTool
    emptyStub,  // VaultGrepTool
    emptyStub,  // VaultReadTool
    emptyStub,  // CodeRepoCloneService
    emptyStub,  // DiagramCacheService
    emptyStub,  // ChangelogService
    emptyStub,  // VaultService
    emptyStub,  // AgentTokenSettingsService
    createMockPinoLogger(),
  );
}

// ---------------------------------------------------------------------------
// Fixtures — diagrama válido base parametrizable por test.
//
// Topología: 5 nodos (client, gateway, service, database, process)
// encadenados linealmente con 4 edges que aportan labels semánticos
// (pasan el TRIVIAL_EDGE_LABELS check + longitud ≤ 12 chars).
//
// 3 steps (mínimo del nuevo rango 3-10) cubren los 5 nodos entre todos
// → cobertura narrativa total. El markdown de ~2000 chars cae dentro
// de [1500, 100_000] → acepta.
// ---------------------------------------------------------------------------

const BASE_NODES = [
  { id: 'node-client', type: 'client', label: 'Web Client', group: 'frontend' },
  { id: 'node-gw', type: 'gateway', label: 'API Gateway', group: 'infra' },
  { id: 'node-svc', type: 'service', label: 'Auth Service', group: 'backend' },
  { id: 'node-db', type: 'database', label: 'Users DB', group: 'data' },
  { id: 'node-proc', type: 'process', label: 'Token Issue', group: 'backend' },
];

const BASE_EDGES = [
  { id: 'e1', source: 'node-client', target: 'node-gw', label: 'REST·POST' },
  { id: 'e2', source: 'node-gw', target: 'node-svc', label: 'calls' },
  { id: 'e3', source: 'node-svc', target: 'node-db', label: 'reads' },
  { id: 'e4', source: 'node-svc', target: 'node-proc', label: 'emits' },
];

const BASE_STEPS_FULL_COVERAGE = [
  {
    id: 'step-1',
    order: 1,
    title: 'Entrada de petición',
    description:
      'El cliente envía credenciales al gateway vía HTTPS — el gateway es el primer punto de contacto del flujo.',
    nodeIds: ['node-client', 'node-gw'],
  },
  {
    id: 'step-2',
    order: 2,
    title: 'Autenticación y consulta de usuario',
    description:
      'El gateway redirige al servicio de autenticación, que consulta la base de datos para validar credenciales.',
    nodeIds: ['node-gw', 'node-svc', 'node-db'],
  },
  {
    id: 'step-3',
    order: 3,
    title: 'Emisión de token',
    description:
      'El servicio de autenticación delega en el proceso de emisión para firmar y retornar el JWT al cliente.',
    nodeIds: ['node-svc', 'node-proc'],
  },
];

// Markdown de ~2000 chars — pasa el piso de 1500 del sanitizador.
const VALID_MARKDOWN = [
  '## Resumen ejecutivo',
  'Este documento describe el flujo de autenticación end-to-end entre el cliente web, el gateway, el servicio de autenticación, la base de datos y el proceso de emisión de tokens JWT.',
  '## Contexto y motivación',
  'El objetivo es centralizar la emisión de tokens bajo un único servicio con dependencia estricta del store persistente, de modo que la validación de credenciales no dependa del gateway.',
  '## Actores y sistemas',
  'Cliente web (SPA), API Gateway (NGINX), Auth Service (NestJS), Users DB (PostgreSQL), Token Issue (módulo crypto).',
  '## Flujo paso a paso',
  'Paso 1: el cliente envía POST /auth con credenciales. Paso 2: el gateway valida el schema y rutea al servicio. Paso 3: el servicio consulta la DB. Paso 4: el proceso emite el JWT firmado.',
  '## Consideraciones técnicas',
  'La firma usa RS256 con clave privada rotada cada 90 días. El gateway hace rate-limiting de 100 req/min por IP y el servicio valida schema de entrada con class-validator antes de tocar la DB. El token emitido tiene vida útil de 15 minutos y se acompaña de un refresh token de 7 días con rotación. La DB usa índice único sobre email para lookup O(log n) y todas las queries pasan por prepared statements para evitar SQL injection.',
  '## Dependencias y prerrequisitos',
  'Redis operativo para blacklist de tokens revocados, DB con tabla users migrada a la versión 0.4.2, claves RS256 en el vault de secretos.',
  '## Casos de falla y rollback',
  'Si la DB cae, el servicio responde 503 y el gateway activa circuit breaker. Si la firma RS256 falla, reintento con clave anterior durante ventana de 24h post-rotación.',
  '## Riesgos identificados',
  'Claves comprometidas permitirían emisión fraudulenta — mitigar con rotación frecuente y revocación proactiva vía blacklist. Latencia de la DB puede degradar la respuesta del login bajo carga alta.',
  '## Referencias',
  'RFC 7519 (JWT), OWASP ASVS v4.0.3 sección 3, arquitectura interna en Confluence.',
].join('\n\n');

// Input base sin steps/markdown — sirve para probar permutaciones.
function baseInputNoSteps(): Record<string, unknown> {
  return {
    name: 'Auth Flow E2E',
    description: 'Flujo de autenticación cliente → gateway → servicio → DB',
    nodes: BASE_NODES.map((n) => ({ ...n })),
    edges: BASE_EDGES.map((e) => ({ ...e })),
  };
}

// Input base completo (steps + markdown válidos) — happy path.
function baseInputFullCoverage(): Record<string, unknown> {
  return {
    ...baseInputNoSteps(),
    steps: BASE_STEPS_FULL_COVERAGE.map((s) => ({
      ...s,
      nodeIds: [...s.nodeIds],
    })),
    integrationFlowMarkdown: VALID_MARKDOWN,
  };
}

// Diagrama existente (shape `EpicDiagram`) para validateIntegrationDocInput.
function baseEpicDiagram(): EpicDiagram {
  return {
    id: 'diag-test-1',
    name: 'Auth Flow E2E',
    type: 'technical',
    nodes: BASE_NODES.map((n) => ({ ...n })) as EpicDiagram['nodes'],
    edges: BASE_EDGES.map((e) => ({ ...e })) as EpicDiagram['edges'],
    generatedAt: '2026-04-21T00:00:00.000Z',
    generatedBy: 'ai',
  };
}

// Genera N steps distribuidos sobre los 5 BASE_NODES — útil para probar
// rango numérico (3-10). Los steps se duplican rotando los nodeIds para
// que la cobertura bidireccional se mantenga al 100% mientras el conteo
// de steps varía.
function stepsOfLength(n: number): Record<string, unknown>[] {
  const nodes = BASE_NODES.map((node) => node.id);
  return Array.from({ length: n }, (_, i) => ({
    id: `step-${i + 1}`,
    order: i + 1,
    title: `Fase ${i + 1}`,
    description: `Descripción del step ${i + 1} con narrativa suficientemente larga para pasar los checks mínimos del sanitizador.`,
    // Cada step incluye TODOS los nodos → garantiza cobertura 100% aunque
    // solo pase el primer step. Esto aísla el check de rango del de cobertura.
    nodeIds: [...nodes],
  }));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DiagramGenerationService — validadores privados (cobertura + rango)', () => {
  let service: DiagramGenerationService;

  beforeEach(() => {
    service = createService();
  });

  // =========================================================================
  // validateDiagramInput — path principal del agente
  // =========================================================================

  describe('validateDiagramInput (requireStepCoverage=true)', () => {
    it('rechaza cuando steps es undefined: ok=false y error menciona "steps requerido"', () => {
      const input = baseInputNoSteps();

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('steps requerido');
    });

    it('rechaza cuando steps está presente pero vacío: ok=false (sanitizado a undefined)', () => {
      const input = { ...baseInputNoSteps(), steps: [] };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('steps requerido');
    });

    it('rechaza cuando todos los steps se descartan por nodeIds inexistentes', () => {
      const input = {
        ...baseInputNoSteps(),
        steps: [
          {
            id: 'step-ghost',
            order: 1,
            title: 'Paso fantasma',
            description: 'Referencia nodos que no existen en el diagrama.',
            nodeIds: ['nonexistent-1', 'nonexistent-2'],
          },
        ],
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('steps requerido');
    });

    it('rechaza cuando hay <3 steps (infra-descomposición): ok=false con mensaje educativo', () => {
      // 2 steps que cubren los 5 nodos (sin orphans) — falla solo por rango.
      const input = {
        ...baseInputNoSteps(),
        steps: [
          {
            id: 's1',
            order: 1,
            title: 'Entrada',
            description: 'Cliente contacta gateway y servicio.',
            nodeIds: ['node-client', 'node-gw', 'node-svc'],
          },
          {
            id: 's2',
            order: 2,
            title: 'Persistencia y emisión',
            description: 'Servicio consulta DB y emite token.',
            nodeIds: ['node-db', 'node-proc'],
          },
        ],
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/entre 3 y 10 pasos/);
      expect(result.error).toMatch(/encontrados:\s*2/);
      expect(result.error).toContain('Infra-descomposición');
    });

    it('rechaza cuando hay >10 steps (sobre-descomposición): ok=false con mensaje educativo', () => {
      // 11 steps con cobertura completa — falla solo por rango.
      const input = {
        ...baseInputNoSteps(),
        steps: stepsOfLength(11),
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/entre 3 y 10 pasos/);
      expect(result.error).toMatch(/encontrados:\s*11/);
      expect(result.error).toContain('Sobre-descomposición');
    });

    it('acepta exactamente 3 steps (borde inferior del rango)', () => {
      const input = { ...baseInputNoSteps(), steps: stepsOfLength(3) };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data.steps).toHaveLength(3);
    });

    it('acepta exactamente 10 steps (borde superior del rango)', () => {
      const input = { ...baseInputNoSteps(), steps: stepsOfLength(10) };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data.steps).toHaveLength(10);
    });

    it('rechaza cuando existe nodo huérfano (con steps dentro del rango): ok=false y error nombra el nodo', () => {
      // 3 steps cubren 4 de los 5 nodos — `node-proc` queda huérfano narrativamente.
      const input = {
        ...baseInputNoSteps(),
        steps: [
          {
            id: 'step-1',
            order: 1,
            title: 'Entrada',
            description: 'Cliente contacta gateway.',
            nodeIds: ['node-client', 'node-gw'],
          },
          {
            id: 'step-2',
            order: 2,
            title: 'Servicio y DB',
            description: 'Gateway llama servicio que consulta DB.',
            nodeIds: ['node-svc', 'node-db'],
          },
          {
            id: 'step-3',
            order: 3,
            title: 'Gateway redundante',
            description: 'Re-describe el gateway desde otro ángulo operativo.',
            nodeIds: ['node-gw'],
          },
        ],
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Token Issue');
      expect(result.error).toContain('node-proc');
      expect(result.error).toContain('nodeIds');
    });

    it('acepta cuando todos los nodos están cubiertos y el conteo cae en rango', () => {
      const input = baseInputFullCoverage();

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data.steps).toHaveLength(3);
      expect(result.data.steps[0].id).toBe('step-1');
      expect(result.data.steps[2].id).toBe('step-3');
      expect(result.data.integrationFlowMarkdown).toBe(VALID_MARKDOWN);
    });

    it('nombra hasta 3 nodos huérfanos + "(+N más)" cuando hay 4+ huérfanos', () => {
      // 6 nodos y 3 steps que TODOS cubren solo n1 → 5 huérfanos.
      const nodes = [
        { id: 'n1', type: 'client', label: 'A', group: 'frontend' },
        { id: 'n2', type: 'service', label: 'B', group: 'backend' },
        { id: 'n3', type: 'service', label: 'C', group: 'backend' },
        { id: 'n4', type: 'service', label: 'D', group: 'backend' },
        { id: 'n5', type: 'service', label: 'E', group: 'backend' },
        { id: 'n6', type: 'database', label: 'F', group: 'data' },
      ];
      const edges = [
        { id: 'x1', source: 'n1', target: 'n2', label: 'calls' },
        { id: 'x2', source: 'n2', target: 'n3', label: 'calls' },
        { id: 'x3', source: 'n3', target: 'n4', label: 'calls' },
        { id: 'x4', source: 'n4', target: 'n5', label: 'calls' },
        { id: 'x5', source: 'n5', target: 'n6', label: 'writes' },
      ];
      const input = {
        name: 'Many orphans',
        description: 'diag with 5 orphan nodes',
        nodes,
        edges,
        steps: [
          {
            id: 's1',
            order: 1,
            title: 'Fase A',
            description: 'Solo cubre n1 desde la fase inicial.',
            nodeIds: ['n1'],
          },
          {
            id: 's2',
            order: 2,
            title: 'Fase B',
            description: 'Solo cubre n1 desde otra perspectiva operativa.',
            nodeIds: ['n1'],
          },
          {
            id: 's3',
            order: 3,
            title: 'Fase C',
            description: 'Solo cubre n1 desde una tercera perspectiva.',
            nodeIds: ['n1'],
          },
        ],
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/5 nodo\(s\)/);
      expect(result.error).toContain('(+2 más)');
    });

    it('exceptúa nodos type=reference del check de cobertura aun con requireStepCoverage=true', () => {
      // 3 nodos (1 reference) y 3 steps que cubren los 2 no-reference.
      const nodes = [
        { id: 'n1', type: 'client', label: 'Client', group: 'frontend' },
        { id: 'n2', type: 'service', label: 'Svc', group: 'backend' },
        { id: 'n-ref', type: 'reference', label: 'A', group: 'infra' },
      ];
      const edges = [
        { id: 'e1', source: 'n1', target: 'n2', label: 'calls' },
      ];
      const input = {
        name: 'Ref orphan exception',
        description: 'ref node sin step cobertura — debe pasar',
        nodes,
        edges,
        steps: [
          {
            id: 's1',
            order: 1,
            title: 'Cubre no-ref',
            description: 'El cliente invoca al servicio vía HTTPS.',
            nodeIds: ['n1', 'n2'],
          },
          {
            id: 's2',
            order: 2,
            title: 'Segunda fase',
            description: 'Segunda fase del flujo cliente-servicio.',
            nodeIds: ['n1'],
          },
          {
            id: 's3',
            order: 3,
            title: 'Tercera fase',
            description: 'Tercera fase centrada en el servicio.',
            nodeIds: ['n2'],
          },
        ],
      };

      const result = (service as any).validateDiagramInput(input, {
        allowReference: true,
        requireStepCoverage: true,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('validateDiagramInput (default: requireStepCoverage=false)', () => {
    it('NO exige steps con opts por defecto — permite diagrama sin steps', () => {
      const input = baseInputNoSteps();

      const result = (service as any).validateDiagramInput(input);

      expect(result.ok).toBe(true);
      expect(result.data.steps).toBeUndefined();
    });

    it('con opts={} (default) tampoco exige steps', () => {
      const input = baseInputNoSteps();

      const result = (service as any).validateDiagramInput(input, {});

      expect(result.ok).toBe(true);
      expect(result.data.steps).toBeUndefined();
    });

    it('no falla por huérfanos cuando requireStepCoverage=false — el check ni corre', () => {
      // 1 step con cobertura parcial — sin Fase 7 pasa igual (no aplica rango ni cobertura).
      const input = {
        ...baseInputNoSteps(),
        steps: [
          {
            id: 'step-1',
            order: 1,
            title: 'Solo parte',
            description: 'Solo cubre el cliente y el gateway.',
            nodeIds: ['node-client', 'node-gw'],
          },
        ],
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: false,
      });

      expect(result.ok).toBe(true);
      expect(result.data.steps).toHaveLength(1);
    });

    it('no falla por rango fuera de 3-10 cuando requireStepCoverage=false', () => {
      // 15 steps sin cobertura completa — Fase 7 no corre con flag en false.
      const input = {
        ...baseInputNoSteps(),
        steps: stepsOfLength(15),
      };

      const result = (service as any).validateDiagramInput(input, {
        requireStepCoverage: false,
      });

      expect(result.ok).toBe(true);
      expect(result.data.steps).toHaveLength(15);
    });
  });

  // =========================================================================
  // validateIntegrationDocInput — path de backfill
  // =========================================================================

  describe('validateIntegrationDocInput (backfill)', () => {
    it('rechaza cuando algún nodo del diagrama NO está cubierto por los steps: ok=false', () => {
      const diagram = baseEpicDiagram();
      // 3 steps cubren 4 de 5 nodos — `node-proc` huérfano en el backfill.
      const input = {
        steps: [
          {
            id: 'step-1',
            order: 1,
            title: 'Entrada',
            description: 'Cliente entra por gateway.',
            nodeIds: ['node-client', 'node-gw'],
          },
          {
            id: 'step-2',
            order: 2,
            title: 'Servicio + DB',
            description: 'Gateway invoca servicio que consulta DB.',
            nodeIds: ['node-svc', 'node-db'],
          },
          {
            id: 'step-3',
            order: 3,
            title: 'Gateway redundante',
            description: 'Re-describe el gateway desde otro ángulo operativo.',
            nodeIds: ['node-gw'],
          },
        ],
        integrationFlowMarkdown: VALID_MARKDOWN,
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('sin cobertura narrativa');
      expect(result.error).toContain('Token Issue');
      expect(result.error).toContain('node-proc');
    });

    it('rechaza cuando hay <3 steps (infra-descomposición) en backfill', () => {
      const diagram = baseEpicDiagram();
      const input = {
        steps: [
          {
            id: 'step-1',
            order: 1,
            title: 'Entrada',
            description: 'Cliente entra al flujo completo.',
            nodeIds: ['node-client', 'node-gw', 'node-svc'],
          },
          {
            id: 'step-2',
            order: 2,
            title: 'Persistencia',
            description: 'Servicio consulta DB y emite token.',
            nodeIds: ['node-db', 'node-proc'],
          },
        ],
        integrationFlowMarkdown: VALID_MARKDOWN,
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/entre 3 y 10 pasos/);
      expect(result.error).toMatch(/encontrados:\s*2/);
      expect(result.error).toContain('Infra-descomposición');
    });

    it('rechaza cuando hay >10 steps (sobre-descomposición) en backfill', () => {
      const diagram = baseEpicDiagram();
      const input = {
        steps: stepsOfLength(11),
        integrationFlowMarkdown: VALID_MARKDOWN,
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/entre 3 y 10 pasos/);
      expect(result.error).toMatch(/encontrados:\s*11/);
      expect(result.error).toContain('Sobre-descomposición');
    });

    it('acepta cuando todos los nodos del diagrama están cubiertos y hay 3 steps: ok=true', () => {
      const diagram = baseEpicDiagram();
      const input = {
        steps: BASE_STEPS_FULL_COVERAGE.map((s) => ({
          ...s,
          nodeIds: [...s.nodeIds],
        })),
        integrationFlowMarkdown: VALID_MARKDOWN,
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(result.integrationFlowMarkdown).toBe(VALID_MARKDOWN);
    });

    it('exceptúa nodos type=reference del check de cobertura en backfill', () => {
      const diagram: EpicDiagram = {
        ...baseEpicDiagram(),
        nodes: [
          ...baseEpicDiagram().nodes,
          {
            id: 'n-ref-backfill',
            type: 'reference',
            label: 'A',
            group: 'infra',
          },
        ],
      };
      const input = {
        steps: BASE_STEPS_FULL_COVERAGE.map((s) => ({
          ...s,
          nodeIds: [...s.nodeIds],
        })),
        integrationFlowMarkdown: VALID_MARKDOWN,
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(true);
    });

    it('rechaza cuando steps se vacía tras sanitización (nodeIds todos inexistentes)', () => {
      const diagram = baseEpicDiagram();
      const input = {
        steps: [
          {
            id: 'step-invalid',
            order: 1,
            title: 'Invalid',
            description: 'Refs nodeIds que no existen en el diagrama.',
            nodeIds: ['fake-1', 'fake-2'],
          },
        ],
        integrationFlowMarkdown: VALID_MARKDOWN,
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('steps vacío');
    });

    it('rechaza cuando markdown es más corto que el piso de 1500 chars', () => {
      const diagram = baseEpicDiagram();
      const input = {
        steps: BASE_STEPS_FULL_COVERAGE.map((s) => ({
          ...s,
          nodeIds: [...s.nodeIds],
        })),
        integrationFlowMarkdown: 'Too short markdown.',
      };

      const result = (service as any).validateIntegrationDocInput(input, diagram);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('integrationFlowMarkdown');
    });
  });
});
