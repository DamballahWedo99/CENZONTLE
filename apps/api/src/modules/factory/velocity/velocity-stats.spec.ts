import {
  buildCalibrationTable,
  CALIBRATION_FACTOR,
  classifyRatio,
  computeEffortScore,
  computeMedians,
  computeStoryEffortInputs,
  EFFORT_WEIGHTS,
  median,
  weekStartIso,
  type VelocityMedians,
  type VelocityRunInput,
  type VelocityScoredStory,
} from './velocity-stats';

describe('velocity-stats', () => {
  // ─── computeStoryEffortInputs ─────────────────────────────────────────

  describe('computeStoryEffortInputs', () => {
    const run = (over: Partial<VelocityRunInput> = {}): VelocityRunInput => ({
      generatorUsage: { totalCostUsd: 1 },
      dodVerification: null,
      plannerUsage: null,
      attempts: 1,
      status: 'completed',
      startedAt: new Date('2026-06-10T09:00:00Z'),
      completedAt: new Date('2026-06-10T09:30:00Z'),
      ...over,
    });

    it('sin runs → todo en cero y latestRunCompletedAt null', () => {
      expect(computeStoryEffortInputs([])).toEqual({
        costUsd: 0,
        durationMs: 0,
        totalAttempts: 0,
        runsCount: 0,
        latestRunCompletedAt: null,
      });
    });

    it('suma TODOS los runs incluidos failed — también fueron gasto real', () => {
      const inputs = computeStoryEffortInputs([
        run(),
        run({ status: 'failed', generatorUsage: { totalCostUsd: 0.5 }, attempts: 2 }),
      ]);

      expect(inputs.costUsd).toBe(1.5);
      expect(inputs.durationMs).toBe(2 * 30 * 60 * 1000);
      expect(inputs.totalAttempts).toBe(3);
      expect(inputs.runsCount).toBe(2);
    });

    it('durationMs omite runs sin ambos timestamps; attempts null legacy = 1', () => {
      const inputs = computeStoryEffortInputs([
        run({ completedAt: null, attempts: null, status: 'running' }),
      ]);

      expect(inputs.durationMs).toBe(0);
      expect(inputs.totalAttempts).toBe(1);
      expect(inputs.latestRunCompletedAt).toBeNull();
    });

    it('latestRunCompletedAt solo considera runs completed (no failed)', () => {
      const inputs = computeStoryEffortInputs([
        run({ status: 'failed', completedAt: new Date('2026-06-11T10:00:00Z') }),
        run({ completedAt: new Date('2026-06-10T09:30:00Z') }),
      ]);

      expect(inputs.latestRunCompletedAt).toEqual(new Date('2026-06-10T09:30:00Z'));
    });
  });

  // ─── median ───────────────────────────────────────────────────────────

  describe('median', () => {
    it('vacío → 0', () => {
      expect(median([])).toBe(0);
    });

    it('impar → elemento central (sin mutar el input)', () => {
      const values = [5, 1, 3];
      expect(median(values)).toBe(3);
      expect(values).toEqual([5, 1, 3]);
    });

    it('par → promedio de los dos centrales', () => {
      expect(median([4, 1, 3, 2])).toBe(2.5);
    });
  });

  // ─── computeEffortScore ───────────────────────────────────────────────

  describe('computeEffortScore', () => {
    const medians: VelocityMedians = {
      costUsd: 2,
      durationMs: 1000,
      attempts: 2,
      storyPoints: 3,
    };

    it('historia idéntica a la mediana → score 1.0 exacto', () => {
      const score = computeEffortScore(
        { costUsd: 2, durationMs: 1000, totalAttempts: 2 },
        medians,
      );
      expect(score).toBeCloseTo(1.0, 10);
    });

    it('pondera cada componente por su peso', () => {
      // cost 2x, duration 1x, attempts 1x → 0.5*2 + 0.3*1 + 0.2*1 = 1.5
      const score = computeEffortScore(
        { costUsd: 4, durationMs: 1000, totalAttempts: 2 },
        medians,
      );
      expect(score).toBeCloseTo(
        EFFORT_WEIGHTS.cost * 2 + EFFORT_WEIGHTS.duration + EFFORT_WEIGHTS.attempts,
        10,
      );
    });

    it('mediana 0 → omite el componente y RE-NORMALIZA los pesos a 1', () => {
      // Sin duración poblacional: pesos efectivos cost=0.5/0.7, attempts=0.2/0.7.
      const score = computeEffortScore(
        { costUsd: 4, durationMs: 99999, totalAttempts: 2 },
        { ...medians, durationMs: 0 },
      );
      expect(score).toBeCloseTo((0.5 / 0.7) * 2 + (0.2 / 0.7) * 1, 10);
    });

    it('todas las medianas 0 → null (nada contra qué comparar)', () => {
      expect(
        computeEffortScore(
          { costUsd: 4, durationMs: 100, totalAttempts: 2 },
          { costUsd: 0, durationMs: 0, attempts: 0, storyPoints: 3 },
        ),
      ).toBeNull();
    });

    it('historia sin costo medible → null aunque haya medianas', () => {
      expect(
        computeEffortScore({ costUsd: 0, durationMs: 100, totalAttempts: 2 }, medians),
      ).toBeNull();
    });
  });

  // ─── classifyRatio ────────────────────────────────────────────────────

  describe('classifyRatio', () => {
    it('null → no-data', () => {
      expect(classifyRatio(null)).toBe('no-data');
    });

    it('bordes exactos del umbral simétrico son calibrated (inclusivo)', () => {
      expect(classifyRatio(1 / CALIBRATION_FACTOR)).toBe('calibrated');
      expect(classifyRatio(CALIBRATION_FACTOR)).toBe('calibrated');
      expect(classifyRatio(1)).toBe('calibrated');
    });

    it('justo fuera de los bordes → over / under', () => {
      expect(classifyRatio(1 / CALIBRATION_FACTOR - 0.001)).toBe('over');
      expect(classifyRatio(CALIBRATION_FACTOR + 0.001)).toBe('under');
      expect(classifyRatio(0.1)).toBe('over');
      expect(classifyRatio(3.2)).toBe('under');
    });
  });

  // ─── weekStartIso ─────────────────────────────────────────────────────

  describe('weekStartIso', () => {
    // Semana de referencia: 2026-06-08 es lunes, 2026-06-14 es domingo.
    it('lunes 00:00 UTC → la misma fecha', () => {
      expect(weekStartIso(new Date('2026-06-08T00:00:00Z'))).toBe('2026-06-08');
    });

    it('domingo 23:59 UTC → el lunes ANTERIOR (la semana no cruza aún)', () => {
      expect(weekStartIso(new Date('2026-06-14T23:59:59Z'))).toBe('2026-06-08');
    });

    it('lunes siguiente 00:00 UTC → nueva semana', () => {
      expect(weekStartIso(new Date('2026-06-15T00:00:00Z'))).toBe('2026-06-15');
    });

    it('mitad de semana cruzando mes → lunes del mes anterior', () => {
      // 2026-07-01 es miércoles; su lunes es 2026-06-29.
      expect(weekStartIso(new Date('2026-07-01T12:00:00Z'))).toBe('2026-06-29');
    });
  });

  // ─── computeMedians + buildCalibrationTable ───────────────────────────

  describe('buildCalibrationTable', () => {
    const story = (
      storyPoints: number,
      effortScore: number,
      over: Partial<VelocityScoredStory> = {},
    ): VelocityScoredStory => ({
      storyPoints,
      effortScore,
      costUsd: 1,
      durationMs: 60_000,
      totalAttempts: 1,
      ...over,
    });

    it('solo emite buckets con muestras, en orden Fibonacci ASC', () => {
      const medians: VelocityMedians = { costUsd: 1, durationMs: 60_000, attempts: 1, storyPoints: 3 };
      const rows = buildCalibrationTable(
        [story(3, 1), story(3, 1.4), story(8, 4)],
        medians,
      );

      expect(rows.map((r) => r.storyPoints)).toEqual([3, 8]);
      expect(rows[0].samples).toBe(2);
      expect(rows[1].samples).toBe(1);
    });

    it('promedia componentes y calcula ratioVsExpected vs sp/medianSP', () => {
      const medians: VelocityMedians = { costUsd: 1, durationMs: 60_000, attempts: 1, storyPoints: 3 };
      const rows = buildCalibrationTable(
        [
          story(3, 0.8, { costUsd: 2, durationMs: 120_000, totalAttempts: 1 }),
          story(3, 1.2, { costUsd: 4, durationMs: 240_000, totalAttempts: 3 }),
        ],
        medians,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        storyPoints: 3,
        samples: 2,
        avgCostUsd: 3,
        avgDurationMs: 180_000,
        avgAttempts: 2,
        avgEffortScore: 1,
      });
      // expected del bucket 3 SP = 3/3 = 1 → ratio = avgEffortScore/1.
      expect(rows[0].ratioVsExpected).toBeCloseTo(1, 10);
    });

    it('medianSP 0 → ratioVsExpected null (no existe esfuerzo esperado)', () => {
      const medians: VelocityMedians = { costUsd: 1, durationMs: 60_000, attempts: 1, storyPoints: 0 };
      const rows = buildCalibrationTable([story(5, 2)], medians);

      expect(rows[0].ratioVsExpected).toBeNull();
    });

    it('storyPoints fuera de los buckets Fibonacci se ignoran', () => {
      const medians: VelocityMedians = { costUsd: 1, durationMs: 60_000, attempts: 1, storyPoints: 3 };
      const rows = buildCalibrationTable([story(4, 1), story(0, 1)], medians);

      expect(rows).toEqual([]);
    });

    it('población vacía → tabla vacía', () => {
      const medians: VelocityMedians = { costUsd: 1, durationMs: 1, attempts: 1, storyPoints: 1 };
      expect(buildCalibrationTable([], medians)).toEqual([]);
    });
  });

  describe('computeMedians', () => {
    it('medianas por componente de la población', () => {
      expect(
        computeMedians([
          { costUsd: 1, durationMs: 100, totalAttempts: 1, storyPoints: 1 },
          { costUsd: 3, durationMs: 300, totalAttempts: 2, storyPoints: 3 },
          { costUsd: 10, durationMs: 200, totalAttempts: 5, storyPoints: 8 },
        ]),
      ).toEqual({ costUsd: 3, durationMs: 200, attempts: 2, storyPoints: 3 });
    });

    it('NO filtra storyPoints=0 — excluir SP sin estimar es responsabilidad del caller', () => {
      // Población mayoritariamente sin estimar → medianSP 0. computeMedians
      // es un puro que refleja lo que recibe; los services (ForgeVelocity y
      // VelocityCalibration) deben filtrar SP=0 ANTES de llamar aquí.
      expect(
        computeMedians([
          { costUsd: 1, durationMs: 100, totalAttempts: 1, storyPoints: 0 },
          { costUsd: 3, durationMs: 300, totalAttempts: 2, storyPoints: 0 },
          { costUsd: 10, durationMs: 200, totalAttempts: 5, storyPoints: 5 },
        ]).storyPoints,
      ).toBe(0);
    });
  });
});
