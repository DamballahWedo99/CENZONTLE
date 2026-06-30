import { Injectable } from '@nestjs/common';
import {
  AuthenticatedUser,
  TestCategory,
  TestResult,
  UserRole,
  type ForgeTestsResponse,
  type QaBatchTests,
  type QaFinding,
  type QaLensKindValue,
  type QaLensSummary,
  type QaRunStatusValue,
  type QAReport,
  type QaVerdictValue,
  type TestSuite,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveQaStage } from './qa-stage';

const MAX_BATCHES = 20;

function lensToCategory(lens: QaLensKindValue): TestCategory {
  switch (lens) {
    case 'e2e':
      return TestCategory.E2E;
    case 'test_suite':
      return TestCategory.Integration;
    case 'perf_a11y':
      return TestCategory.Performance;
    case 'security_diff':
      // security_diff NUNCA produce un TestSuite (su rawResults es siempre
      // null — solo reporta findings), así que suiteFromRaw nunca invoca este
      // caso en runtime. Fallback inalcanzable; TestCategory no tiene Security.
      return TestCategory.Unit;
  }
}

/** Construye un TestSuite público desde el rawResults (LensTestSuiteResult). */
function suiteFromRaw(lens: QaLensKindValue, raw: unknown): TestSuite | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (k: string): number => (typeof r[k] === 'number' ? (r[k] as number) : 0);
  const total = num('total');
  const failed = num('failed');
  const result: TestResult =
    failed > 0 ? TestResult.Failed : total > 0 ? TestResult.Passed : TestResult.Skipped;
  return {
    id: `qa-suite-${lens}`,
    category: lensToCategory(lens),
    storyId: null,
    name: lens,
    result,
    total,
    passed: num('passed'),
    failed,
    skipped: num('skipped'),
    duration: num('durationMs'),
    coverage: typeof r.coverage === 'number' ? r.coverage : null,
    startedAt: null,
    completedAt: null,
  };
}

function mapFindings(reported: unknown): QaFinding[] {
  if (!Array.isArray(reported)) return [];
  return reported
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => {
      const votes = x.votes as Record<string, unknown> | undefined;
      return {
        id: typeof x.id === 'string' ? x.id : '',
        category: (typeof x.category === 'string' ? x.category : 'functional') as QaFinding['category'],
        title: typeof x.title === 'string' ? x.title : '',
        evidence: typeof x.evidence === 'string' ? x.evidence : '',
        severity: (typeof x.severity === 'string' ? x.severity : 'medium') as QaFinding['severity'],
        // claimedReal solo existe tras la verificación; antes, false.
        claimedReal: x.claimedReal === true,
        verification:
          votes && typeof votes === 'object'
            ? {
                upheld: typeof votes.upheld === 'number' ? votes.upheld : 0,
                refuted: typeof votes.refuted === 'number' ? votes.refuted : 0,
                uncertain: typeof votes.uncertain === 'number' ? votes.uncertain : 0,
              }
            : null,
      };
    });
}

/**
 * Read model de `GET /factory/tests`. Deriva 100% de Prisma (qa_runs +
 * qa_lens_runs) sin tabla de eventos nueva — mismo patrón que /factory/logs.
 * Pod-gated para no-AltaGerencia. Ventana: últimos 20 batches mergeados a DEV.
 */
@Injectable()
export class QaReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listTests(user: AuthenticatedUser): Promise<ForgeTestsResponse> {
    const where: Record<string, unknown> = {
      enqueuedBatchId: { not: null },
      consolidatedPrMergedAt: { not: null },
    };
    if (user.role !== UserRole.AltaGerencia) {
      const podIds = user.podIds ?? [];
      if (podIds.length === 0) {
        return { generatedAt: new Date().toISOString(), batches: [], status: 'insufficient_data' };
      }
      where.pods = { some: { podId: { in: podIds } } };
    }

    const epics = await this.prisma.epic.findMany({
      where,
      orderBy: { consolidatedPrMergedAt: 'desc' },
      take: MAX_BATCHES,
      select: {
        id: true,
        title: true,
        priority: true,
        enqueuedBatchId: true,
        consolidatedPrMergedAt: true,
        qaStartedAt: true,
        qaCompletedAt: true,
        releaseApprovedAt: true,
        releaseApprovedByName: true,
        qaRuns: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { lensRuns: { orderBy: { lens: 'asc' } } },
        },
      },
    });

    const batches: QaBatchTests[] = epics.map((e) => {
      const run = e.qaRuns[0] ?? null;
      const stage =
        deriveQaStage({
          consolidatedPrMergedAt: e.consolidatedPrMergedAt,
          qaStartedAt: e.qaStartedAt,
          qaCompletedAt: e.qaCompletedAt,
          releaseApprovedAt: e.releaseApprovedAt,
        }) ?? 'staged';

      const lenses: QaLensSummary[] = (run?.lensRuns ?? []).map((lr) => {
        const lens = lr.lens as QaLensKindValue;
        const usage = lr.lensUsage as Record<string, unknown> | null;
        return {
          lens,
          status: lr.status as QaLensSummary['status'],
          suite: suiteFromRaw(lens, lr.rawResults),
          findings: mapFindings(lr.reportedFindings),
          envUrl: lr.envUrl,
          errorMessage: lr.errorMessage,
          costUsd: usage && typeof usage.totalCostUsd === 'number' ? usage.totalCostUsd : 0,
          startedAt: lr.startedAt?.toISOString() ?? null,
          completedAt: lr.completedAt?.toISOString() ?? null,
        };
      });

      return {
        batchId: e.enqueuedBatchId!,
        epicId: e.id,
        epicTitle: e.title,
        priority: e.priority as QaBatchTests['priority'],
        stage,
        qaRunId: run?.id ?? null,
        qaStatus: (run?.status as QaRunStatusValue | undefined) ?? null,
        recommendation: (run?.recommendation as QaVerdictValue | null) ?? null,
        confidence: run?.confidence ?? null,
        autoRollbackAdvised: run?.autoRollbackAdvised ?? false,
        qaReport: (run?.qaReport as QAReport | null) ?? null,
        lenses,
        releaseApprovedAt: e.releaseApprovedAt?.toISOString() ?? null,
        releaseApprovedByName: e.releaseApprovedByName,
        startedAt: run?.startedAt?.toISOString() ?? null,
        completedAt: run?.completedAt?.toISOString() ?? null,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      batches,
      status: batches.length > 0 ? 'ok' : 'insufficient_data',
    };
  }
}
