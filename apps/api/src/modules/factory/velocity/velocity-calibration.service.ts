import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { VelocityCalibrationRow } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AGENT_RUN_EFFORT_SELECT,
  buildCalibrationTable,
  classifyRatio,
  computeEffortScore,
  computeMedians,
  computeStoryEffortInputs,
  MAX_BATCHES,
  MIN_SAMPLES,
  type VelocityScoredStory,
} from './velocity-stats';

// ════════════════════════════════════════════════════════════════════════
// Velocity calibration — el loop de aprendizaje de estimación del sistema
// ════════════════════════════════════════════════════════════════════════
//
// Produce la tabla de calibración por bucket Fibonacci y la formatea como
// bloque <calibracion_historica> para inyectar al prompt del PO agent que
// estima storyPoints: si históricamente las historias de 8 SP cuestan 2x
// lo presupuestado, el agente debe subir un escalón o partir la historia.
//
// La query es ORG-WIDE (sin pod gating) por diseño: corre server-side
// dentro de la generación de historias, no expone datos a ningún usuario
// final, y la evidencia de calibración mejora cuantas más muestras cruce.
// El endpoint GET /factory/velocity SÍ respeta pods — usa los mismos
// puros de velocity-stats con su propia población filtrada.
//
// NOTA: el generador de épicas no estima SP hoy; si gana estimación,
// inyectar este mismo bloque (getCalibrationPromptBlock) en su prompt.

@Injectable()
export class VelocityCalibrationService {
  // Solo PrismaService + logger — sin otras deps para que el módulo sea
  // importable desde ProyectosModule sin arrastrar FactoryModule (ciclo).
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(VelocityCalibrationService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Tabla de calibración org-wide sobre la misma ventana que el dashboard
   * (últimos MAX_BATCHES batches encolados). Población: historias done con
   * costo > 0. Vacía si la población no alcanza MIN_SAMPLES — calibrar al
   * PO agent contra 1-2 muestras sería peor que no calibrarlo.
   */
  async getCalibrationTable(): Promise<VelocityCalibrationRow[]> {
    const epics = await this.prisma.epic.findMany({
      where: { enqueuedBatchId: { not: null } },
      orderBy: { enqueuedAt: 'desc' },
      take: MAX_BATCHES,
      select: {
        stories: {
          select: {
            status: true,
            storyPoints: true,
            agentRuns: AGENT_RUN_EFFORT_SELECT,
          },
        },
      },
    });

    // Población de referencia: done con costo medible y storyPoints > 0
    // (idéntico criterio que ForgeVelocityService — ambos delegan en los
    // puros de velocity-stats para que dashboard y prompt nunca diverjan).
    // SP=0 es el default de Prisma para historias sin estimar, no una
    // estimación real: incluirlas contaminaría las medianas.
    const population = epics
      .flatMap((epic) => epic.stories)
      .filter((story) => story.status === 'done' && story.storyPoints > 0)
      .map((story) => ({
        storyPoints: story.storyPoints,
        inputs: computeStoryEffortInputs(story.agentRuns),
      }))
      .filter((s) => s.inputs.costUsd > 0);

    if (population.length < MIN_SAMPLES) return [];

    const medians = computeMedians(
      population.map((s) => ({
        costUsd: s.inputs.costUsd,
        durationMs: s.inputs.durationMs,
        totalAttempts: s.inputs.totalAttempts,
        storyPoints: s.storyPoints,
      })),
    );

    const scored: VelocityScoredStory[] = [];
    for (const s of population) {
      const effortScore = computeEffortScore(s.inputs, medians);
      if (effortScore === null) continue;
      scored.push({
        costUsd: s.inputs.costUsd,
        durationMs: s.inputs.durationMs,
        totalAttempts: s.inputs.totalAttempts,
        storyPoints: s.storyPoints,
        effortScore,
      });
    }

    return buildCalibrationTable(scored, medians);
  }

  /**
   * Bloque <calibracion_historica> listo para concatenar al prompt del PO
   * agent. Null si no hay evidencia suficiente (tabla vacía).
   *
   * Try/catch alrededor de TODO incluida la query: la calibración es un
   * enriquecimiento opcional del prompt y JAMÁS debe tumbar la generación
   * de historias — ante cualquier fallo se loggea warn y se degrada a null
   * (el agente estima sin evidencia histórica, como antes de esta feature).
   */
  async getCalibrationPromptBlock(): Promise<string | null> {
    try {
      const table = await this.getCalibrationTable();
      if (table.length === 0) return null;

      const totalSamples = table.reduce((sum, row) => sum + row.samples, 0);
      const lines = table.map((row) => {
        const minutes = Math.round(row.avgDurationMs / 60_000);
        const base =
          `- ${row.storyPoints} SP (${row.samples} muestras): ` +
          `costo prom $${row.avgCostUsd.toFixed(2)}, duración prom ${minutes} min, ` +
          `${row.avgAttempts.toFixed(1)} intentos DoD`;

        // El veredicto reusa el MISMO umbral que el dashboard
        // (classifyRatio): si la UI pinta el bucket como sub-estimado, el
        // prompt dice exactamente lo mismo. classifyRatio solo devuelve
        // under/over con ratio no-null, pero TS no puede inferirlo a través
        // del switch — el ?? '?' evita la non-null assertion sin cambiar
        // el comportamiento (esas ramas nunca ven null en runtime).
        const ratioLabel = row.ratioVsExpected?.toFixed(1) ?? '?';
        switch (classifyRatio(row.ratioVsExpected)) {
          case 'under':
            return (
              `${base} — esfuerzo ${ratioLabel}x del presupuestado ` +
              `(tienden a SUB-estimarse)`
            );
          case 'over':
            return (
              `${base} — esfuerzo ${ratioLabel}x del presupuestado ` +
              `(tienden a SOBRE-estimarse)`
            );
          case 'calibrated':
            return `${base} — calibradas`;
          default:
            // 'no-data' (ratioVsExpected null: medianSP 0) — sin veredicto.
            return base;
        }
      });

      return [
        '<calibracion_historica>',
        `Datos reales de ejecución de historias completadas por agentes (ventana: últimos ${MAX_BATCHES} batches, ${totalSamples} historias):`,
        ...lines,
        'Usa esta evidencia al asignar storyPoints: si el alcance se parece a un bucket que históricamente sale sub-estimado, sube un escalón Fibonacci (o divide la historia).',
        '</calibracion_historica>',
      ].join('\n');
    } catch (error) {
      this.logger.warn(
        `[velocity-calibration] fallo al construir el bloque de calibración, ` +
          `se omite del prompt: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
