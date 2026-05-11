import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AGENT_RUN_ACTIVE_STATUSES } from '@cenzontle/shared';
import { UpdateBranchStrategyDto } from './dto/update-branch-strategy.dto';

/**
 * Service singleton para gestionar la configuración del modelo de branches
 * que el Forge usa al crear integration branches y abrir PRs.
 *
 * Modelo `BranchStrategyConfig` con PK fija `id='global'` — siempre 1 fila.
 *
 * Uso:
 *  - Frontend muestra/edita en /factory/settings → "Estrategia de ramas"
 *  - GitHubService consume esto al crear forge branches y al abrir PRs
 *    consolidados a DEV
 *  - El consumer SIEMPRE debe llamar `getOrInitDefault()` — NO asumir
 *    que la fila existe (primer arranque de un dashboard nuevo)
 */
@Injectable()
export class BranchStrategyService {
  private readonly logger = new Logger(BranchStrategyService.name);
  private static readonly SINGLETON_ID = 'global';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lee la configuración. Si no existe (primer arranque), crea la fila
   * con defaults y la devuelve. Idempotente.
   *
   * Defaults: devBranch='dev', mainBranch='main',
   * forgeBranchPrefix='forge/sprint-batch-', autoDeleteForgeBranch=true.
   */
  async getOrInitDefault() {
    const existing = await this.prisma.branchStrategyConfig.findUnique({
      where: { id: BranchStrategyService.SINGLETON_ID },
    });
    if (existing) return existing;

    // Primer acceso → seed con defaults del schema. Devuelve la fila recién
    // creada para que el caller no tenga que hacer un segundo SELECT.
    const created = await this.prisma.branchStrategyConfig.create({
      data: { id: BranchStrategyService.SINGLETON_ID },
    });
    this.logger.log(
      `[branch-strategy] seeded defaults: devBranch=${created.devBranch} mainBranch=${created.mainBranch}`,
    );
    return created;
  }

  /**
   * Actualiza solo los campos provistos en el DTO. Patch semántica —
   * lo que sea undefined se mantiene como estaba.
   *
   * @param dto Campos a actualizar
   * @param updatedBy Auth0 sub del user que cambió la config (audit trail)
   */
  async update(dto: UpdateBranchStrategyDto, updatedBy: string) {
    // Asegura que la fila exista antes del update (idempotente al primer
    // uso post-deploy en un dashboard sin la config seeded).
    await this.getOrInitDefault();

    const updated = await this.prisma.branchStrategyConfig.update({
      where: { id: BranchStrategyService.SINGLETON_ID },
      data: {
        ...(dto.devBranch !== undefined && { devBranch: dto.devBranch }),
        ...(dto.mainBranch !== undefined && { mainBranch: dto.mainBranch }),
        ...(dto.forgeBranchPrefix !== undefined && {
          forgeBranchPrefix: dto.forgeBranchPrefix,
        }),
        ...(dto.autoDeleteForgeBranch !== undefined && {
          autoDeleteForgeBranch: dto.autoDeleteForgeBranch,
        }),
        updatedBy,
      },
    });

    this.logger.log(
      `[branch-strategy] updated by=${updatedBy} devBranch=${updated.devBranch} mainBranch=${updated.mainBranch} prefix=${updated.forgeBranchPrefix} autoDelete=${updated.autoDeleteForgeBranch}`,
    );

    return updated;
  }

  /**
   * KILL SWITCH — pausa el Forge a nivel de DB. Cuando esto está true,
   * `claimStory` retorna null sin importar el resto del estado.
   *
   * Persistido en DB → no depende de env vars (que turbo puede filtrar
   * silenciosamente si globalPassThroughEnv no está configurado).
   *
   * @param reason Texto opcional para audit trail (ej: "incidente prod",
   *               "validando setup")
   */
  async pause(updatedBy: string, reason?: string) {
    await this.getOrInitDefault();
    const updated = await this.prisma.branchStrategyConfig.update({
      where: { id: BranchStrategyService.SINGLETON_ID },
      data: {
        forgePaused: true,
        forgePausedAt: new Date(),
        forgePausedBy: updatedBy,
        forgePausedReason: reason ?? null,
      },
    });
    this.logger.warn(
      `[FORGE PAUSED] by=${updatedBy} reason="${reason ?? 'sin razón'}". claim-story bloqueado a partir de ahora.`,
    );
    return updated;
  }

  /**
   * Reanuda el Forge — claim-story vuelve a procesar requests normalmente.
   */
  async resume(updatedBy: string) {
    await this.getOrInitDefault();
    const updated = await this.prisma.branchStrategyConfig.update({
      where: { id: BranchStrategyService.SINGLETON_ID },
      data: {
        forgePaused: false,
        forgePausedAt: null,
        forgePausedBy: null,
        forgePausedReason: null,
      },
    });
    this.logger.log(
      `[FORGE RESUMED] by=${updatedBy}. claim-story aceptando requests normalmente.`,
    );
    return updated;
  }

  /**
   * EMERGENCY ABORT — marca TODOS los AgentRuns activos (claimed|running)
   * como 'abandoned' y resetea el `claimedAt` de las stories asociadas.
   *
   * Efecto secundario crítico: la próxima vez que el worker llame
   * `progress` o `complete` para esos runs, el backend devolverá 410
   * (run terminal). El worker, en su handler de 410, mata el proceso
   * `claude` con SIGTERM (ver runner.ts:progressTimer.catch). Resultado:
   * **el spawn de claude termina dentro de los próximos 30 segundos**
   * (siguiente tick de progress).
   *
   * Esto es el "stop de emergencia" cuando hay tokens consumiéndose
   * inadvertidamente. Combinado con `pause()`, garantiza que:
   *  1. Lo que está corriendo se mata (abort)
   *  2. Nada nuevo se reclama (pause)
   *
   * @returns Number de runs marcados como abandoned
   */
  async abortAllActiveRuns(triggeredBy: string, reason: string): Promise<number> {
    const now = new Date();
    const errorMsg = `Aborted by emergency stop: ${reason} (by=${triggeredBy})`;

    const result = await this.prisma.$transaction(async (tx) => {
      // Encuentra runs activos antes del update (necesitamos los storyIds)
      const activeRuns = await tx.agentRun.findMany({
        where: { status: { in: [...AGENT_RUN_ACTIVE_STATUSES] } },
        select: { id: true, storyId: true, nodeId: true },
      });
      if (activeRuns.length === 0) return { count: 0, runIds: [] as string[], storyIds: [] as string[] };

      const runIds = activeRuns.map((r) => r.id);
      const storyIds = activeRuns.map((r) => r.storyId);

      // Idempotente: filter status para no sobreescribir terminales
      // mientras corre el transaction.
      await tx.agentRun.updateMany({
        where: {
          id: { in: runIds },
          status: { in: [...AGENT_RUN_ACTIVE_STATUSES] },
        },
        data: {
          status: 'abandoned',
          completedAt: now,
          errorMessage: errorMsg,
        },
      });

      // Resetea claimedAt para que (cuando el operador reanude) las stories
      // puedan ser reclamadas de nuevo.
      await tx.story.updateMany({
        where: { id: { in: storyIds }, claimedAt: { not: null } },
        data: { claimedAt: null },
      });

      return { count: activeRuns.length, runIds, storyIds };
    });

    if (result.count > 0) {
      this.logger.warn(
        `[FORGE ABORT] ${result.count} runs marcados como abandoned by=${triggeredBy} reason="${reason}". ` +
          `Workers recibirán 410 en próximo progress (~30s) y matarán los procesos claude. ` +
          `runIds=[${result.runIds.map((r) => r.slice(0, 8)).join(',')}]`,
      );
    } else {
      this.logger.log(`[FORGE ABORT] no había runs activos. by=${triggeredBy}`);
    }

    return result.count;
  }
}
