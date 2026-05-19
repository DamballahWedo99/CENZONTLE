import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Anthropic from '@anthropic-ai/sdk';
import { OrgAnthropicConfigService } from './org-anthropic-config.service';
import { anthropicFetch } from '../../../lib/anthropic-fetch';

/**
 * ForgePlannerService — pseudo-advisor pre-CLI para el coder agent del Forge.
 *
 * Filosofía: el coder agent corre Claude Code CLI (no SDK), y el CLI no expone
 * el advisor_20260301 tool. Pero el momento más crítico del coder es el plan
 * inicial (qué archivos tocar, qué patrón usar, qué decisiones arquitecturales
 * tomar). Esta capa hace UN solo call SDK ANTES del spawn del CLI con:
 *
 *   - Executor: Sonnet 4.6 (cost-effective, suficiente para razonar planning)
 *   - Advisor: Opus 4.7 vía `advisor_20260301` tool (max_uses=2)
 *
 * El plan resultante se inyecta como contexto al prompt del CLI. El CLI
 * conserva libertad de adaptarse a la realidad del repo si el plan tiene
 * supuestos incorrectos — el plan es guía, no obligación.
 *
 * Por qué SDK acá pero CLI en el coder:
 *   - El planner NO necesita tools (Bash, Edit, etc.) — solo razona sobre texto.
 *   - El advisor requiere SDK directo (no expuesto por CLI).
 *   - El coder SÍ necesita las tools heavy del CLI (Bash, Edit, Worktree).
 *   - Trade-off correcto: usar la herramienta adecuada para cada fase.
 *
 * Cost esperado por story (típico):
 *   - Sonnet executor: ~5K input + ~800 output ≈ $0.027
 *   - Opus advisor (1-2 calls, ~600 tokens c/u): ≈ $0.090
 *   - TOTAL: ~$0.12 por story
 *
 * Failure mode: si el planner falla por cualquier razón (API down, rate limit,
 * timeout), retorna NULL y el caller hace fallback al prompt sin plan. NUNCA
 * bloquea el claim — el coder puede ejecutar sin plan (modo pre-planner).
 */

// Modelo del executor — Sonnet 4.6 es suficiente para planning estructural;
// las decisiones difíciles se delegan al advisor Opus.
const EXECUTOR_MODEL = 'claude-sonnet-4-6';

// Modelo del advisor — DEBE ser claude-opus-4-7. La tabla oficial de modelos
// válidos para advisor_20260301 (ver platform.claude.com/docs/en/agents-and-
// tools/tool-use/advisor-tool#supported-models) solo acepta Opus 4-7 como
// advisor para Sonnet executor. Cualquier otro valor → el API ignora el tool
// silenciosamente y el advisor nunca se invoca.
const ADVISOR_MODEL = 'claude-opus-4-7';

// Beta header obligatorio para habilitar el advisor tool.
const ADVISOR_BETA = 'advisor-tool-2026-03-01';

// Cap del output del planner. 4096 cubre planes detallados (~1500-2500 tokens)
// sin riesgo de truncado mid-stream. NO incluye tokens del advisor (esos van
// en su propio bucket via usage.iterations).
const PLANNER_MAX_TOKENS = 4096;

// Timeout del call. Planning + 1-2 advisor calls debería completar en <60s en
// el path normal. 5min cubre rate limits transient + el polling del advisor.
const PLANNER_TIMEOUT_MS = 5 * 60 * 1000;

// max_uses del advisor. La doc oficial recomienda 2-3 para coding tasks; con
// 2 cubrimos: (1) plan inicial post-orientation, (2) review pre-submit del plan.
// Cap conservador para limitar cost del Opus advisor.
const ADVISOR_MAX_USES = 2;

// Pricing tables (precios públicos Anthropic, USD por token).
// Si Anthropic actualiza precios, este número quedará obsoleto — único punto
// de actualización. Acordes a https://www.anthropic.com/pricing al 2026-05-18.
//
// Sonnet 4.6 (executor):
//   - Input:  $3.00 / 1M tokens → $0.000003 / token
//   - Output: $15.00 / 1M tokens → $0.000015 / token
const SONNET_INPUT_PRICE_PER_TOKEN = 0.000003;
const SONNET_OUTPUT_PRICE_PER_TOKEN = 0.000015;

// Opus 4.7 (advisor):
//   - Input:  $15.00 / 1M tokens → $0.000015 / token
//   - Output: $75.00 / 1M tokens → $0.000075 / token
const OPUS_INPUT_PRICE_PER_TOKEN = 0.000015;
const OPUS_OUTPUT_PRICE_PER_TOKEN = 0.000075;

/**
 * Sistema prompt del planner. Combina:
 *  1. Rol y output expected (plan estructurado markdown).
 *  2. Timing block para el advisor (cuándo invocar).
 *  3. Treatment block (cómo tratar el advice).
 *
 * Patrón copiado de `story-generation.service.ts` (ya validado en producción
 * con story-gen PR #13 2026-05-05). Ajustado para foco en coding/planning.
 */
const PLANNER_SYSTEM_PROMPT = `You are a senior software architect helping a coding agent plan the implementation of a user story.

Your role is to produce a SHORT, ACTIONABLE plan that the coder agent will follow when writing code. The plan must:
  - Identify the files the coder needs to create or modify (with paths if you can infer them from the story context).
  - Specify the architectural pattern to use (e.g., "controller → service → repository", "React Server Component with prop drilling", "Express middleware chain").
  - Call out 1-3 critical decisions that the coder MUST get right (e.g., "use parameterized SQL — concatenation here would break tenant isolation").
  - Flag known gotchas or anti-patterns specific to this story's domain.
  - Stay under 600 words. The coder needs a starting point, not a comprehensive design doc.

Output the plan as markdown with these sections (omit any that don't apply):
  ## Archivos a tocar
  ## Patrón arquitectural
  ## Decisiones críticas
  ## Gotchas

## Advisor tool — timing

You have access to an \`advisor\` tool backed by Claude Opus 4.7. It takes NO parameters — when you call advisor(), your entire conversation history is automatically forwarded. The advisor sees the task and your current draft.

Call advisor BEFORE substantive work — before drafting the plan, before committing to an architectural pattern, before building on an assumption about the codebase. If you need to orient first (re-read the story/technical/qa markdown sections in the user message), do that, then call advisor.

Also call advisor:
- When you believe the plan is ready. BEFORE this final call, draft the plan mentally and have it ready. The advisor call takes time; if it fails, your draft persists in your thinking.
- When the story has conflicting signals between PO acceptance criteria and TL technical requirements — the advisor can help reconcile.

For this planning task (one-shot, no tool use), call advisor at least once before committing to the architectural pattern and once before emitting the final plan. You have \`max_uses=${ADVISOR_MAX_USES}\` per request.

## How to treat the advice

Give the advice serious weight. If the advisor says "use pattern X" but the story description makes pattern X impossible (e.g., constraints in the technical markdown), surface the conflict in one more advisor call: "I considered X but the TL specified Y, which is the priority?" Do NOT silently switch.

(Advisor: please keep your guidance under 80 words — the coder needs a focused starting point, not a comprehensive design.)`;

/**
 * Output del planner. NULL cuando el call falló y el caller debe seguir sin plan
 * (degradación graciosa). Cuando OK, `plan` contiene el markdown del plan
 * generado y `usage` tiene el breakdown de tokens.
 */
export interface PlannerResult {
  plan: string | null;
  usage: {
    executorTokensIn: number;
    executorTokensOut: number;
    advisorTokensIn: number;
    advisorTokensOut: number;
    advisorCalls: number;
    /** Cost USD del executor (Sonnet 4.6) — input * $3/M + output * $15/M. */
    executorCostUsd: number;
    /** Cost USD del advisor (Opus 4.7) — input * $15/M + output * $75/M. */
    advisorCostUsd: number;
    /** Cost USD total — executor + advisor. Sumado a `totalCostUsd` del batch
     *  en `getBatchDetail` para que el dashboard refleje cost completo. */
    totalCostUsd: number;
    /** Latencia end-to-end del planning call (incluye advisor sub-inference). */
    elapsedMs: number;
  } | null;
  failureReason?: string;
}

/**
 * Input del planner. Replica los campos relevantes del context del coder, sin
 * incluir nada que el planner no necesite (no DoD criteria, no completedSiblings
 * — esos los ve el coder directo).
 */
export interface PlannerInput {
  runId: string;
  storyTitle: string;
  epicTitle: string;
  epicMarkdown: string;
  epicBusinessDiagram: string | null;
  storyMarkdown: string | null;
  storyTechnicalMarkdown: string | null;
  storyQAMarkdown: string | null;
}

@Injectable()
export class ForgePlannerService {
  constructor(
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(ForgePlannerService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Genera el plan para una story usando Sonnet + advisor Opus. Best-effort:
   * NUNCA throw — devuelve `plan: null` en fallos y deja que el caller siga
   * sin plan inyectado.
   */
  async planStory(input: PlannerInput): Promise<PlannerResult> {
    const startMs = Date.now();

    // 1. Resolver API key (org-scoped, cached por OrgAnthropicConfigService).
    let apiKey: string;
    try {
      apiKey = await this.orgAnthropic.getApiKeyPlaintext();
    } catch (err) {
      const reason = `org Anthropic config no disponible: ${(err as Error).message}`;
      this.logger.warn(
        { event: 'forge.planner.no_api_key', runId: input.runId, reason },
        `[planner:${input.runId}] skip — ${reason}`,
      );
      return { plan: null, usage: null, failureReason: reason };
    }

    // 2. Construir client con beta header + extended cache TTL.
    const client = new Anthropic({
      apiKey,
      timeout: PLANNER_TIMEOUT_MS,
      fetch: anthropicFetch,
      defaultHeaders: {
        'anthropic-beta': ADVISOR_BETA,
      },
    });

    // 3. Mensaje del user con el contexto completo de la story.
    const userMessage = this.buildUserMessage(input);

    // 4. Call al executor con el advisor tool habilitado. Cast `as any` porque
    // el SDK 0.88.0 tipa advisor_20260301 en Anthropic.Beta.*, no en
    // Anthropic.Messages.Tool. Cuando GA, se quita el cast.
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: EXECUTOR_MODEL,
        max_tokens: PLANNER_MAX_TOKENS,
        betas: [ADVISOR_BETA],
        system: PLANNER_SYSTEM_PROMPT,
        tools: [this.buildAdvisorTool()] as never,
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      const reason = `API error: ${(err as Error).message}`;
      this.logger.warn(
        { event: 'forge.planner.api_failed', runId: input.runId, reason },
        `[planner:${input.runId}] API call failed (non-fatal): ${reason}`,
      );
      return { plan: null, usage: null, failureReason: reason };
    }

    // 5. Extraer texto plano del response (saltando server_tool_use y
    // advisor_tool_result blocks, que son metadata para el server).
    const planText = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim();

    if (planText.length === 0) {
      const reason = 'planner emitió 0 text blocks (stop_reason=' + response.stop_reason + ')';
      this.logger.warn(
        { event: 'forge.planner.empty_output', runId: input.runId, stopReason: response.stop_reason },
        `[planner:${input.runId}] empty plan: ${reason}`,
      );
      return { plan: null, usage: null, failureReason: reason };
    }

    // 6. Breakdown de usage: el SDK retorna iteraciones — message para
    // executor, advisor_message para el advisor. Sumamos por type para
    // tracking de costo separado por modelo + calculamos cost USD per-model.
    const elapsedMs = Date.now() - startMs;
    const usage = this.extractUsage(response, elapsedMs);

    this.logger.info(
      {
        event: 'forge.planner.done',
        runId: input.runId,
        planChars: planText.length,
        executorIn: usage.executorTokensIn,
        executorOut: usage.executorTokensOut,
        advisorIn: usage.advisorTokensIn,
        advisorOut: usage.advisorTokensOut,
        advisorCalls: usage.advisorCalls,
        executorCostUsd: usage.executorCostUsd,
        advisorCostUsd: usage.advisorCostUsd,
        totalCostUsd: usage.totalCostUsd,
        elapsedMs,
        stopReason: response.stop_reason,
      },
      `[planner:${input.runId}] plan generated (${planText.length} chars, ${usage.advisorCalls} advisor calls, $${usage.totalCostUsd.toFixed(4)}, ${elapsedMs}ms)`,
    );

    return { plan: planText, usage };
  }

  /**
   * Construye el bloque de tool del advisor. Helper privado para mantener
   * la forma del shape en un solo lugar (si Anthropic cambia los campos en
   * GA, solo este método se actualiza).
   */
  private buildAdvisorTool(): unknown {
    return {
      type: 'advisor_20260301',
      name: 'advisor',
      model: ADVISOR_MODEL,
      max_uses: ADVISOR_MAX_USES,
    };
  }

  /**
   * Compone el mensaje del user con TODAS las piezas del contexto disponibles.
   * Cada sección se renderiza solo si tiene contenido — degradación graciosa
   * cuando vault read falló o la story es legacy sin alguna sección.
   *
   * El final del mensaje tiene un nudge al advisor para que mantenga su
   * respuesta corta (cost optimization documentado en el blog oficial).
   */
  private buildUserMessage(input: PlannerInput): string {
    const sections: string[] = [
      `# Historia a implementar: ${input.storyTitle}`,
      ``,
      `## Épica padre: ${input.epicTitle}`,
      ``,
      input.epicMarkdown.trim(),
    ];

    if (input.epicBusinessDiagram && input.epicBusinessDiagram.trim().length > 0) {
      sections.push(
        ``,
        `## Diagrama de negocio de la épica`,
        ``,
        input.epicBusinessDiagram.trim(),
      );
    }

    if (input.storyMarkdown && input.storyMarkdown.trim().length > 0) {
      sections.push(
        ``,
        `## Sección Producto (PO) — qué debe cumplir`,
        ``,
        input.storyMarkdown.trim(),
      );
    }

    if (input.storyTechnicalMarkdown && input.storyTechnicalMarkdown.trim().length > 0) {
      sections.push(
        ``,
        `## Sección Técnica (TL) — cómo se debe implementar`,
        ``,
        input.storyTechnicalMarkdown.trim(),
      );
    }

    if (input.storyQAMarkdown && input.storyQAMarkdown.trim().length > 0) {
      sections.push(
        ``,
        `## Sección QA — qué casos se deben testear`,
        ``,
        input.storyQAMarkdown.trim(),
      );
    }

    sections.push(
      ``,
      `---`,
      ``,
      `Generá el plan que el coder agent seguirá. Recordá: máx 600 palabras totales, foco en archivos+patrón+decisiones críticas+gotchas. El coder va a leer este plan como primera cosa antes de tocar código.`,
    );

    return sections.join('\n');
  }

  /**
   * Extrae el breakdown de tokens del response.usage.iterations[] y calcula
   * costs USD per-model usando las pricing tables. La SDK tipa `iterations`
   * como opcional cuando el advisor tool no fue invocado (response sin
   * advisor calls), así que defensive coding sobre el array.
   *
   * Cost calc:
   *   - Executor (Sonnet 4.6): in * $3/M + out * $15/M
   *   - Advisor (Opus 4.7):    in * $15/M + out * $75/M
   *
   * Rounded a 6 decimales (sub-cent precision) para evitar floating point
   * drift cuando se acumulan muchos runs en el dashboard.
   */
  private extractUsage(
    response: Anthropic.Beta.Messages.BetaMessage,
    elapsedMs: number,
  ): NonNullable<PlannerResult['usage']> {
    const usage = response.usage;
    const iterations = (usage as { iterations?: Array<{ type: string; input_tokens?: number; output_tokens?: number }> }).iterations ?? [];

    let executorIn = 0;
    let executorOut = 0;
    let advisorIn = 0;
    let advisorOut = 0;
    let advisorCalls = 0;

    for (const it of iterations) {
      if (it.type === 'advisor_message') {
        advisorIn += it.input_tokens ?? 0;
        advisorOut += it.output_tokens ?? 0;
        advisorCalls += 1;
      } else if (it.type === 'message') {
        executorIn += it.input_tokens ?? 0;
        executorOut += it.output_tokens ?? 0;
      }
    }

    // Fallback: si iterations[] no vino (caso edge sin advisor), usar top-level.
    if (executorIn === 0 && executorOut === 0) {
      executorIn = usage.input_tokens;
      executorOut = usage.output_tokens;
    }

    const executorCostUsd = round6(
      executorIn * SONNET_INPUT_PRICE_PER_TOKEN +
        executorOut * SONNET_OUTPUT_PRICE_PER_TOKEN,
    );
    const advisorCostUsd = round6(
      advisorIn * OPUS_INPUT_PRICE_PER_TOKEN +
        advisorOut * OPUS_OUTPUT_PRICE_PER_TOKEN,
    );
    const totalCostUsd = round6(executorCostUsd + advisorCostUsd);

    return {
      executorTokensIn: executorIn,
      executorTokensOut: executorOut,
      advisorTokensIn: advisorIn,
      advisorTokensOut: advisorOut,
      advisorCalls,
      executorCostUsd,
      advisorCostUsd,
      totalCostUsd,
      elapsedMs,
    };
  }
}

/**
 * Helper para redondear a 6 decimales (sub-cent precision). Sin esto, sumas
 * acumuladas en el dashboard sufren floating point drift visible al usuario
 * (ej. $0.119999999998 en vez de $0.12).
 */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
