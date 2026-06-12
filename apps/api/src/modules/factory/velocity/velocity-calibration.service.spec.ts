import { VelocityCalibrationService } from './velocity-calibration.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PinoLogger } from 'nestjs-pino';

describe('VelocityCalibrationService.getCalibrationPromptBlock', () => {
  const epicFindMany = jest.fn();
  const loggerWarn = jest.fn();

  const makeService = () =>
    new VelocityCalibrationService(
      { epic: { findMany: epicFindMany } } as unknown as PrismaService,
      { info: jest.fn(), warn: loggerWarn } as unknown as PinoLogger,
    );

  /** Run completed con costo solo en generator — $1 y 30 min por default. */
  const fullRun = (over: Record<string, unknown> = {}) => ({
    generatorUsage: { totalCostUsd: 1 },
    dodVerification: null,
    plannerUsage: null,
    attempts: 1,
    status: 'completed',
    startedAt: new Date('2026-06-10T09:00:00Z'),
    completedAt: new Date('2026-06-10T09:30:00Z'),
    ...over,
  });

  const storyFixture = (over: Record<string, unknown> = {}) => ({
    status: 'done',
    storyPoints: 3,
    agentRuns: [fullRun()],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Degradación a null sin evidencia ───────────────────────────────────

  it('sin epics encolados → null (tabla vacía, no se inyecta nada)', async () => {
    epicFindMany.mockResolvedValue([]);

    await expect(makeService().getCalibrationPromptBlock()).resolves.toBeNull();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('población < MIN_SAMPLES → null (calibrar contra 1-2 muestras es ruido)', async () => {
    epicFindMany.mockResolvedValue([
      { stories: [storyFixture(), storyFixture()] },
    ]);

    await expect(makeService().getCalibrationPromptBlock()).resolves.toBeNull();
  });

  it('error de Prisma → null + logger.warn, JAMÁS lanza (no tumba la generación)', async () => {
    epicFindMany.mockRejectedValue(new Error('connection refused'));

    await expect(makeService().getCalibrationPromptBlock()).resolves.toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('connection refused'),
    );
  });

  // ─── Bloque con evidencia suficiente ────────────────────────────────────

  it('población suficiente → bloque con buckets, muestras y veredictos', async () => {
    // 3 historias de 3 SP en la mediana exacta (calibradas) + 2 historias
    // de 2 SP a 4x el costo mediano: effortScore 2.5 vs expected 2/3 →
    // ratio 3.75 > 1.5 → bucket sub-estimado.
    epicFindMany.mockResolvedValue([
      {
        stories: [
          storyFixture(),
          storyFixture(),
          storyFixture(),
          storyFixture({
            storyPoints: 2,
            agentRuns: [fullRun({ generatorUsage: { totalCostUsd: 4 } })],
          }),
          storyFixture({
            storyPoints: 2,
            agentRuns: [fullRun({ generatorUsage: { totalCostUsd: 4 } })],
          }),
        ],
      },
    ]);

    const block = await makeService().getCalibrationPromptBlock();

    expect(block).not.toBeNull();
    expect(block).toContain('<calibracion_historica>');
    expect(block).toContain('</calibracion_historica>');
    expect(block).toContain('5 historias');

    const lines = block!.split('\n');
    const bucket2 = lines.find((l) => l.startsWith('- 2 SP'));
    const bucket3 = lines.find((l) => l.startsWith('- 3 SP'));

    expect(bucket2).toContain('(2 muestras)');
    expect(bucket2).toContain('costo prom $4.00');
    expect(bucket2).toContain('esfuerzo 3.8x del presupuestado');
    expect(bucket2).toContain('SUB-estimarse');

    expect(bucket3).toContain('(3 muestras)');
    expect(bucket3).toContain('costo prom $1.00');
    expect(bucket3).toContain('calibradas');
  });

  // ─── Exclusión de SP=0 (default Prisma sin estimar) ─────────────────────

  it('historias done con storyPoints=0 NO entran a la población → null si solo hay esas', async () => {
    // 5 historias done con costo pero SP=0 (default sin estimar): sin el
    // filtro contaminarían las medianas (medianSP 0). Con el filtro la
    // población queda vacía → no hay bloque.
    epicFindMany.mockResolvedValue([
      {
        stories: Array.from({ length: 5 }, () => storyFixture({ storyPoints: 0 })),
      },
    ]);

    await expect(makeService().getCalibrationPromptBlock()).resolves.toBeNull();
  });

  it('historias SP=0 mezcladas con estimadas → se excluyen de muestras y medianas', async () => {
    epicFindMany.mockResolvedValue([
      {
        stories: [
          storyFixture(),
          storyFixture(),
          storyFixture(),
          // Si estas dos entraran, medianSP caería de 3 y los ratios se
          // distorsionarían — el bloque debe contarlas fuera.
          storyFixture({ storyPoints: 0 }),
          storyFixture({ storyPoints: 0 }),
        ],
      },
    ]);

    const block = await makeService().getCalibrationPromptBlock();

    expect(block).toContain('3 historias');
    expect(block).not.toContain('- 0 SP');
    // Con medianSP intacto (3), las historias en la mediana quedan calibradas.
    expect(block).toContain('- 3 SP (3 muestras)');
    expect(block).toContain('calibradas');
  });
});
