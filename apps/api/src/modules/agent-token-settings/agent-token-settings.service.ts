import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  type AgentEffortLevel,
  type AgentTokenSettings as AgentTokenSettingsPublic,
  DEFAULT_AGENT_TOKEN_SETTINGS,
} from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'singleton';

/**
 * Cache TTL del row singleton. 30s evita golpear PG en cada request a un
 * agente IA. Suficientemente bajo para que un cambio en UI se vea reflejado
 * pronto en runs nuevos.
 */
const CACHE_TTL_MS = 30_000;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

@Injectable()
export class AgentTokenSettingsService {
  private readonly logger = new Logger(AgentTokenSettingsService.name);
  private cached: { value: AgentTokenSettingsPublic; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
      this.logger.log(
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
  async getStoryPo(): Promise<{ effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { effort: s.storyPoEffort, maxTokens: s.storyPoMaxTokens, enabled: s.storyPoThinkingEnabled };
  }

  async getStoryTl(): Promise<{ effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { effort: s.storyTlEffort, maxTokens: s.storyTlMaxTokens, enabled: s.storyTlThinkingEnabled };
  }

  async getStoryQa(): Promise<{ effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { effort: s.storyQaEffort, maxTokens: s.storyQaMaxTokens, enabled: s.storyQaThinkingEnabled };
  }

  async getEpic(): Promise<{ effort: AgentEffortLevel; maxTokensCap: number; enabled: boolean }> {
    const s = await this.get();
    return { effort: s.epicEffort, maxTokensCap: s.epicMaxTokens, enabled: s.epicThinkingEnabled };
  }

  async getDiagram(): Promise<{ effort: AgentEffortLevel; maxTokens: number; enabled: boolean }> {
    const s = await this.get();
    return { effort: s.diagramEffort, maxTokens: s.diagramMaxTokens, enabled: s.diagramThinkingEnabled };
  }

  // ─────────────────────────────────────────────────────────────────────

  private toPublic(row: {
    storyPoEffort: string;
    storyPoMaxTokens: number;
    storyPoThinkingEnabled: boolean;
    storyTlEffort: string;
    storyTlMaxTokens: number;
    storyTlThinkingEnabled: boolean;
    storyQaEffort: string;
    storyQaMaxTokens: number;
    storyQaThinkingEnabled: boolean;
    epicEffort: string;
    epicMaxTokens: number;
    epicThinkingEnabled: boolean;
    diagramEffort: string;
    diagramMaxTokens: number;
    diagramThinkingEnabled: boolean;
    updatedAt: Date;
    updatedBy: string | null;
  }): AgentTokenSettingsPublic {
    // Cast de string→AgentEffortLevel: el DTO ya valida, así que el row solo
    // contiene valores válidos. Defense in depth: si hay basura legacy en BD,
    // defaulteamos a 'medium' (cambio 2026-05-04: antes era 'high', ahora
    // medium balancea calidad vs costo — high duplica thinking tokens).
    const effort = (s: string): AgentEffortLevel =>
      s === 'low' || s === 'medium' || s === 'high' ? s : 'medium';

    return {
      storyPoEffort: effort(row.storyPoEffort),
      storyPoMaxTokens: row.storyPoMaxTokens,
      storyPoThinkingEnabled: row.storyPoThinkingEnabled,
      storyTlEffort: effort(row.storyTlEffort),
      storyTlMaxTokens: row.storyTlMaxTokens,
      storyTlThinkingEnabled: row.storyTlThinkingEnabled,
      storyQaEffort: effort(row.storyQaEffort),
      storyQaMaxTokens: row.storyQaMaxTokens,
      storyQaThinkingEnabled: row.storyQaThinkingEnabled,
      epicEffort: effort(row.epicEffort),
      epicMaxTokens: row.epicMaxTokens,
      epicThinkingEnabled: row.epicThinkingEnabled,
      diagramEffort: effort(row.diagramEffort),
      diagramMaxTokens: row.diagramMaxTokens,
      diagramThinkingEnabled: row.diagramThinkingEnabled,
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
