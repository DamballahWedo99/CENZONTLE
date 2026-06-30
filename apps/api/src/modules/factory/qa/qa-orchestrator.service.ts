import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma, type QaLensKind } from '@prisma/client';
import { AuthenticatedUser, UserRole, type QaFindingCategory } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUserCanAccessEpicPods } from '../../proyectos/epics/epic-access.util';
import { QaWorkspaceService, type PreparedWorkspace } from './qa-workspace.service';
import { QaLensRunnerService } from './qa-lens-runner.service';
import { QaVerifierService } from './qa-verifier.service';
import { QaSynthesizerService } from './qa-synthesizer.service';
import {
  QA_LENS_TIMEOUT_MS,
  QA_MAX_CONCURRENT_RUNS,
  QA_SERVE_READY_TIMEOUT_MS,
  redactSecrets,
} from './qa-config';
import type { LensExecResult, RawFinding, VerifiedFinding } from './qa-types';
import type { LensOutcome } from './qa-confidence';
import type { ServedApp } from './qa-workspace.service';

const LENS_KINDS: QaLensKind[] = ['test_suite', 'e2e', 'security_diff', 'perf_a11y'];
const ACTIVE_STATUSES: Prisma.QaRunWhereInput['status'] = {
  in: ['pending', 'running', 'synthesizing'],
};

function categoryForLens(lens: QaLensKind): QaFindingCategory {
  switch (lens) {
    case 'test_suite':
      return 'unit';
    case 'e2e':
      return 'e2e';
    case 'security_diff':
      return 'security';
    case 'perf_a11y':
      return 'performance';
  }
}

/** Solo persistimos envUrl si es loopback/RFC1918 (defensa en profundidad). */
function safeEnvUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return url;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return url;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Orquestador del pipeline de QA. spawnQaRun crea la campaña (idempotente vía
 * índice parcial); scheduleCampaign respeta el backpressure de concurrencia;
 * runCampaign hace el fan-out de los 4 lentes en paralelo contra un workspace
 * efímero compartido, verifica adversarialmente los fallos, y sintetiza el
 * QAReport. La ejecución es in-process hoy; el modelo (QaLensRun) soporta
 * distribución futura a la flota.
 */
@Injectable()
export class QaOrchestratorService {
  /** qaRunIds ejecutándose in-process ahora — backpressure. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: QaWorkspaceService,
    private readonly lensRunner: QaLensRunnerService,
    private readonly verifier: QaVerifierService,
    private readonly synthesizer: QaSynthesizerService,
    @InjectPinoLogger(QaOrchestratorService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Crea (o devuelve) una campaña QA para un batch. Para 'manual' supersede la
   * campaña activa previa. Eligible solo si el batch ya mergeó a DEV. Devuelve
   * el id de la campaña, o null si el batch no es elegible.
   */
  async spawnQaRun(input: {
    epicId: string;
    trigger: 'sweep' | 'manual';
    triggeredBy?: string;
  }): Promise<string | null> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: input.epicId },
      select: {
        id: true,
        title: true,
        enqueuedBatchId: true,
        consolidatedPrMergedAt: true,
        consolidatedMergeSha: true,
        qaStartedAt: true,
      },
    });
    if (!epic || !epic.enqueuedBatchId || !epic.consolidatedPrMergedAt) {
      return null; // no elegible: no encolado o no mergeado a DEV.
    }

    try {
      const qaRun = await this.prisma.$transaction(async (tx) => {
        // Supersede + create ATÓMICOS para 'manual': un crash entre ambos
        // dejaría la épica sin campaña activa pero con qaStartedAt set (el
        // auto-trigger la saltaría) — quedaría trabada. Dentro de la tx no.
        if (input.trigger === 'manual') {
          await tx.qaRun.updateMany({
            where: { epicId: epic.id, status: ACTIVE_STATUSES },
            data: { status: 'superseded', completedAt: new Date() },
          });
        }
        const run = await tx.qaRun.create({
          data: {
            epicId: epic.id,
            enqueuedBatchId: epic.enqueuedBatchId!,
            trigger: input.trigger,
            triggeredBy: input.triggeredBy ?? null,
            stagingSha: epic.consolidatedMergeSha,
            status: 'pending',
            lensRuns: { create: LENS_KINDS.map((lens) => ({ lens })) },
          },
        });
        await tx.epic.update({
          where: { id: epic.id },
          data: {
            qaStartedAt: epic.qaStartedAt ?? new Date(),
            // Re-run manual: limpia qaCompletedAt para que el release gate
            // bloquee hasta que la NUEVA campaña sintetice — sin esto, un
            // TechLead podría aprobar con el QAReport viejo mientras corre el
            // re-run (qa-reviewer BUG-01).
            ...(input.trigger === 'manual' ? { qaCompletedAt: null } : {}),
          },
        });
        await tx.changelogEntry.create({
          data: {
            entityType: 'epic',
            entityId: epic.id,
            entityTitle: epic.title,
            action: 'qa_started',
            newValue: `trigger=${input.trigger}`,
            ...(input.triggeredBy ? { changedById: input.triggeredBy } : {}),
          },
        });
        return run;
      });
      void this.scheduleCampaign(qaRun.id);
      return qaRun.id;
    } catch (err) {
      // Carrera: el índice parcial rechazó una 2ª campaña activa. Devuelve la
      // existente (idempotente, mismo patrón que AgentRunRaceError → null/200).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.qaRun.findFirst({
          where: { epicId: epic.id, status: ACTIVE_STATUSES },
          select: { id: true },
        });
        return existing?.id ?? null;
      }
      throw err;
    }
  }

  /**
   * Re-corre QA para un batch desde la UI (manual). Valida pod access + rol
   * (TechLead/AltaGerencia) antes de superseder la campaña previa y arrancar
   * una nueva. Devuelve el id de la nueva campaña, o null si no es elegible.
   */
  async rerunForBatch(batchId: string, user: AuthenticatedUser): Promise<string | null> {
    const epic = await this.prisma.epic.findFirst({
      where: { enqueuedBatchId: batchId },
      include: { pods: { select: { podId: true } } },
    });
    if (!epic) {
      throw new NotFoundException(`Batch ${batchId} no encontrado`);
    }
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );
    if (user.role !== UserRole.TechLead && user.role !== UserRole.AltaGerencia) {
      throw new ForbiddenException(
        `Solo Tech Lead o Alta Gerencia puede re-correr QA. Tu rol es ${user.role}.`,
      );
    }
    return this.spawnQaRun({ epicId: epic.id, trigger: 'manual', triggeredBy: user.sub });
  }

  /** Arranca campañas pendientes hasta el cap de concurrencia (lo llama el sweep). */
  async drainPending(): Promise<void> {
    if (this.running.size >= QA_MAX_CONCURRENT_RUNS) return;
    const freeSlots = QA_MAX_CONCURRENT_RUNS - this.running.size;
    if (freeSlots <= 0) return;
    const pending = await this.prisma.qaRun.findMany({
      where: { status: 'pending' },
      orderBy: { startedAt: 'asc' },
      take: freeSlots,
      select: { id: true },
    });
    for (const p of pending) {
      if (this.running.size >= QA_MAX_CONCURRENT_RUNS) break;
      await this.scheduleCampaign(p.id);
    }
  }

  /** Ejecuta una campaña si hay capacidad; si no, la deja pending (el sweep reintenta). */
  private async scheduleCampaign(qaRunId: string): Promise<void> {
    if (this.running.size >= QA_MAX_CONCURRENT_RUNS) return;
    // CAS pending → running: solo un caller gana.
    const claimed = await this.prisma.qaRun.updateMany({
      where: { id: qaRunId, status: 'pending' },
      data: { status: 'running' },
    });
    if (claimed.count === 0) return;
    this.running.add(qaRunId);
    void this.runCampaign(qaRunId)
      .catch((err) => {
        this.logger.error(
          { event: 'qa.campaign.uncaught', qaRunId, err: (err as Error).message },
          `[qa:${qaRunId}] campaña abortó con error: ${(err as Error).message}`,
        );
        return this.prisma.qaRun
          .update({ where: { id: qaRunId }, data: { status: 'failed', completedAt: new Date() } })
          .catch(() => undefined);
      })
      .finally(() => this.running.delete(qaRunId));
  }

  private async runCampaign(qaRunId: string): Promise<void> {
    const qaRun = await this.prisma.qaRun.findUnique({
      where: { id: qaRunId },
      include: {
        lensRuns: true,
        epic: {
          select: { id: true, title: true, enqueuedBatchId: true, consolidatedMergeSha: true },
        },
      },
    });
    if (!qaRun || !qaRun.epic.enqueuedBatchId) {
      this.logger.warn({ event: 'qa.campaign.missing', qaRunId }, `[qa:${qaRunId}] campaña sin epic válido`);
      return;
    }

    const devBranch = await this.resolveDevBranch();

    // 1. Workspace efímero compartido (clone + install una sola vez).
    let ws: PreparedWorkspace;
    try {
      ws = await this.workspace.prepare({
        devBranch,
        stagingSha: qaRun.stagingSha,
        runId: qaRunId,
      });
    } catch (err) {
      this.logger.error(
        { event: 'qa.campaign.prepare_failed', qaRunId, err: (err as Error).message },
        `[qa:${qaRunId}] no se pudo preparar el workspace: ${(err as Error).message}`,
      );
      await this.prisma.qaLensRun.updateMany({
        where: { qaRunId },
        data: { status: 'failed', errorMessage: 'workspace prepare falló', completedAt: new Date() },
      });
      await this.prisma.qaRun.update({
        where: { id: qaRunId },
        data: { status: 'failed', completedAt: new Date() },
      });
      return;
    }

    let served: ServedApp | null = null;
    try {
      // Server efímero COMPARTIDO por los lentes que prueban contra la URL viva
      // (e2e + perf_a11y) — levantado UNA sola vez. Correr dos dev servers en el
      // mismo workdir corrompe el cache (vite/.next) y produce fallos falsos
      // (qa-reviewer BUG-02). Null si no instaló o no levantó → esos lentes
      // reportan el fallo de boot.
      served = ws.installOk ? await this.workspace.serve(ws, qaRunId) : null;

      // 2. Fan-out: los 4 lentes en paralelo contra el workspace compartido.
      const lensRows = qaRun.lensRuns;
      const lensExecs = await Promise.all(
        lensRows.map((row) => this.executeLens(row.id, row.lens, ws, served, qaRunId)),
      );

      // 3. Verificación adversarial de los fallos de cada lente, EN PARALELO
      //    (cada lente es independiente — serializar multiplicaba el wall-clock
      //    de la fase de verify por ~4×; espeja el Promise.all del fan-out).
      const perLens = await Promise.all(
        lensExecs.map(async (ex) => {
          const verified = await this.verifier.verify(ex.lensRunId, ex.result.findings, qaRunId);
          // Persiste los findings ya verificados (con claimedReal/votos).
          await this.prisma.qaLensRun.update({
            where: { id: ex.lensRunId },
            data: { reportedFindings: verified as unknown as Prisma.InputJsonValue },
          });
          const outcome: LensOutcome = {
            lens: ex.lens,
            status: ex.result.status === 'completed' ? 'completed' : 'failed',
            result: ex.result,
          };
          return { verified, outcome };
        }),
      );
      const verifiedAll: VerifiedFinding[] = perLens.flatMap((p) => p.verified);
      const outcomes: LensOutcome[] = perLens.map((p) => p.outcome);

      // 4. Síntesis del QAReport (marca qaCompletedAt + changelog).
      await this.prisma.qaRun.update({ where: { id: qaRunId }, data: { status: 'synthesizing' } });
      await this.synthesizer.synthesize(
        {
          qaRunId,
          batchId: qaRun.epic.enqueuedBatchId,
          epicId: qaRun.epic.id,
          epicTitle: qaRun.epic.title,
          lenses: outcomes,
          verified: verifiedAll,
        },
        new Date().toISOString(),
      );
    } finally {
      // 5. Teardown garantizado: para el server compartido y borra el workdir.
      served?.stop();
      await this.workspace.teardown(ws.workdir);
    }
  }

  /** Ejecuta un lente con timeout y persiste el resultado en su fila. */
  private async executeLens(
    lensRunId: string,
    lens: QaLensKind,
    ws: PreparedWorkspace,
    served: ServedApp | null,
    qaRunId: string,
  ): Promise<{ lensRunId: string; lens: QaLensKind; result: LensExecResult }> {
    await this.prisma.qaLensRun.update({
      where: { id: lensRunId },
      data: { status: 'running', startedAt: new Date(), lastProgressAt: new Date() },
    });

    // Defensa: un lente que RECHAZA (p.ej. runCommand del e2e que cuelga o un
    // spawn ENOENT) NO debe abortar toda la campaña vía el Promise.all del
    // fan-out, ni dejar la fila colgada en 'running'. Lo degradamos a un
    // LensExecResult 'failed' y la campaña continúa con los demás lentes
    // (qa-reviewer: bug HIGH de campaña abortada).
    let result: LensExecResult;
    try {
      result = await this.withTimeout(lens, this.dispatchLens(lens, ws, served, qaRunId));
    } catch (err) {
      this.logger.warn(
        { event: 'qa.lens.threw', qaRunId, lens, err: (err as Error).message },
        `[qa:${qaRunId}] lente ${lens} lanzó excepción — se marca failed: ${(err as Error).message}`,
      );
      result = {
        status: 'failed',
        suite: null,
        findings: [
          {
            id: `${lens}-error`,
            category: categoryForLens(lens),
            title: `El lente ${lens} lanzó una excepción`,
            evidence: (err as Error).message.slice(0, 1000),
            severity: 'medium',
          },
        ],
        envUrl: null,
        errorMessage: (err as Error).message.slice(0, 500),
        usage: null,
      };
    }

    // SECURITY: redacta secretos de la evidencia ANTES de persistirla y de
    // pasarla al verificador. La salida de tests / body del app / líneas del
    // diff puede contener secretos del código generado (security-reviewer #2/#3).
    result.findings = result.findings.map((f) => ({ ...f, evidence: redactSecrets(f.evidence) }));

    await this.prisma.qaLensRun.update({
      where: { id: lensRunId },
      data: {
        status: result.status === 'completed' ? 'completed' : 'failed',
        rawResults: result.suite ? (result.suite as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        reportedFindings: result.findings as unknown as Prisma.InputJsonValue,
        envUrl: safeEnvUrl(result.envUrl),
        lensUsage: result.usage ? (result.usage as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        errorMessage: result.errorMessage ? redactSecrets(result.errorMessage) : null,
        completedAt: new Date(),
        lastProgressAt: new Date(),
      },
    });
    return { lensRunId, lens, result };
  }

  private dispatchLens(
    lens: QaLensKind,
    ws: PreparedWorkspace,
    served: ServedApp | null,
    runId: string,
  ): Promise<LensExecResult> {
    switch (lens) {
      case 'test_suite':
        return this.lensRunner.runTestSuite(ws, runId);
      case 'e2e':
        return this.lensRunner.runE2e(ws, served);
      case 'security_diff':
        return this.lensRunner.runSecurityDiff(ws, runId);
      case 'perf_a11y':
        return this.lensRunner.runPerfA11y(ws, served);
    }
  }

  private withTimeout(lens: QaLensKind, exec: Promise<LensExecResult>): Promise<LensExecResult> {
    const timeoutFinding: RawFinding = {
      id: `${lens}-timeout`,
      category: categoryForLens(lens),
      title: `El lente ${lens} excedió el timeout`,
      evidence: `> ${QA_LENS_TIMEOUT_MS}ms`,
      severity: 'medium',
    };
    const timeout = new Promise<LensExecResult>((resolve) => {
      const t = setTimeout(
        () =>
          resolve({
            status: 'failed',
            suite: null,
            findings: [timeoutFinding],
            envUrl: null,
            errorMessage: 'lens timeout',
            usage: null,
          }),
        // Headroom para el presupuesto secuencial del lente (serve + http +
        // runCommand) por encima del timeout interno de cada paso.
        QA_LENS_TIMEOUT_MS + QA_SERVE_READY_TIMEOUT_MS + 30_000,
      );
      t.unref();
    });
    return Promise.race([exec, timeout]);
  }

  private async resolveDevBranch(): Promise<string> {
    // Lectura directa del singleton (PK 'global') para evitar el ciclo con
    // BranchStrategyModule — mismo patrón que agent-run.service.ts.
    const cfg = await this.prisma.branchStrategyConfig.findUnique({
      where: { id: 'global' },
      select: { devBranch: true },
    });
    return cfg?.devBranch ?? 'dev';
  }
}
