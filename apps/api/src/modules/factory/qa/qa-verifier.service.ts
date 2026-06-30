import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgAnthropicConfigService } from '../../org-anthropic-config/org-anthropic-config.service';
import { anthropicFetch } from '../../../lib/anthropic-fetch';
import { QA_MODELS, QA_REFUTER_COUNT, estimateSonnetCostUsd } from './qa-config';
import { decideClaimedReal } from './qa-confidence';
import type { RawFinding, VerifiedFinding } from './qa-types';

/** Origen determinista → el fallo es real por construcción, no necesita
 *  refutación por IA (un secret regex-matched o un <img> sin alt no es flaky). */
const DETERMINISTIC_PREFIXES = ['security-secret-', 'a11y-', 'perf-latency'];

type Vote = 'upheld' | 'refuted' | 'uncertain';

/**
 * Verificación adversarial de fallos. Para cada fallo que NO es determinista,
 * lanza N refutadores Sonnet independientes que intentan DEMOSTRAR que el
 * fallo no es real (flaky / problema de entorno / falso positivo). El fallo
 * cuenta como real salvo que la MAYORÍA lo refute (decideClaimedReal:
 * refuted <= upheld; empate/all-uncertain → real, conservador). Espeja la
 * Capa B (juez LLM) del ConflictResolver, pero agregada por voto.
 */
@Injectable()
export class QaVerifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(QaVerifierService.name)
    private readonly logger: PinoLogger,
  ) {}

  async verify(
    lensRunId: string,
    findings: RawFinding[],
    runId: string,
  ): Promise<VerifiedFinding[]> {
    if (findings.length === 0) return [];

    let apiKey: string | null = null;
    const results: VerifiedFinding[] = [];

    for (const finding of findings) {
      // Capa A: corto-circuito determinista.
      if (DETERMINISTIC_PREFIXES.some((p) => finding.id.startsWith(p))) {
        results.push({ ...finding, claimedReal: true, votes: { upheld: 0, refuted: 0, uncertain: 0 } });
        continue;
      }

      // Capa B: N refutadores independientes.
      if (apiKey === null) {
        try {
          apiKey = await this.orgAnthropic.getApiKeyPlaintext();
        } catch (err) {
          // Sin API key no podemos refutar — conservador: el fallo se sostiene.
          this.logger.warn(
            { event: 'qa.verify.no_api_key', runId },
            `[qa:${runId}] sin API key para refutar — el fallo se toma como real: ${(err as Error).message}`,
          );
          results.push({ ...finding, claimedReal: true, votes: { upheld: 0, refuted: 0, uncertain: 0 } });
          continue;
        }
      }

      const votes = await Promise.all(
        Array.from({ length: QA_REFUTER_COUNT }, (_, i) =>
          this.refute(finding, i, apiKey as string, lensRunId, runId),
        ),
      );
      const tally = { upheld: 0, refuted: 0, uncertain: 0 };
      for (const v of votes) tally[v]++;
      const claimedReal = decideClaimedReal(tally);
      results.push({ ...finding, claimedReal, votes: tally });
    }

    return results;
  }

  private async refute(
    finding: RawFinding,
    refuterIndex: number,
    apiKey: string,
    lensRunId: string,
    runId: string,
  ): Promise<Vote> {
    const prompt =
      `Eres un escéptico de QA. Tu trabajo es intentar REFUTAR el siguiente fallo reportado: ` +
      `decidir si es un problema REAL del código o un falso positivo (test flaky, problema de ` +
      `entorno efímero, dependencia de red, timing). Sé estricto: si dudas, marca "uncertain".\n\n` +
      `Fallo: ${finding.title}\nSeveridad reportada: ${finding.severity}\nCategoría: ${finding.category}\n` +
      `Evidencia:\n${finding.evidence.slice(0, 2000)}\n\n` +
      `Responde SOLO JSON: {"vote": "upheld"|"refuted"|"uncertain", "reasoning": "una línea"}. ` +
      `"upheld" = no pude refutarlo, el fallo es real. "refuted" = es un falso positivo. ` +
      `"uncertain" = no hay evidencia suficiente.`;

    const outcome = await this.callRefuter(apiKey, prompt).catch((err) => {
      this.logger.warn(
        { event: 'qa.verify.refuter_failed', runId, refuterIndex },
        `[qa:${runId}] refutador ${refuterIndex} falló: ${(err as Error).message}`,
      );
      return {
        vote: 'uncertain' as Vote,
        reasoning: `refuter error: ${(err as Error).message.slice(0, 120)}`,
        usage: null as { totalCostUsd: number; inputTokens: number; outputTokens: number } | null,
      };
    });
    const { vote, reasoning, usage } = outcome;

    // Persiste el voto (best-effort — no bloquea el veredicto).
    try {
      await this.prisma.qaFindingVerification.create({
        data: {
          qaLensRunId: lensRunId,
          findingId: finding.id,
          refuterIndex,
          model: QA_MODELS.verifier,
          vote,
          reasoning: reasoning.slice(0, 1000),
          ...(usage ? { usage: usage as unknown as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        { event: 'qa.verify.persist_failed', runId, lensRunId, findingId: finding.id },
        `[qa:${runId}] no se pudo persistir el voto: ${(err as Error).message}`,
      );
    }
    return vote;
  }

  /** Una llamada al refutador. Lanza en error de API (el caller lo captura). */
  private async callRefuter(
    apiKey: string,
    prompt: string,
  ): Promise<{
    vote: Vote;
    reasoning: string;
    usage: { totalCostUsd: number; inputTokens: number; outputTokens: number };
  }> {
    const client = new Anthropic({ apiKey, fetch: anthropicFetch });
    const response = await client.messages.create({
      model: QA_MODELS.verifier,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    const text = block && block.type === 'text' ? block.text : '';
    const parsed = this.parseVote(text);
    return {
      vote: parsed.vote,
      reasoning: parsed.reasoning,
      usage: {
        totalCostUsd: estimateSonnetCostUsd(response.usage.input_tokens, response.usage.output_tokens),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private parseVote(text: string): { vote: Vote; reasoning: string } {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
        const v = obj.vote;
        if (v === 'upheld' || v === 'refuted' || v === 'uncertain') {
          return { vote: v, reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '' };
        }
      } catch {
        /* cae al heurístico */
      }
    }
    // Heurístico si el modelo no devolvió JSON limpio.
    const lower = text.toLowerCase();
    if (lower.includes('refuted')) return { vote: 'refuted', reasoning: text.slice(0, 200) };
    if (lower.includes('upheld')) return { vote: 'upheld', reasoning: text.slice(0, 200) };
    return { vote: 'uncertain', reasoning: text.slice(0, 200) };
  }
}
