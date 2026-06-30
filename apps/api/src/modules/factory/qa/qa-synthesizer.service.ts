import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import type { QAReport } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgAnthropicConfigService } from '../../org-anthropic-config/org-anthropic-config.service';
import { anthropicFetch } from '../../../lib/anthropic-fetch';
import { QA_MODELS } from './qa-config';
import {
  buildQAReport,
  computeAutoRollbackAdvised,
  computeConfidence,
  computeRecommendation,
  type LensOutcome,
} from './qa-confidence';
import type { VerifiedFinding } from './qa-types';

export interface SynthesisInput {
  qaRunId: string;
  batchId: string;
  epicId: string;
  epicTitle: string;
  lenses: LensOutcome[];
  verified: VerifiedFinding[];
}

/**
 * Sintetiza el QAReport final de una campaña: confianza/recomendación
 * (puro, en qa-confidence), narrativa IA (con fallback templado), y persiste
 * todo en qa_runs + marca epic.qaCompletedAt en una transacción con el
 * changelog (mismo patrón que approveStagingGate).
 */
@Injectable()
export class QaSynthesizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(QaSynthesizerService.name)
    private readonly logger: PinoLogger,
  ) {}

  async synthesize(input: SynthesisInput, generatedAt: string): Promise<QAReport> {
    const confidence = computeConfidence(input.lenses, input.verified);
    const recommendation = computeRecommendation(input.verified);
    const autoRollbackAdvised = computeAutoRollbackAdvised(input.verified);

    const narrative = await this.buildNarrative(input, confidence, recommendation);

    const report = buildQAReport({
      qaRunId: input.qaRunId,
      batchId: input.batchId,
      lenses: input.lenses,
      verified: input.verified,
      confidence,
      recommendation,
      narrative,
      generatedAt,
    });

    // Persiste el reporte + cierra la campaña + marca la etapa en el epic.
    await this.prisma.$transaction(async (tx) => {
      await tx.qaRun.update({
        where: { id: input.qaRunId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          recommendation,
          confidence,
          autoRollbackAdvised,
          qaReport: report as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.epic.update({
        where: { id: input.epicId },
        data: { qaCompletedAt: new Date() },
      });
      await tx.changelogEntry.create({
        data: {
          entityType: 'epic',
          entityId: input.epicId,
          entityTitle: input.epicTitle,
          action: 'qa_completed',
          newValue: `${recommendation} (confianza ${confidence}%${autoRollbackAdvised ? ', rollback aconsejado' : ''})`,
        },
      });
    });

    this.logger.info(
      {
        event: 'qa.synthesizer.completed',
        qaRunId: input.qaRunId,
        batchId: input.batchId,
        recommendation,
        confidence,
        autoRollbackAdvised,
        realFindings: input.verified.filter((f) => f.claimedReal).length,
      },
      `[qa:${input.qaRunId}] QAReport listo → ${recommendation} (${confidence}%)`,
    );

    return report;
  }

  private async buildNarrative(
    input: SynthesisInput,
    confidence: number,
    recommendation: string,
  ): Promise<string> {
    const real = input.verified.filter((f) => f.claimedReal);
    const fallback =
      `QA del batch "${input.epicTitle}": ${input.lenses.length} lentes ejecutados, ` +
      `${real.length} fallo(s) verificado(s) como real(es). ` +
      `Recomendación: ${recommendation} (confianza ${confidence}%).`;

    try {
      const apiKey = await this.orgAnthropic.getApiKeyPlaintext();
      const client = new Anthropic({ apiKey, fetch: anthropicFetch });
      const lensSummary = input.lenses
        .map((l) => `- ${l.lens}: ${l.status}${l.result?.suite ? ` (${l.result.suite.passed}/${l.result.suite.total} ok)` : ''}`)
        .join('\n');
      const findingsSummary =
        real.length > 0
          ? real.map((f) => `- [${f.severity}] ${f.title}`).join('\n')
          : 'Sin fallos verificados como reales.';
      const prompt =
        `Resume en 2-3 frases, en español neutro, el resultado del QA automático de un batch ` +
        `de software para un dashboard ejecutivo. No inventes datos. Sé directo.\n\n` +
        `Lentes:\n${lensSummary}\n\nFallos reales:\n${findingsSummary}\n\n` +
        `Recomendación: ${recommendation}, confianza ${confidence}%.`;
      const response = await client.messages.create({
        model: QA_MODELS.synthesizer,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = response.content[0];
      const text = block && block.type === 'text' ? block.text.trim() : '';
      return text.length > 0 ? text : fallback;
    } catch (err) {
      this.logger.warn(
        { event: 'qa.synthesizer.narrative_failed', qaRunId: input.qaRunId },
        `[qa:${input.qaRunId}] narrativa IA falló — fallback templado: ${(err as Error).message}`,
      );
      return fallback;
    }
  }
}
