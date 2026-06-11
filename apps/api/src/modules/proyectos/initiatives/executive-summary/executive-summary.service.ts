import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Subject } from 'rxjs';
import { EpicStatus, StoryStatus } from '@cenzontle/shared';
import type {
  AuthenticatedUser,
  EpicMetricsRow,
  ExecutiveSummary,
  ExecutiveSummaryEvent,
  ExecutiveSummaryHealth,
  ExecutiveSummaryHighlight,
  ExecutiveSummaryNarrative,
  ExecutiveSummaryRecommendation,
  ExecutiveSummaryRisk,
  ExecutiveSummaryRiskSeverity,
  ExecutiveSummaryTone,
  InitiativeMetrics,
  InitiativeStatus,
  PodMetricsRow,
  Priority,
  StoryStatusSlice,
} from '@cenzontle/shared';
import { anthropicFetch } from '../../../../lib/anthropic-fetch';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrgAnthropicConfigService } from '../../../org-anthropic-config/org-anthropic-config.service';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

// Sonnet 4.6 — adaptive thinking + structured outputs (output_config.format).
// OJO: thinking es INCOMPATIBLE con tool_choice forzado ({type:'tool'}) — la
// API devuelve 400. Por eso el structured output va via output_config.format
// (json_schema), que sí convive con thinking y streaming.
const MODEL = 'claude-sonnet-4-6';
// Una sola llamada de redacción (sin loop de tools de investigación): la
// narrativa cabe holgada en 16K incluyendo el thinking adaptive.
const MAX_TOKENS = 16_000;

// Topes defensivos sobre la narrativa que entrega la IA — mismos rationale
// que en epic-generation: evitar payloads patológicos en BD/SSE/UI aunque
// el input_schema ya restrinja el shape.
const MAX_TITLE_LEN = 300;
const MAX_FIELD_LEN = 20_000;
const MAX_ARRAY_ITEMS = 8;

// Contexto cualitativo para el modelo: extracto por épica + cap global.
// ~1500 chars capturan objetivo + beneficios del markdown estándar de 9
// headings sin inflar el prompt; 40K totales acotan iniciativas con
// decenas de épicas.
const EPIC_EXCERPT_CHARS = 1_500;
const EPIC_CONTEXT_CAP_CHARS = 40_000;

const HEALTH_VALUES: readonly ExecutiveSummaryHealth[] = ['on_track', 'at_risk', 'off_track'];
const TONE_VALUES: readonly ExecutiveSummaryTone[] = ['positive', 'neutral', 'warning'];
const SEVERITY_VALUES: readonly ExecutiveSummaryRiskSeverity[] = ['high', 'medium', 'low'];

function capStr(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

/**
 * Prisma persiste `todo` mientras el enum compartido usa `to_do` — el resto
 * de los valores coincide 1:1. Normalizamos al contrato compartido para que
 * `storyDistribution` agrupe bajo la key que el frontend espera.
 */
function toSharedStoryStatus(status: string): StoryStatus {
  return status === 'todo' ? StoryStatus.ToDo : (status as StoryStatus);
}

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** % redondeado de `done` sobre `total`; 0 si no hay denominador. */
function pct(done: number, total: number): number {
  return total > 0 ? Math.round((100 * done) / total) : 0;
}

// Shape mínimo de las historias que computeMetrics consume — el select de
// Prisma garantiza estos campos; tiparlo explícito evita acoplar la lógica
// de agregación al tipo generado completo.
interface StoryForMetrics {
  id: string;
  status: string;
  storyPoints: number;
  podId: string;
  pod: { name: string };
}

@Injectable()
export class ExecutiveSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(ExecutiveSummaryService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Snapshot 100% determinista de métricas de la iniciativa — la IA nunca
   * produce números, solo recibe este objeto como contexto de solo lectura.
   *
   * Una query trae el grafo completo (initiative → epics → stories con su
   * pod.name); los counts de dependencias van aparte porque StoryDependency
   * exige que AMBOS extremos pertenezcan a la iniciativa (filtro `in` doble
   * que no se expresa como include anidado).
   */
  async computeMetrics(initiativeId: string): Promise<InitiativeMetrics> {
    const initiative = await this.prisma.initiative.findUnique({
      where: { id: initiativeId },
      include: {
        epics: {
          orderBy: { createdAt: 'asc' },
          include: {
            stories: {
              select: {
                id: true,
                status: true,
                storyPoints: true,
                podId: true,
                pod: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    const allStories: StoryForMetrics[] = initiative.epics.flatMap((e) => e.stories);
    const storyIds = allStories.map((s) => s.id);

    // Dependencias: StoryDependency cuenta solo aristas INTERNAS a la
    // iniciativa (ambos extremos dentro); las técnicas se consideran
    // "abiertas" mientras no estén resolved/mitigated. Si no hay historias,
    // evitamos 4 queries `in: []` triviales.
    const [hardBlocks, softBlocks, technicalOpen, technicalBlocking] =
      storyIds.length > 0
        ? await Promise.all([
            this.prisma.storyDependency.count({
              where: { storyId: { in: storyIds }, blockedById: { in: storyIds }, hardness: 'hard' },
            }),
            this.prisma.storyDependency.count({
              where: { storyId: { in: storyIds }, blockedById: { in: storyIds }, hardness: 'soft' },
            }),
            this.prisma.storyTechnicalDependency.count({
              where: { storyId: { in: storyIds }, status: { notIn: ['resolved', 'mitigated'] } },
            }),
            this.prisma.storyTechnicalDependency.count({
              where: {
                storyId: { in: storyIds },
                status: { notIn: ['resolved', 'mitigated'] },
                isBlocking: true,
              },
            }),
          ])
        : [0, 0, 0, 0];

    // --- Distribución de historias: una entrada por CADA StoryStatus (los 7),
    // en el orden del enum compartido, aunque count=0 — el chart D3 del
    // frontend espera el eje completo.
    const distributionMap = new Map<StoryStatus, { count: number; points: number }>(
      Object.values(StoryStatus).map((s) => [s, { count: 0, points: 0 }]),
    );
    for (const story of allStories) {
      const slice = distributionMap.get(toSharedStoryStatus(story.status));
      if (slice) {
        slice.count += 1;
        slice.points += story.storyPoints;
      }
    }
    const storyDistribution: StoryStatusSlice[] = Object.values(StoryStatus).map((status) => ({
      status,
      count: distributionMap.get(status)?.count ?? 0,
      points: distributionMap.get(status)?.points ?? 0,
    }));

    // --- Totales globales.
    const storiesTotal = allStories.length;
    const storiesDone = allStories.filter((s) => s.status === StoryStatus.Done).length;
    const storiesBlocked = allStories.filter((s) => s.status === StoryStatus.Blocked).length;
    const points = allStories.reduce((sum, s) => sum + s.storyPoints, 0);
    const pointsDone = allStories
      .filter((s) => s.status === StoryStatus.Done)
      .reduce((sum, s) => sum + s.storyPoints, 0);

    // --- Épicas por status: los 4 valores del enum, 0 incluido.
    const epicsByStatus = Object.values(EpicStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<EpicStatus, number>,
    );
    for (const epic of initiative.epics) {
      epicsByStatus[epic.status as EpicStatus] += 1;
    }

    // --- Fila por épica.
    const epics: EpicMetricsRow[] = initiative.epics.map((epic) => {
      const eStories: StoryForMetrics[] = epic.stories;
      const eDone = eStories.filter((s) => s.status === StoryStatus.Done);
      return {
        epicId: epic.id,
        title: epic.title,
        status: epic.status as EpicStatus,
        // Los enums de Prisma son uniones de string literales con los mismos
        // valores que los enums compartidos — cast directo seguro.
        priority: epic.priority as Priority,
        storiesTotal: eStories.length,
        storiesDone: eDone.length,
        storiesBlocked: eStories.filter((s) => s.status === StoryStatus.Blocked).length,
        pointsTotal: eStories.reduce((sum, s) => sum + s.storyPoints, 0),
        pointsDone: eDone.reduce((sum, s) => sum + s.storyPoints, 0),
        progressPct: pct(eDone.length, eStories.length),
        startDate: toIso(epic.startDate),
        targetDate: toIso(epic.targetDate),
      };
    });

    // --- Carga por pod: el podId vive en la STORY (no en EpicPod) — un pod
    // puede aparecer en historias de varias épicas; el nombre viene resuelto
    // por la relación story.pod en la misma query.
    const podsMap = new Map<string, PodMetricsRow>();
    for (const story of allStories) {
      let row = podsMap.get(story.podId);
      if (!row) {
        row = {
          podId: story.podId,
          podName: story.pod.name,
          storiesTotal: 0,
          storiesDone: 0,
          pointsTotal: 0,
          pointsDone: 0,
          progressPct: 0,
        };
        podsMap.set(story.podId, row);
      }
      row.storiesTotal += 1;
      row.pointsTotal += story.storyPoints;
      if (story.status === StoryStatus.Done) {
        row.storiesDone += 1;
        row.pointsDone += story.storyPoints;
      }
    }
    const pods = Array.from(podsMap.values()).map((row) => ({
      ...row,
      progressPct: pct(row.storiesDone, row.storiesTotal),
    }));

    // --- Timeline. Todo en UTC para que `today` y `daysRemaining` sean
    // consistentes entre sí independientemente de la TZ del proceso.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    let elapsedPct: number | null = null;
    if (initiative.startDate && initiative.targetDate) {
      const start = initiative.startDate.getTime();
      const target = initiative.targetDate.getTime();
      const span = target - start;
      if (span <= 0) {
        // Fechas degeneradas (target <= start): binario vencido/no-vencido,
        // sin división por cero.
        elapsedPct = now.getTime() >= target ? 100 : 0;
      } else {
        // Puede exceder 100 si la iniciativa está vencida; nunca negativo.
        elapsedPct = Math.max(0, Math.round((100 * (now.getTime() - start)) / span));
      }
    }

    let daysRemaining: number | null = null;
    if (initiative.targetDate) {
      const t = initiative.targetDate;
      const targetUtcMidnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      daysRemaining = Math.round((targetUtcMidnight - todayUtcMidnight) / 86_400_000);
    }

    return {
      computedAt: now.toISOString(),
      initiative: {
        id: initiative.id,
        name: initiative.name,
        status: initiative.status as InitiativeStatus,
        owner: initiative.owner,
        startDate: toIso(initiative.startDate),
        targetDate: toIso(initiative.targetDate),
      },
      totals: {
        epics: initiative.epics.length,
        stories: storiesTotal,
        storiesDone,
        storiesBlocked,
        points,
        pointsDone,
        progressPct: pct(storiesDone, storiesTotal),
        epicsByStatus,
      },
      storyDistribution,
      epics,
      pods,
      timeline: {
        startDate: toIso(initiative.startDate),
        targetDate: toIso(initiative.targetDate),
        today,
        elapsedPct,
        daysRemaining,
      },
      dependencies: {
        hardBlocks,
        softBlocks,
        technicalOpen,
        technicalBlocking,
      },
    };
  }

  /**
   * Genera el resumen ejecutivo completo (métricas deterministas + narrativa
   * IA), lo persiste en `Initiative.executiveSummary` y emite el progreso
   * como eventos SSE via el Subject retornado.
   */
  generate(
    initiativeId: string,
    user: AuthenticatedUser,
    signal?: AbortSignal,
  ): Subject<{ data: ExecutiveSummaryEvent }> {
    const subject = new Subject<{ data: ExecutiveSummaryEvent }>();

    // Arranque diferido al siguiente microtask: runAgent emite `run_started`
    // y `phase_change collecting` de forma SÍNCRONA (antes de su primer
    // await) y el controller todavía no se suscribió al Subject — sin el
    // defer, esos dos eventos se perderían (Subject no hace replay).
    queueMicrotask(() => {
      this.runAgent(initiativeId, user, subject, signal).catch((err: Error) => {
      // El mensaje real (que puede traer detalles del SDK/BD) se queda
      // server-side; el cliente recibe uno genérico.
        this.logger.error({ err }, `[ExecSummary] Agent error: ${err?.message}`);
        subject.next({
          data: {
            type: 'error',
            message: 'Error interno al generar el resumen ejecutivo. Intenta de nuevo.',
            timestamp: new Date().toISOString(),
          },
        });
        subject.complete();
      });
    });

    return subject;
  }

  private async runAgent(
    initiativeId: string,
    user: AuthenticatedUser,
    subject: Subject<{ data: ExecutiveSummaryEvent }>,
    signal?: AbortSignal,
  ): Promise<void> {
    const runStartTime = Date.now();
    const emit = (event: ExecutiveSummaryEvent): void => {
      subject.next({ data: { ...event, timestamp: new Date().toISOString() } });
    };
    const finish = (): void => {
      emit({ type: 'run_finished', totalDurationMs: Date.now() - runStartTime });
      subject.complete();
    };

    emit({ type: 'run_started' });

    // --- Fase 1: métricas deterministas.
    emit({ type: 'phase_change', phase: 'collecting', label: 'Recolectando métricas' });
    const metrics = await this.computeMetrics(initiativeId);
    emit({ type: 'metrics_ready', metrics });

    if (signal?.aborted) {
      finish();
      return;
    }

    // --- Fase 2: contexto cualitativo (descripción + extractos de épicas).
    emit({ type: 'phase_change', phase: 'analyzing', label: 'Analizando contexto' });
    const initiative = await this.prisma.initiative.findUnique({
      where: { id: initiativeId },
      select: {
        description: true,
        epics: {
          orderBy: { createdAt: 'asc' },
          select: { title: true, markdown: true },
        },
      },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    const contextBlock = this.buildContextBlock(initiative.description, initiative.epics, metrics);

    // Resolver API key desde OrgAnthropicConfigService (key cifrada en BD,
    // configurable desde /factory/settings sin redeploy). Mismos failure
    // modes que epic-generation: 404 = no configurada, otro = decrypt roto.
    let client: Anthropic;
    try {
      client = await this.buildClient();
    } catch (err) {
      const e = err as { status?: number; name?: string; message?: string };
      const isNotConfigured = e?.status === 404 || e?.name === 'NotFoundException';
      const message = isNotConfigured
        ? 'Anthropic API key no configurada. Configúrala en /factory/settings antes de generar el resumen.'
        : 'Error al acceder a la API key de Anthropic. Contacta al administrador del sistema.';
      this.logger.warn({ err: e?.message, isNotConfigured }, `[ExecSummary] ${message}`);
      emit({ type: 'error', message });
      finish();
      return;
    }

    if (signal?.aborted) {
      finish();
      return;
    }

    // --- Fase 3: redacción — UNA llamada con structured output (sin loop de
    // investigación: todo el contexto ya viaja en el system prompt). El
    // schema se impone via output_config.format porque adaptive thinking es
    // incompatible con tool_choice forzado (400 invalid_request_error).
    emit({ type: 'phase_change', phase: 'writing', label: 'Redactando resumen ejecutivo' });

    const systemPrompt = this.buildSystemPrompt();
    const kickoff =
      'Las métricas deterministas y el contexto de la iniciativa están en el system prompt. ' +
      'Responde ÚNICAMENTE con el JSON del resumen ejecutivo conforme al formato exigido.';

    let narrative: ExecutiveSummaryNarrative | null = null;
    const MAX_ATTEMPTS = 2; // 1 intento + 1 retry correctivo (refusal/max_tokens)
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !narrative; attempt++) {
      if (signal?.aborted) {
        finish();
        return;
      }

      // El retry NO reenvía el assistant turn fallido (output truncado o
      // refusal): reiniciar la conversación con una instrucción correctiva
      // es más robusto que reconstruir el turno parcial.
      const messages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content:
            attempt === 0
              ? kickoff
              : `${kickoff}\n\nIMPORTANTE: tu intento anterior no produjo un JSON válido. Responde con un único objeto JSON que cumpla el schema EXACTAMENTE (todos los campos required, enums válidos), sin texto fuera del JSON.`,
        },
      ];

      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            { type: 'text', text: systemPrompt },
            { type: 'text', text: contextBlock },
          ],
          thinking: { type: 'adaptive' },
          output_config: {
            format: { type: 'json_schema', schema: this.buildNarrativeSchema() },
          },
          messages,
        },
        // Propagar el AbortSignal al SDK corta la respuesta de Anthropic
        // cuando el run se cancela (cost + memory leak).
        signal ? { signal } : undefined,
      );

      // Iterar raw events (no los helpers del SDK) para que cada
      // thinking_delta llegue al SSE en cuanto se recibe — con adaptive
      // mode los helpers esperan al cierre del bloque y la UI parece trabada.
      // Los text_delta NO se emiten: con structured outputs el texto es el
      // JSON crudo del resultado, no razonamiento legible.
      for await (const evt of stream) {
        if (evt.type !== 'content_block_delta') continue;
        const delta = evt.delta as { type?: string; thinking?: string };
        if (delta.type === 'thinking_delta' && delta.thinking?.trim()) {
          emit({ type: 'thinking', delta: scrubSecrets(delta.thinking) });
        }
      }
      const response = await stream.finalMessage();

      // Con output_config.format la respuesta es un text block con JSON puro
      // conforme al schema (salvo refusal o truncado por max_tokens).
      const jsonText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let parsed: unknown = null;
      if (response.stop_reason !== 'max_tokens' && jsonText.trim()) {
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          parsed = null;
        }
      }
      narrative = this.sanitizeNarrative(parsed);

      if (!narrative) {
        this.logger.warn(
          `[ExecSummary] attempt ${attempt} sin JSON válido (stop=${response.stop_reason}, chars=${jsonText.length})${attempt + 1 < MAX_ATTEMPTS ? ' — retry correctivo' : ''}`,
        );
      }
    }

    if (!narrative) {
      emit({
        type: 'error',
        message: 'El agente no produjo un resumen ejecutivo válido. Intenta de nuevo.',
      });
      finish();
      return;
    }

    // --- Persistencia + entrega. El nombre del generador es un snapshot
    // (igual que stagingApprovedByName): sobrevive renombres del usuario.
    const summary: ExecutiveSummary = {
      id: randomUUID(),
      initiativeId,
      metrics,
      narrative,
      generatedAt: new Date().toISOString(),
      generatedByName: user.name.trim() || user.email.trim() || undefined,
      model: MODEL,
    };

    await this.prisma.initiative.update({
      where: { id: initiativeId },
      data: { executiveSummary: summary as unknown as Prisma.InputJsonValue },
    });

    emit({ type: 'summary_ready', summary });
    emit({ type: 'run_finished', totalDurationMs: Date.now() - runStartTime });
    emit({ type: 'done' });
    subject.complete();
  }

  /**
   * Cliente Anthropic con la key resuelta en runtime — misma configuración
   * que epic-generation: timeout largo + dispatcher undici con bodyTimeout=0
   * para tolerar silencios del extended thinking.
   */
  private async buildClient(): Promise<Anthropic> {
    const apiKey = await this.orgAnthropic.getApiKeyPlaintext();
    return new Anthropic({
      apiKey,
      timeout: 30 * 60 * 1000,
      fetch: anthropicFetch,
    });
  }

  private buildSystemPrompt(): string {
    return `Eres un analista ejecutivo senior de un software factory. Tu trabajo: producir un resumen ejecutivo del estado de una iniciativa de software, dirigido a dirección general (no técnica).

## Reglas duras

- PROHIBIDO inventar números. Toda cifra que cites (porcentajes, conteos, story points, días, fechas) debe venir TEXTUAL del bloque <metrics>. Si una métrica no está ahí, no la menciones.
- El bloque <metrics> es la ÚNICA fuente de verdad cuantitativa. Los extractos de épicas y la descripción aportan contexto cualitativo (qué se construye y por qué), no cifras.
- Tono ejecutivo: directo, conciso, accionable. Sin jerga técnica innecesaria, sin relleno.
- Idioma: español.
- Entrega EXCLUSIVAMENTE via la tool submit_executive_summary. No emitas texto fuera de la tool.

## Semáforo de salud (health)

- on_track: el progreso está alineado al tiempo transcurrido y no hay bloqueos relevantes.
- at_risk: brecha moderada entre progreso y tiempo, o dependencias/bloqueos abiertos que amenazan el target.
- off_track: brecha severa, target vencido, o bloqueos críticos sin mitigación.

Justifica el semáforo en healthRationale citando las métricas que lo sustentan (ej: progreso vs % de tiempo transcurrido, historias bloqueadas, dependencias técnicas abiertas).

## Estructura esperada

- headline: UNA frase con el estado global de la iniciativa.
- overview: 1-3 párrafos markdown con la lectura general — avance, ritmo, concentración de riesgo.
- highlights: 3-5 puntos destacados (positivos o de atención), cada uno anclado a una métrica o hecho del contexto.
- risks: 0-5 riesgos reales. Si las métricas no muestran riesgos, deja el array vacío — no inventes.
- recommendations: 2-4 recomendaciones accionables para dirección (decisiones, no tareas técnicas).`;
  }

  private buildContextBlock(
    description: string,
    epics: Array<{ title: string; markdown: string }>,
    metrics: InitiativeMetrics,
  ): string {
    // Extracto por épica con cap global — iniciativas con decenas de épicas
    // no deben inflar el prompt más allá de ~40K chars.
    const excerpts: string[] = [];
    let usedChars = 0;
    for (const epic of epics) {
      if (usedChars >= EPIC_CONTEXT_CAP_CHARS) break;
      const body = (epic.markdown ?? '').trim().slice(0, EPIC_EXCERPT_CHARS);
      const block = `### ${epic.title}\n${body}`;
      if (usedChars + block.length > EPIC_CONTEXT_CAP_CHARS) break;
      excerpts.push(block);
      usedChars += block.length;
    }

    return [
      `<initiative_description>\n${description}\n</initiative_description>`,
      `<metrics>\n${JSON.stringify(metrics, null, 2)}\n</metrics>`,
      `<epic_excerpts>\n${excerpts.length > 0 ? excerpts.join('\n\n') : 'Sin épicas registradas.'}\n</epic_excerpts>`,
    ].join('\n\n');
  }

  /**
   * JSON schema del structured output (output_config.format) — mapea 1:1 a
   * ExecutiveSummaryNarrative. Requisitos de structured outputs: todos los
   * objetos llevan additionalProperties:false y sin constraints no soportados
   * (min/maxLength, min/maxItems) — los topes los aplica sanitizeNarrative.
   */
  private buildNarrativeSchema(): Record<string, unknown> {
    return {
      type: 'object' as const,
      properties: {
          headline: {
            type: 'string',
            description: 'Una sola frase ejecutiva que resume el estado de la iniciativa.',
          },
          health: {
            type: 'string',
            enum: ['on_track', 'at_risk', 'off_track'],
            description: 'Semáforo de salud de la iniciativa.',
          },
          healthRationale: {
            type: 'string',
            description:
              'Justificación breve del semáforo, citando las métricas que lo sustentan.',
          },
          overview: {
            type: 'string',
            description: '1-3 párrafos en markdown con la lectura ejecutiva general.',
          },
          highlights: {
            type: 'array',
            description: 'Entre 3 y 5 puntos destacados anclados a métricas o hechos del contexto.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                detail: { type: 'string' },
                tone: { type: 'string', enum: ['positive', 'neutral', 'warning'] },
              },
              required: ['title', 'detail', 'tone'],
              additionalProperties: false,
            },
          },
          risks: {
            type: 'array',
            description:
              'Entre 0 y 5 riesgos reales derivados de las métricas/contexto. Vacío si no hay.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                detail: { type: 'string' },
                severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                mitigation: { type: 'string', description: 'Mitigación sugerida (opcional).' },
              },
              required: ['title', 'detail', 'severity'],
              additionalProperties: false,
            },
          },
          recommendations: {
            type: 'array',
            description: 'Entre 2 y 4 recomendaciones accionables para dirección.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                detail: { type: 'string' },
              },
              required: ['title', 'detail'],
              additionalProperties: false,
            },
          },
        },
      required: [
        'headline',
        'health',
        'healthRationale',
        'overview',
        'highlights',
        'risks',
        'recommendations',
      ],
      additionalProperties: false,
    };
  }

  /**
   * Valida y capa el JSON crudo del structured output. Devuelve null si faltan los
   * campos esenciales (headline/health/overview/rationale) — eso dispara el
   * retry correctivo en el caller. Los arrays toleran ítems malformados
   * (se descartan) y se capan a MAX_ARRAY_ITEMS.
   */
  private sanitizeNarrative(raw: unknown): ExecutiveSummaryNarrative | null {
    if (raw === null || typeof raw !== 'object') return null;
    const input = raw as Record<string, unknown>;

    const headline = typeof input.headline === 'string' ? input.headline.trim() : '';
    const healthRationale =
      typeof input.healthRationale === 'string' ? input.healthRationale.trim() : '';
    const overview = typeof input.overview === 'string' ? input.overview.trim() : '';
    const health = HEALTH_VALUES.find((h) => h === input.health);

    if (!headline || !healthRationale || !overview || !health) return null;

    return {
      headline: capStr(headline, MAX_TITLE_LEN),
      health,
      healthRationale: capStr(healthRationale, MAX_FIELD_LEN),
      overview: capStr(overview, MAX_FIELD_LEN),
      highlights: this.sanitizeHighlights(input.highlights),
      risks: this.sanitizeRisks(input.risks),
      recommendations: this.sanitizeRecommendations(input.recommendations),
    };
  }

  private sanitizeHighlights(raw: unknown): ExecutiveSummaryHighlight[] {
    if (!Array.isArray(raw)) return [];
    const out: ExecutiveSummaryHighlight[] = [];
    for (const item of raw.slice(0, MAX_ARRAY_ITEMS)) {
      const fields = this.extractTitleDetail(item);
      if (!fields) continue;
      const record = item as Record<string, unknown>;
      const tone = TONE_VALUES.find((t) => t === record.tone) ?? 'neutral';
      out.push({ ...fields, tone });
    }
    return out;
  }

  private sanitizeRisks(raw: unknown): ExecutiveSummaryRisk[] {
    if (!Array.isArray(raw)) return [];
    const out: ExecutiveSummaryRisk[] = [];
    for (const item of raw.slice(0, MAX_ARRAY_ITEMS)) {
      const fields = this.extractTitleDetail(item);
      if (!fields) continue;
      const record = item as Record<string, unknown>;
      const severity = SEVERITY_VALUES.find((s) => s === record.severity) ?? 'medium';
      const mitigation =
        typeof record.mitigation === 'string' && record.mitigation.trim()
          ? capStr(record.mitigation.trim(), MAX_FIELD_LEN)
          : undefined;
      out.push({ ...fields, severity, ...(mitigation ? { mitigation } : {}) });
    }
    return out;
  }

  private sanitizeRecommendations(raw: unknown): ExecutiveSummaryRecommendation[] {
    if (!Array.isArray(raw)) return [];
    const out: ExecutiveSummaryRecommendation[] = [];
    for (const item of raw.slice(0, MAX_ARRAY_ITEMS)) {
      const fields = this.extractTitleDetail(item);
      if (fields) out.push(fields);
    }
    return out;
  }

  /** Par {title, detail} validado y capado — común a los 3 tipos de ítem. */
  private extractTitleDetail(item: unknown): { title: string; detail: string } | null {
    if (item === null || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
    if (!title || !detail) return null;
    return { title: capStr(title, MAX_TITLE_LEN), detail: capStr(detail, MAX_FIELD_LEN) };
  }
}
