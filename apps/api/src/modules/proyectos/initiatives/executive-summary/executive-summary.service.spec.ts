/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests de `computeMetrics` — el snapshot determinista que la IA recibe
 * como única fuente de verdad cuantitativa. NO se testea la llamada a
 * Anthropic (generate): eso exigiría mockear el SDK streaming completo y el
 * valor está en validar la aritmética/normalización, que es donde un bug
 * sería silencioso (la IA citaría números incorrectos sin que nada truene).
 *
 * También se cubren las costuras deterministas de `generate` que no tocan el
 * SDK: `sanitizeNarrative` (validación/capado del input crudo de la tool) y
 * `buildContextBlock` (cap global de extractos de épicas). Son privados — se
 * accede via `(service as any).method(...)`, mismo patrón que los validadores
 * privados de diagram-generation.service.spec.ts.
 *
 * Estrategia: PrismaService mockeado (estilo document-text-extractor /
 * diagram-generation specs) + reloj congelado con fake timers para que
 * timeline.elapsedPct / daysRemaining / today sean deterministas.
 */
import { NotFoundException } from '@nestjs/common';
import { StoryStatus } from '@cenzontle/shared';
import type { ExecutiveSummaryNarrative } from '@cenzontle/shared';
import { ExecutiveSummaryService } from './executive-summary.service';
import { createMockPinoLogger } from '../../../../common/testing/mock-pino-logger';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { OrgAnthropicConfigService } from '../../../org-anthropic-config/org-anthropic-config.service';

// ---------------------------------------------------------------------------
// Mock de PrismaService — solo los delegates que computeMetrics toca.
// ---------------------------------------------------------------------------
function createPrismaMock() {
  return {
    initiative: { findUnique: jest.fn() },
    storyDependency: { count: jest.fn() },
    storyTechnicalDependency: { count: jest.fn() },
  };
}

function createService(prisma: ReturnType<typeof createPrismaMock>): ExecutiveSummaryService {
  // OrgAnthropicConfigService no se invoca en computeMetrics — stub vacío.
  return new ExecutiveSummaryService(
    prisma as unknown as PrismaService,
    {} as OrgAnthropicConfigService,
    createMockPinoLogger(),
  );
}

// ---------------------------------------------------------------------------
// Fixture: iniciativa con 2 épicas / 6 historias en estados variados.
//
// Reloj congelado: 2026-06-10T12:00:00Z. Iniciativa 2026-06-01 → 2026-06-21:
//   - transcurrido: 9.5 días de 20 → 47.5% → round 48.
//   - daysRemaining: 21 - 10 = 11 días calendario.
//
// La historia s6 usa el valor `todo` que persiste Prisma (≠ `to_do` del enum
// compartido) — valida la normalización al contrato del summary.
// ---------------------------------------------------------------------------
const NOW = new Date('2026-06-10T12:00:00.000Z');

function buildInitiativeFixture() {
  return {
    id: 'init-1',
    name: 'Iniciativa Quetzal',
    status: 'active',
    owner: 'Ana PM',
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    targetDate: new Date('2026-06-21T00:00:00.000Z'),
    epics: [
      {
        id: 'epic-1',
        title: 'Épica Uno',
        status: 'in_progress',
        priority: 'high',
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        targetDate: new Date('2026-06-15T00:00:00.000Z'),
        stories: [
          { id: 's1', status: 'done', storyPoints: 5, podId: 'pod-a', pod: { name: 'Pod Alfa' } },
          { id: 's2', status: 'in_progress', storyPoints: 3, podId: 'pod-a', pod: { name: 'Pod Alfa' } },
          { id: 's3', status: 'blocked', storyPoints: 2, podId: 'pod-b', pod: { name: 'Pod Beta' } },
        ],
      },
      {
        id: 'epic-2',
        title: 'Épica Dos',
        status: 'draft',
        priority: 'medium',
        startDate: new Date('2026-06-10T00:00:00.000Z'),
        targetDate: new Date('2026-06-30T00:00:00.000Z'),
        stories: [
          { id: 's4', status: 'backlog', storyPoints: 8, podId: 'pod-b', pod: { name: 'Pod Beta' } },
          { id: 's5', status: 'done', storyPoints: 1, podId: 'pod-b', pod: { name: 'Pod Beta' } },
          // Valor crudo de Prisma (`todo`) — debe agruparse bajo `to_do`.
          { id: 's6', status: 'todo', storyPoints: 4, podId: 'pod-a', pod: { name: 'Pod Alfa' } },
        ],
      },
    ],
  };
}

describe('ExecutiveSummaryService.computeMetrics', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('iniciativa con 2 épicas y 6 historias', () => {
    let prisma: ReturnType<typeof createPrismaMock>;
    let service: ExecutiveSummaryService;

    beforeEach(() => {
      prisma = createPrismaMock();
      prisma.initiative.findUnique.mockResolvedValue(buildInitiativeFixture());
      // hard=2, soft=1 — distinguidos por el filtro `hardness` del where.
      prisma.storyDependency.count.mockImplementation((args: any) =>
        Promise.resolve(args.where.hardness === 'hard' ? 2 : 1),
      );
      // open=3, blocking=1 — distinguidos por presencia de `isBlocking`.
      prisma.storyTechnicalDependency.count.mockImplementation((args: any) =>
        Promise.resolve(args.where.isBlocking === true ? 1 : 3),
      );
      service = createService(prisma);
    });

    it('computa totales y progressPct sobre historias done', async () => {
      const metrics = await service.computeMetrics('init-1');

      expect(metrics.totals).toEqual({
        epics: 2,
        stories: 6,
        storiesDone: 2,
        storiesBlocked: 1,
        points: 23,
        pointsDone: 6,
        progressPct: 33, // round(100 * 2 / 6)
        epicsByStatus: { draft: 1, in_progress: 1, done: 0, blocked: 0 },
      });
      expect(metrics.initiative).toEqual({
        id: 'init-1',
        name: 'Iniciativa Quetzal',
        status: 'active',
        owner: 'Ana PM',
        startDate: '2026-06-01T00:00:00.000Z',
        targetDate: '2026-06-21T00:00:00.000Z',
      });
    });

    it('emite los 7 StoryStatus en orden del enum, con count=0 incluido, normalizando todo→to_do', async () => {
      const metrics = await service.computeMetrics('init-1');

      expect(metrics.storyDistribution).toEqual([
        { status: StoryStatus.Backlog, count: 1, points: 8 },
        { status: StoryStatus.ToDo, count: 1, points: 4 }, // s6 con valor Prisma `todo`
        { status: StoryStatus.InProgress, count: 1, points: 3 },
        { status: StoryStatus.InReview, count: 0, points: 0 },
        { status: StoryStatus.QA, count: 0, points: 0 },
        { status: StoryStatus.Done, count: 2, points: 6 },
        { status: StoryStatus.Blocked, count: 1, points: 2 },
      ]);
    });

    it('computa la fila por épica con puntos y progreso propios', async () => {
      const metrics = await service.computeMetrics('init-1');

      expect(metrics.epics).toHaveLength(2);
      expect(metrics.epics[0]).toEqual({
        epicId: 'epic-1',
        title: 'Épica Uno',
        status: 'in_progress',
        priority: 'high',
        storiesTotal: 3,
        storiesDone: 1,
        storiesBlocked: 1,
        pointsTotal: 10,
        pointsDone: 5,
        progressPct: 33,
        startDate: '2026-06-01T00:00:00.000Z',
        targetDate: '2026-06-15T00:00:00.000Z',
      });
      expect(metrics.epics[1]).toMatchObject({
        epicId: 'epic-2',
        storiesTotal: 3,
        storiesDone: 1,
        storiesBlocked: 0,
        pointsTotal: 13,
        pointsDone: 1,
        progressPct: 33,
      });
    });

    it('agrupa pods por el podId de la HISTORIA con nombre resuelto desde Pod', async () => {
      const metrics = await service.computeMetrics('init-1');

      // pod-a: s1 (done, 5) + s2 (3) + s6 (4) — cruza ambas épicas.
      // pod-b: s3 (2) + s4 (8) + s5 (done, 1).
      expect(metrics.pods).toEqual(
        expect.arrayContaining([
          {
            podId: 'pod-a',
            podName: 'Pod Alfa',
            storiesTotal: 3,
            storiesDone: 1,
            pointsTotal: 12,
            pointsDone: 5,
            progressPct: 33,
          },
          {
            podId: 'pod-b',
            podName: 'Pod Beta',
            storiesTotal: 3,
            storiesDone: 1,
            pointsTotal: 11,
            pointsDone: 1,
            progressPct: 33,
          },
        ]),
      );
      expect(metrics.pods).toHaveLength(2);
    });

    it('computa timeline con reloj congelado: elapsedPct 48, daysRemaining 11, today fijo', async () => {
      const metrics = await service.computeMetrics('init-1');

      expect(metrics.timeline).toEqual({
        startDate: '2026-06-01T00:00:00.000Z',
        targetDate: '2026-06-21T00:00:00.000Z',
        today: '2026-06-10',
        elapsedPct: 48, // 9.5 días de 20 → 47.5 → round 48
        daysRemaining: 11, // 21 - 10 días calendario
      });
      expect(metrics.computedAt).toBe(NOW.toISOString());
    });

    it('cuenta dependencias filtrando ambos extremos dentro de la iniciativa', async () => {
      const metrics = await service.computeMetrics('init-1');

      expect(metrics.dependencies).toEqual({
        hardBlocks: 2,
        softBlocks: 1,
        technicalOpen: 3,
        technicalBlocking: 1,
      });

      const storyIds = ['s1', 's2', 's3', 's4', 's5', 's6'];
      // StoryDependency: AMBOS extremos (storyId y blockedById) deben
      // pertenecer a la iniciativa — sin esto contaríamos aristas hacia
      // historias de otras iniciativas.
      expect(prisma.storyDependency.count).toHaveBeenCalledWith({
        where: { storyId: { in: storyIds }, blockedById: { in: storyIds }, hardness: 'hard' },
      });
      expect(prisma.storyDependency.count).toHaveBeenCalledWith({
        where: { storyId: { in: storyIds }, blockedById: { in: storyIds }, hardness: 'soft' },
      });
      // Técnicas: abiertas = status fuera de resolved/mitigated.
      expect(prisma.storyTechnicalDependency.count).toHaveBeenCalledWith({
        where: { storyId: { in: storyIds }, status: { notIn: ['resolved', 'mitigated'] } },
      });
      expect(prisma.storyTechnicalDependency.count).toHaveBeenCalledWith({
        where: {
          storyId: { in: storyIds },
          status: { notIn: ['resolved', 'mitigated'] },
          isBlocking: true,
        },
      });
    });
  });

  describe('iniciativa vacía (0 épicas, sin fechas)', () => {
    let prisma: ReturnType<typeof createPrismaMock>;
    let service: ExecutiveSummaryService;

    beforeEach(() => {
      prisma = createPrismaMock();
      prisma.initiative.findUnique.mockResolvedValue({
        id: 'init-empty',
        name: 'Iniciativa Vacía',
        status: 'planning',
        owner: 'Ana PM',
        startDate: null,
        targetDate: null,
        epics: [],
      });
      service = createService(prisma);
    });

    it('no divide por cero: progressPct 0 y distribución completa en ceros', async () => {
      const metrics = await service.computeMetrics('init-empty');

      expect(metrics.totals).toEqual({
        epics: 0,
        stories: 0,
        storiesDone: 0,
        storiesBlocked: 0,
        points: 0,
        pointsDone: 0,
        progressPct: 0,
        epicsByStatus: { draft: 0, in_progress: 0, done: 0, blocked: 0 },
      });
      // Los 7 status presentes aunque todo sea cero — el chart necesita el eje.
      expect(metrics.storyDistribution).toHaveLength(7);
      expect(metrics.storyDistribution.every((s) => s.count === 0 && s.points === 0)).toBe(true);
      expect(metrics.epics).toEqual([]);
      expect(metrics.pods).toEqual([]);
    });

    it('timeline sin fechas: elapsedPct y daysRemaining null, today presente', async () => {
      const metrics = await service.computeMetrics('init-empty');

      expect(metrics.timeline).toEqual({
        startDate: null,
        targetDate: null,
        today: '2026-06-10',
        elapsedPct: null,
        daysRemaining: null,
      });
    });

    it('no consulta dependencias cuando no hay historias (evita `in: []`)', async () => {
      const metrics = await service.computeMetrics('init-empty');

      expect(metrics.dependencies).toEqual({
        hardBlocks: 0,
        softBlocks: 0,
        technicalOpen: 0,
        technicalBlocking: 0,
      });
      expect(prisma.storyDependency.count).not.toHaveBeenCalled();
      expect(prisma.storyTechnicalDependency.count).not.toHaveBeenCalled();
    });
  });

  describe('timeline parcial (fechas incompletas o degeneradas)', () => {
    function buildBareInitiative(startDate: Date | null, targetDate: Date | null) {
      return {
        id: 'init-fechas',
        name: 'Iniciativa Fechas',
        status: 'active',
        owner: 'Ana PM',
        startDate,
        targetDate,
        epics: [],
      };
    }

    async function metricsFor(startDate: Date | null, targetDate: Date | null) {
      const prisma = createPrismaMock();
      prisma.initiative.findUnique.mockResolvedValue(buildBareInitiative(startDate, targetDate));
      return createService(prisma).computeMetrics('init-fechas');
    }

    it('solo targetDate (sin startDate): elapsedPct null pero daysRemaining sí se computa', async () => {
      const metrics = await metricsFor(null, new Date('2026-06-30T00:00:00.000Z'));

      // elapsedPct exige AMBAS fechas (no hay span sin start) — queda null.
      expect(metrics.timeline.elapsedPct).toBeNull();
      // daysRemaining solo necesita target: 30 - 10 de junio en medianoches
      // UTC → 20 días calendario.
      expect(metrics.timeline.daysRemaining).toBe(20);
    });

    it('fechas degeneradas (target < start, span <= 0): elapsedPct binario 100, daysRemaining 0', async () => {
      const metrics = await metricsFor(
        new Date('2026-06-15T00:00:00.000Z'),
        new Date('2026-06-10T00:00:00.000Z'),
      );

      // span negativo entra a la rama binaria vencido/no-vencido: now
      // (2026-06-10T12:00Z) >= target (2026-06-10T00:00Z) → 100.
      expect(metrics.timeline.elapsedPct).toBe(100);
      // target y today comparten medianoche UTC (2026-06-10) → 0 días.
      expect(metrics.timeline.daysRemaining).toBe(0);
    });
  });

  it('lanza NotFoundException si la iniciativa no existe', async () => {
    const prisma = createPrismaMock();
    prisma.initiative.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.computeMetrics('no-existe')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// sanitizeNarrative — validación y capado defensivo del JSON crudo del
// structured output (output_config.format). null = dispara el retry correctivo del
// caller; los arrays toleran ítems malformados (se descartan) y se capan.
// ---------------------------------------------------------------------------
describe('ExecutiveSummaryService.sanitizeNarrative', () => {
  // Topes definidos en el service (no exportados) — mantener en sync:
  // MAX_TITLE_LEN / MAX_FIELD_LEN / MAX_ARRAY_ITEMS.
  const MAX_TITLE_LEN = 300;
  const MAX_FIELD_LEN = 20_000;
  const MAX_ARRAY_ITEMS = 8;

  let service: ExecutiveSummaryService;

  beforeEach(() => {
    service = createService(createPrismaMock());
  });

  const sanitize = (raw: unknown): ExecutiveSummaryNarrative | null =>
    (service as any).sanitizeNarrative(raw);

  function buildValidInput() {
    return {
      headline: 'Iniciativa al 33% con riesgo moderado',
      health: 'at_risk',
      healthRationale: 'Progreso 33% vs 48% de tiempo transcurrido.',
      overview: 'La iniciativa avanza por debajo del ritmo esperado.',
      highlights: [
        { title: 'Avance', detail: '2 de 6 historias done', tone: 'positive' },
        { title: 'Bloqueos', detail: '1 historia bloqueada', tone: 'warning' },
      ],
      risks: [
        {
          title: 'Dependencias técnicas',
          detail: '3 abiertas, 1 bloqueante',
          severity: 'high',
          mitigation: 'Resolver antes del siguiente sprint',
        },
      ],
      recommendations: [{ title: 'Repriorizar', detail: 'Adelantar la épica dos' }],
    };
  }

  it('devuelve la narrativa intacta con input válido completo', () => {
    expect(sanitize(buildValidInput())).toEqual(buildValidInput());
  });

  it('devuelve null si falta un campo requerido (healthRationale)', () => {
    const input: Record<string, unknown> = { ...buildValidInput() };
    delete input.healthRationale;

    expect(sanitize(input)).toBeNull();
  });

  it('devuelve null con health fuera del enum (casing inválido)', () => {
    expect(sanitize({ ...buildValidInput(), health: 'On Track' })).toBeNull();
  });

  it('descarta ítems con title/detail vacío o faltante y conserva el resto', () => {
    const result = sanitize({
      ...buildValidInput(),
      highlights: [
        { title: '   ', detail: 'title whitespace', tone: 'positive' }, // trim → vacío
        { detail: 'sin title', tone: 'neutral' },
        { title: 'Sobrevive', detail: 'ok', tone: 'warning' },
      ],
      risks: [
        { title: 'Sin detail', severity: 'high' },
        { title: 'Riesgo real', detail: 'ok', severity: 'low' },
      ],
      recommendations: [{ title: 'Solo title' }, { title: 'Reco', detail: 'ok' }],
    });

    expect(result?.highlights).toEqual([{ title: 'Sobrevive', detail: 'ok', tone: 'warning' }]);
    expect(result?.risks).toEqual([{ title: 'Riesgo real', detail: 'ok', severity: 'low' }]);
    expect(result?.recommendations).toEqual([{ title: 'Reco', detail: 'ok' }]);
  });

  it('capa los arrays a MAX_ARRAY_ITEMS conservando los primeros en orden', () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        title: `${prefix} ${i + 1}`,
        detail: 'detalle',
        tone: 'neutral',
        severity: 'medium',
      }));

    const result = sanitize({
      ...buildValidInput(),
      highlights: many('Highlight', 10),
      risks: many('Riesgo', 9),
      recommendations: many('Reco', 12),
    });

    expect(result?.highlights).toHaveLength(MAX_ARRAY_ITEMS);
    expect(result?.risks).toHaveLength(MAX_ARRAY_ITEMS);
    expect(result?.recommendations).toHaveLength(MAX_ARRAY_ITEMS);
    // slice(0, MAX_ARRAY_ITEMS) corre ANTES del filtrado: conserva los
    // PRIMEROS ítems del array crudo, en orden.
    expect(result?.highlights[0].title).toBe('Highlight 1');
    expect(result?.highlights[7].title).toBe('Highlight 8');
  });

  it('capa strings que exceden los topes de longitud', () => {
    const result = sanitize({
      ...buildValidInput(),
      headline: 'h'.repeat(MAX_TITLE_LEN + 100),
      healthRationale: 'r'.repeat(MAX_FIELD_LEN + 5_000),
      overview: 'o'.repeat(MAX_FIELD_LEN + 1),
      highlights: [
        {
          title: 't'.repeat(MAX_TITLE_LEN + 1),
          detail: 'd'.repeat(MAX_FIELD_LEN + 7),
          tone: 'positive',
        },
      ],
      risks: [
        { title: 'Riesgo', detail: 'ok', severity: 'high', mitigation: 'm'.repeat(MAX_FIELD_LEN + 1) },
      ],
    });

    expect(result?.headline).toHaveLength(MAX_TITLE_LEN);
    expect(result?.healthRationale).toHaveLength(MAX_FIELD_LEN);
    expect(result?.overview).toHaveLength(MAX_FIELD_LEN);
    expect(result?.highlights[0].title).toHaveLength(MAX_TITLE_LEN);
    expect(result?.highlights[0].detail).toHaveLength(MAX_FIELD_LEN);
    expect(result?.risks[0].mitigation).toHaveLength(MAX_FIELD_LEN);
  });
});

// ---------------------------------------------------------------------------
// buildContextBlock — bloque cualitativo del system prompt: descripción +
// JSON de métricas SIEMPRE presentes; los extractos de épicas se capan al
// presupuesto global de chars.
// ---------------------------------------------------------------------------
describe('ExecutiveSummaryService.buildContextBlock', () => {
  // Constante del service (no exportada) — mantener en sync con
  // EPIC_EXCERPT_CHARS. El cap global (EPIC_CONTEXT_CAP_CHARS = 40_000) se
  // ejercita indirectamente en el test de truncado, sin espejarlo acá.
  const EPIC_EXCERPT_CHARS = 1_500;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('trunca extractos al cap global e incluye siempre descripción + JSON de métricas', async () => {
    const prisma = createPrismaMock();
    prisma.initiative.findUnique.mockResolvedValue({
      id: 'init-cap',
      name: 'Iniciativa Cap',
      status: 'active',
      owner: 'Ana PM',
      startDate: null,
      targetDate: null,
      epics: [],
    });
    const service = createService(prisma);
    // Métricas reales (deterministas con el reloj congelado) para validar que
    // el JSON viaja completo al prompt independientemente del cap de épicas.
    const metrics = await service.computeMetrics('init-cap');

    // 30 épicas con markdown > EPIC_EXCERPT_CHARS: cada bloque queda en
    // `### Épica NN\n` (13 chars) + 1500 de body = 1513 chars.
    // floor(40000 / 1513) = 26 → la #27 dispara `usedChars + block.length >
    // EPIC_CONTEXT_CAP_CHARS` (39338 + 1513 = 40851) y el break corta ahí:
    // de la 27 en adelante quedan fuera.
    const epics = Array.from({ length: 30 }, (_, i) => ({
      title: `Épica ${String(i + 1).padStart(2, '0')}`,
      markdown: 'x'.repeat(EPIC_EXCERPT_CHARS + 500),
    }));

    const block: string = (service as any).buildContextBlock(
      'Descripción de la iniciativa',
      epics,
      metrics,
    );

    // Descripción y métricas SIEMPRE presentes — el cap solo aplica a épicas.
    expect(block).toContain(
      '<initiative_description>\nDescripción de la iniciativa\n</initiative_description>',
    );
    expect(block).toContain(`<metrics>\n${JSON.stringify(metrics, null, 2)}\n</metrics>`);

    // 26 extractos entran al presupuesto; del 27 en adelante, excluidos.
    expect(block).toContain('### Épica 26');
    expect(block).not.toContain('### Épica 27');
    expect(block.match(/### Épica /g)).toHaveLength(26);
  });
});
