import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  AGENT_TOKEN_BOUNDS,
  type AgentEffortLevel,
  type AgentTokenSettings as AgentTokenSettingsPublic,
  DEFAULT_AGENT_TOKEN_SETTINGS,
  DEFAULT_PROJECT_AGENT_MODEL,
  FORGE_WORKER_EFFORT_LEVELS,
  FORGE_WORKER_MODELS,
  type ForgeWorkerEffortLevel,
  type ForgeWorkerModel,
  PROJECT_AGENT_MODELS,
  type ProjectAgentModel,
} from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const SINGLETON_ID = 'singleton';

/**
 * Cache TTL del row singleton. 30s evita golpear PG en cada request a un
 * agente IA. Suficientemente bajo para que un cambio en UI se vea reflejado
 * pronto en runs nuevos.
 */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class AgentTokenSettingsService {
  private cached: { value: AgentTokenSettingsPublic; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService,
    @InjectPinoLogger(AgentTokenSettingsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Lee la configuración (cached). Auto-inicializa el singleton si no existe.
   */
  async get(): Promise<AgentTokenSettingsPublic> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const row = await this.prisma.agentTokenSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
    const value = this.toPublic(row);
    this.cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  /**
   * Update parcial. Sin cross-field validation porque adaptive thinking no
   * tiene la restricción `maxTokens > thinking_budget` del shape legacy —
   * el effort es independiente del cap de tokens.
   *
   * Read + write en una transacción Serializable para evitar lost updates
   * entre PATCHes concurrentes (P2034 → 400 con mensaje de retry).
   */
  async update(
    patch: Partial<Omit<AgentTokenSettingsPublic, 'updatedAt' | 'updatedBy'>>,
    updatedBy: string | null,
  ): Promise<AgentTokenSettingsPublic> {
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          // Auto-crea singleton si no existe.
          await tx.agentTokenSettings.upsert({
            where: { id: SINGLETON_ID },
            create: { id: SINGLETON_ID },
            update: {},
          });

          // Aplicar patch tal cual — no hay invariantes cross-field a validar.
          return await tx.agentTokenSettings.update({
            where: { id: SINGLETON_ID },
            data: { ...patch, updatedBy: updatedBy ?? null },
          });
        },
        { isolationLevel: 'Serializable' },
      );

      this.cached = null;
      this.logger.info(
        `[AgentTokenSettings] updated by=${updatedBy ?? 'anon'} fields=${Object.keys(patch).join(',')}`,
      );
      return this.toPublic(row);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2034') {
        throw new BadRequestException(
          'Conflicto de concurrencia al guardar — otro usuario actualizó al mismo tiempo. Reintenta.',
        );
      }
      throw err;
    }
  }

  /**
   * Helpers tipados para que cada service de agente lea solo lo suyo.
   * Cada uno retorna `{ effort, maxTokens, enabled }`. Cuando `enabled=false`,
   * el caller NO debe enviar `thinking: { type: 'adaptive' }` ni
   * `output_config.effort` al SDK de Anthropic.
   */
  async getStoryPo(): Promise<{ model: ProjectAgentModel; effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { model: s.storyPoModel, effort: s.storyPoEffort, maxTokens: s.storyPoMaxTokens, enabled: s.storyPoThinkingEnabled };
  }

  async getStoryTl(): Promise<{ model: ProjectAgentModel; effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { model: s.storyTlModel, effort: s.storyTlEffort, maxTokens: s.storyTlMaxTokens, enabled: s.storyTlThinkingEnabled };
  }

  async getStoryQa(): Promise<{ model: ProjectAgentModel; effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { model: s.storyQaModel, effort: s.storyQaEffort, maxTokens: s.storyQaMaxTokens, enabled: s.storyQaThinkingEnabled };
  }

  async getEpic(): Promise<{ model: ProjectAgentModel; effort: AgentEffortLevel; maxTokensCap: number; enabled: boolean }> {
    const s = await this.get();
    return { model: s.epicModel, effort: s.epicEffort, maxTokensCap: s.epicMaxTokens, enabled: s.epicThinkingEnabled };
  }

  async getDiagram(): Promise<{ model: ProjectAgentModel; effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { model: s.diagramModel, effort: s.diagramEffort, maxTokens: s.diagramMaxTokens, enabled: s.diagramThinkingEnabled };
  }

  async getAssistant(): Promise<{ model: ProjectAgentModel; effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { model: s.assistantModel, effort: s.assistantEffort, maxTokens: s.assistantMaxTokens, enabled: s.assistantThinkingEnabled };
  }

  /**
   * Helper para el DoD Verifier (reviewer agent). Análogo a getForgeWorker
   * pero para el verifier que evalúa los criterios DoD post-spawn del coder.
   * El worker pasa los valores como override al `runVerifierAgent` y
   * `runVerifierAgentBatch` (fallback a env vars DOD_VERIFIER_MODEL/EFFORT).
   */
  async getDodVerifier(): Promise<{
    model: ForgeWorkerModel;
    effort: ForgeWorkerEffortLevel;
    /** Tope de intentos del DoD enforcement loop del worker. */
    maxAttempts: number;
  }> {
    // No log aquí — el worker emite `dod.verifier_agent.spawn_config` con el
    // valor autoritativo aplicado al spawn del verifier. Loggear el read
    // backend genera ruido redundante (cleanup 2026-05-19).
    const s = await this.get();
    return {
      model: s.dodVerifierModel,
      effort: s.dodVerifierEffort,
      maxAttempts: s.dodMaxAttempts,
    };
  }

  /**
   * Helper para el Forge Worker (coder agent). Retorna model + effort para
   * que `agent-run.service.ts:claimStory` lo incluya en la response al worker.
   * El worker pasa estos valores al CLI `claude` via `--model` y `--effort`.
   */
  async getForgeWorker(): Promise<{
    model: ForgeWorkerModel;
    effort: ForgeWorkerEffortLevel;
    maxRunDurationMs: number;
  }> {
    // No log aquí — el worker emite `Spawning claude with model=... source=backend`
    // con el valor autoritativo aplicado. El log del lado backend es redundante
    // (cleanup 2026-05-19).
    const s = await this.get();
    return {
      model: s.forgeWorkerModel,
      effort: s.forgeWorkerEffort,
      // Reemplaza el MAX_RUN_DURATION_MS hardcoded del worker (runner.ts:145).
      // Si el worker recibe valor 0/null, cae al default 30 min en su lado.
      maxRunDurationMs: s.forgeWorkerMaxRunDurationMs,
    };
  }

  // ─────────────────────────────────────────────────────────────────────

  private toPublic(row: {
    storyPoModel: string;
    storyPoEffort: string;
    storyPoMaxTokens: number;
    storyPoThinkingEnabled: boolean;
    storyTlModel: string;
    storyTlEffort: string;
    storyTlMaxTokens: number;
    storyTlThinkingEnabled: boolean;
    storyQaModel: string;
    storyQaEffort: string;
    storyQaMaxTokens: number;
    storyQaThinkingEnabled: boolean;
    epicModel: string;
    epicEffort: string;
    epicMaxTokens: number;
    epicThinkingEnabled: boolean;
    diagramModel: string;
    diagramEffort: string;
    diagramMaxTokens: number;
    diagramThinkingEnabled: boolean;
    assistantModel: string;
    assistantEffort: string;
    assistantMaxTokens: number;
    assistantThinkingEnabled: boolean;
    forgeWorkerModel: string;
    forgeWorkerEffort: string;
    forgeWorkerMaxRunDurationMs: number;
    dodVerifierModel: string;
    dodVerifierEffort: string;
    dodMaxAttempts: number;
    updatedAt: Date;
    updatedBy: string | null;
  }): AgentTokenSettingsPublic {
    // Cast de string→AgentEffortLevel: el DTO ya valida, así que el row solo
    // contiene valores válidos. Defense in depth: si hay basura legacy en BD,
    // defaulteamos a 'medium' (cambio 2026-05-04: antes era 'high', ahora
    // medium balancea calidad vs costo — high duplica thinking tokens).
    const effort = (s: string): AgentEffortLevel =>
      s === 'low' || s === 'medium' || s === 'high' ? s : 'medium';

    // Cast model→ProjectAgentModel. El DTO valida en write; defense in depth
    // al leer: si la BD trae un id fuera de la whitelist (downgrade del
    // catálogo, SQL directo), default al modelo calibrado (Sonnet 4.6).
    const projectModel = (s: string): ProjectAgentModel =>
      (PROJECT_AGENT_MODELS as readonly string[]).includes(s)
        ? (s as ProjectAgentModel)
        : DEFAULT_PROJECT_AGENT_MODEL;

    // Casts para Forge Worker — set de modelos + efforts más amplio que los
    // agentes story-gen (acepta xhigh/max + opus). Defense in depth: si la
    // BD tiene valor inválido por algún downgrade, default a Sonnet + high.
    const forgeModel = (s: string): ForgeWorkerModel =>
      (FORGE_WORKER_MODELS as readonly string[]).includes(s)
        ? (s as ForgeWorkerModel)
        : 'claude-sonnet-4-6';
    const forgeEffort = (s: string): ForgeWorkerEffortLevel =>
      (FORGE_WORKER_EFFORT_LEVELS as readonly string[]).includes(s)
        ? (s as ForgeWorkerEffortLevel)
        : 'high';

    return {
      storyPoModel: projectModel(row.storyPoModel),
      storyPoEffort: effort(row.storyPoEffort),
      storyPoMaxTokens: row.storyPoMaxTokens,
      storyPoThinkingEnabled: row.storyPoThinkingEnabled,
      storyTlModel: projectModel(row.storyTlModel),
      storyTlEffort: effort(row.storyTlEffort),
      storyTlMaxTokens: row.storyTlMaxTokens,
      storyTlThinkingEnabled: row.storyTlThinkingEnabled,
      storyQaModel: projectModel(row.storyQaModel),
      storyQaEffort: effort(row.storyQaEffort),
      storyQaMaxTokens: row.storyQaMaxTokens,
      storyQaThinkingEnabled: row.storyQaThinkingEnabled,
      epicModel: projectModel(row.epicModel),
      epicEffort: effort(row.epicEffort),
      epicMaxTokens: row.epicMaxTokens,
      epicThinkingEnabled: row.epicThinkingEnabled,
      diagramModel: projectModel(row.diagramModel),
      diagramEffort: effort(row.diagramEffort),
      diagramMaxTokens: row.diagramMaxTokens,
      diagramThinkingEnabled: row.diagramThinkingEnabled,
      assistantModel: projectModel(row.assistantModel),
      assistantEffort: effort(row.assistantEffort),
      assistantMaxTokens: row.assistantMaxTokens,
      assistantThinkingEnabled: row.assistantThinkingEnabled,
      forgeWorkerModel: forgeModel(row.forgeWorkerModel),
      forgeWorkerEffort: forgeEffort(row.forgeWorkerEffort),
      // Clamp defensivo del max-run-duration al rango configurado en
      // AGENT_TOKEN_BOUNDS (5 min .. 2 h). Si la BD tuviera basura legacy
      // (e.g. 0 por una migración rota o un downgrade), default al
      // valor de DEFAULT_AGENT_TOKEN_SETTINGS (30 min).
      forgeWorkerMaxRunDurationMs: Math.min(
        AGENT_TOKEN_BOUNDS.forgeWorkerMaxRunDurationMs.max,
        Math.max(
          AGENT_TOKEN_BOUNDS.forgeWorkerMaxRunDurationMs.min,
          row.forgeWorkerMaxRunDurationMs > 0
            ? row.forgeWorkerMaxRunDurationMs
            : DEFAULT_AGENT_TOKEN_SETTINGS.forgeWorkerMaxRunDurationMs,
        ),
      ),
      // DoD verifier — mismo cast defensivo, defaults distintos (haiku+low
      // porque el verifier hace checks atómicos baratos).
      dodVerifierModel: forgeModel(row.dodVerifierModel),
      dodVerifierEffort: forgeEffort(row.dodVerifierEffort),
      // Clamp defensivo 1..3 — defense in depth contra basura en BD; el
      // valor gobierna un loop, un número salvaje quemaría tokens.
      dodMaxAttempts: Math.min(3, Math.max(1, row.dodMaxAttempts)),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  }

  /**
   * Mantenemos `_DEFAULTS` accesible para tests/debugging.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly _defaults = DEFAULT_AGENT_TOKEN_SETTINGS;
}
