import { FactoryMetricsService } from './metrics.service';

/**
 * Specs de FactoryMetricsService — la agregación que alimenta los charts
 * Factory Capacity + Token Burn del dashboard /factory.
 *
 * Mock manual de PrismaService (solo los 2 findMany que el servicio usa) y
 * de PinoLogger. No arranca el módulo NestJS — instanciación directa.
 *
 * Los tests son robustos a la hora-del-día: verifican propiedades agregadas
 * (suma total, "ningún bucket excede el cap") en vez de índices de bucket
 * concretos, que dependerían del minuto exacto de ejecución.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

interface RunRow {
  startedAt: Date;
  completedAt: Date | null;
  lastProgressAt: Date;
  status: string;
  generatorUsage: unknown;
  plannerUsage: unknown;
  dodVerification: unknown;
}

interface NodeRow {
  totalSlots: number;
  status: string;
  lastHeartbeat: Date | null;
}

function buildService(runs: RunRow[], nodes: NodeRow[]): FactoryMetricsService {
  const mockPrisma = {
    agentRun: { findMany: jest.fn().mockResolvedValue(runs) },
    computeNode: { findMany: jest.fn().mockResolvedValue(nodes) },
  };
  const mockLogger = { info: jest.fn() };
  return new FactoryMetricsService(
    mockPrisma as never,
    mockLogger as never,
  );
}

function makeRun(overrides: Partial<RunRow> = {}): RunRow {
  const now = Date.now();
  return {
    startedAt: new Date(now - 30 * MINUTE),
    completedAt: null,
    lastProgressAt: new Date(now - 5 * MINUTE),
    status: 'running',
    generatorUsage: null,
    plannerUsage: null,
    dodVerification: null,
    ...overrides,
  };
}

function makeNode(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    totalSlots: 3,
    status: 'online',
    lastHeartbeat: new Date(Date.now() - MINUTE),
    ...overrides,
  };
}

describe('FactoryMetricsService.getTimeseries', () => {
  it('siempre devuelve 24 buckets de 1h', async () => {
    const result = await buildService([], []).getTimeseries();
    expect(result.buckets).toHaveLength(24);
    expect(result.bucketsCount).toBe(24);
    expect(result.bucketDurationMs).toBe(HOUR);
  });

  it('fleet vacío → capacidad 0/0 y todos los buckets en cero', async () => {
    const result = await buildService([], []).getTimeseries();
    expect(result.currentCapacityTotal).toBe(0);
    expect(result.currentCapacityUsed).toBe(0);
    expect(result.onlineNodeCount).toBe(0);
    for (const b of result.buckets) {
      expect(b.capacityUsed).toBe(0);
      expect(b.tokensNew).toBe(0);
      expect(b.tokensCached).toBe(0);
    }
  });

  it('currentCapacityUsed = count de runs claimed|running (no capado)', async () => {
    const runs = [
      makeRun({ status: 'running' }),
      makeRun({ status: 'running' }),
      makeRun({ status: 'claimed' }),
      makeRun({ status: 'completed', completedAt: new Date() }),
    ];
    // 1 nodo, 2 slots — currentCapacityUsed NO se capa (es el count real).
    const result = await buildService(runs, [makeNode({ totalSlots: 2 })]).getTimeseries();
    expect(result.currentCapacityUsed).toBe(3);
    expect(result.currentCapacityTotal).toBe(2);
  });

  it('solo cuenta nodos online con heartbeat fresco (<10min)', async () => {
    const nodes = [
      makeNode({ totalSlots: 3, lastHeartbeat: new Date(Date.now() - MINUTE) }),
      makeNode({ totalSlots: 5, lastHeartbeat: new Date(Date.now() - 30 * MINUTE) }), // stale
      makeNode({ totalSlots: 7, status: 'offline', lastHeartbeat: new Date() }),
      makeNode({ totalSlots: 9, lastHeartbeat: null }),
    ];
    const result = await buildService([], nodes).getTimeseries();
    expect(result.currentCapacityTotal).toBe(3); // solo el primer nodo
    expect(result.onlineNodeCount).toBe(1);
  });

  it('capa capacityUsed de cada bucket a la capacidad total del fleet', async () => {
    // 6 runs in-flight solapando la ventana, fleet de solo 2 slots.
    const runs = Array.from({ length: 6 }, () =>
      makeRun({ status: 'running', startedAt: new Date(Date.now() - 40 * MINUTE) }),
    );
    const result = await buildService(runs, [makeNode({ totalSlots: 2 })]).getTimeseries();
    // Ningún bucket puede exceder los 2 slots reales.
    for (const b of result.buckets) {
      expect(b.capacityUsed).toBeLessThanOrEqual(2);
    }
    // El count crudo de activos sí refleja los 6.
    expect(result.currentCapacityUsed).toBe(6);
  });

  it('suma tokens new/cached de runs completados en la ventana', async () => {
    const usage = {
      totalInputTokens: 100_000,
      totalOutputTokens: 20_000,
      totalCacheCreationInputTokens: 30_000,
      totalCacheReadInputTokens: 250_000,
    };
    const runs = [
      makeRun({
        status: 'completed',
        startedAt: new Date(Date.now() - 50 * MINUTE),
        completedAt: new Date(Date.now() - 10 * MINUTE),
        generatorUsage: usage,
      }),
    ];
    const result = await buildService(runs, [makeNode()]).getTimeseries();
    const totalNew = result.buckets.reduce((s, b) => s + b.tokensNew, 0);
    const totalCached = result.buckets.reduce((s, b) => s + b.tokensCached, 0);
    // new = input + output + cache_creation; cached = cache_read.
    expect(totalNew).toBe(150_000);
    expect(totalCached).toBe(250_000);
  });

  it('un run in-flight de hace 3 días cuenta en TODOS los buckets que toca', async () => {
    // Run que arrancó hace 72h y sigue corriendo → solapa las 24h enteras.
    const longRun = makeRun({
      status: 'running',
      startedAt: new Date(Date.now() - 72 * HOUR),
      completedAt: null,
    });
    const result = await buildService([longRun], [makeNode()]).getTimeseries();
    // Cada uno de los 24 buckets debe verlo ocupando 1 slot.
    for (const b of result.buckets) {
      expect(b.capacityUsed).toBe(1);
    }
  });

  it('ignora generatorUsage malformado sin crashear', async () => {
    const runs = [
      makeRun({ status: 'completed', completedAt: new Date(), generatorUsage: 'no-soy-objeto' }),
      makeRun({ status: 'completed', completedAt: new Date(), generatorUsage: { totalInputTokens: 'NaN' } }),
    ];
    const result = await buildService(runs, [makeNode()]).getTimeseries();
    const totalNew = result.buckets.reduce((s, b) => s + b.tokensNew, 0);
    expect(totalNew).toBe(0); // campos no-numéricos se ignoran
  });
});
