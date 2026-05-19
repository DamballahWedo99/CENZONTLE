import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { GitHubService } from '../github/github.service';
import { AGENT_RUN_ACTIVE_STATUSES, AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { UpdateBranchStrategyDto } from './dto/update-branch-strategy.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

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
  private static readonly SINGLETON_ID = 'global';

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly auth: AuthService,
    @InjectPinoLogger(BranchStrategyService.name) private readonly logger: PinoLogger,
  ) {}

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
    this.logger.info(
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

    this.logger.info(
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
    this.logger.info(
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
      this.logger.info({ triggeredBy }, `[FORGE ABORT] no había runs activos. by=${triggeredBy}`);
    }

    return result.count;
  }

  /**
   * Valida el git state actual contra la configuración: verifica que las
   * branches `devBranch` y `mainBranch` existen en remote y que comparten
   * historia (ancestro común). Sin esto, el `consolidated PR` del Forge a
   * DEV falla con "No common ancestor" — diagnóstico común tras setup
   * inicial donde el operador crea `dev` como branch huérfana.
   *
   * NO throw — retorna el estado completo + un mensaje `warning` legible
   * para que el frontend muestre un banner accionable con botón "Alinear".
   *
   * Si no hay repo configurado (sandbox real), retorna `repoConfigured=false`
   * y el frontend oculta el banner.
   */
  async validateGitState(): Promise<{
    repoConfigured: boolean;
    devBranch: string;
    mainBranch: string;
    devExists: boolean;
    mainExists: boolean;
    devSha: string | null;
    mainSha: string | null;
    /** Status del compare main...dev. NULL si alguna branch no existe. */
    compareStatus:
      | 'identical'
      | 'ahead'
      | 'behind'
      | 'diverged'
      | 'no_common_ancestor'
      | 'missing_branch'
      | null;
    /** True si dev y main comparten historia (cualquier compare status válido). */
    sharesHistory: boolean;
    /** Mensaje accionable para mostrar al user. NULL si todo está OK. */
    warning: string | null;
    /** True si la acción "Alinear dev con main" tiene sentido en este estado
     *  (i.e., hay un problema arreglable con force-update). */
    canAlignDev: boolean;
  }> {
    const config = await this.getOrInitDefault();

    const repoInfo = await this.github.getActiveRepoInfo();
    if (!repoInfo) {
      return {
        repoConfigured: false,
        devBranch: config.devBranch,
        mainBranch: config.mainBranch,
        devExists: false,
        mainExists: false,
        devSha: null,
        mainSha: null,
        compareStatus: null,
        sharesHistory: false,
        warning: null,
        canAlignDev: false,
      };
    }

    // Lookup paralelo de ambas branches — más rápido que secuencial.
    const [devHead, mainHead] = await Promise.all([
      this.github.getBranchHead(config.devBranch),
      this.github.getBranchHead(config.mainBranch),
    ]);

    // Casos terminales antes del compare:
    if (!mainHead.exists) {
      return {
        repoConfigured: true,
        devBranch: config.devBranch,
        mainBranch: config.mainBranch,
        devExists: devHead.exists,
        mainExists: false,
        devSha: devHead.sha,
        mainSha: null,
        compareStatus: 'missing_branch',
        sharesHistory: false,
        warning: `La branch "${config.mainBranch}" no existe en el repo. Créala antes de continuar — sin ella el Forge no puede operar.`,
        canAlignDev: false,
      };
    }
    if (!devHead.exists) {
      return {
        repoConfigured: true,
        devBranch: config.devBranch,
        mainBranch: config.mainBranch,
        devExists: false,
        mainExists: true,
        devSha: null,
        mainSha: mainHead.sha,
        compareStatus: 'missing_branch',
        sharesHistory: false,
        warning: `La branch "${config.devBranch}" no existe en el repo. El Forge intentará crearla desde "${config.mainBranch}" al encolar la primera épica, o puedes crearla manualmente desde la UI.`,
        canAlignDev: true,
      };
    }

    const compare = await this.github.compareBranches({
      base: config.mainBranch,
      head: config.devBranch,
    });

    const sharesHistory =
      compare.status !== 'no_common_ancestor' && compare.status !== 'missing_branch';

    let warning: string | null = null;
    let canAlignDev = false;
    if (compare.status === 'no_common_ancestor') {
      warning =
        `La branch "${config.devBranch}" no comparte historia con "${config.mainBranch}" ` +
        `(creada como rama huérfana). El consolidated PR del Forge a "${config.devBranch}" fallará ` +
        `con "No common ancestor". Alinea "${config.devBranch}" con "${config.mainBranch}" para arreglarlo.`;
      canAlignDev = true;
    }

    return {
      repoConfigured: true,
      devBranch: config.devBranch,
      mainBranch: config.mainBranch,
      devExists: true,
      mainExists: true,
      devSha: devHead.sha,
      mainSha: mainHead.sha,
      compareStatus: compare.status,
      sharesHistory,
      warning,
      canAlignDev,
    };
  }

  /**
   * Alinea la branch `devBranch` con `mainBranch` via force-update — DESTRUCTIVO,
   * descarta cualquier historia única de `dev`. Requiere step-up auth (password
   * actual contra Auth0) + rol TechLead o AltaGerencia.
   *
   * Caso de uso típico: tras setup inicial donde `dev` fue creada como branch
   * huérfana (`git checkout --orphan dev`) y por lo tanto no comparte historia
   * con `main`. El consolidated PR del Forge no puede mergearse en ese estado.
   *
   * Persiste ChangelogEntry para audit trail — quién alineó qué y cuándo.
   */
  async alignDevWithMain(
    user: AuthenticatedUser,
    password: string,
  ): Promise<{
    devBranch: string;
    mainBranch: string;
    previousDevSha: string | null;
    newDevSha: string;
    alignedAt: string;
    alignedByName: string;
  }> {
    // Role check: TechLead o AltaGerencia. Defense in depth — la action
    // es destructiva (descarta commits) aunque el typical use-case sea
    // recuperar de un setup defectuoso.
    if (user.role !== UserRole.TechLead && user.role !== UserRole.AltaGerencia) {
      throw new ForbiddenException(
        'Solo Tech Lead o Alta Gerencia pueden alinear la branch dev — la operación es destructiva.',
      );
    }

    const config = await this.getOrInitDefault();

    // Verify repo configured antes de step-up auth — evita costo de Auth0
    // call cuando la acción no podría ejecutarse de todos modos.
    const repoInfo = await this.github.getActiveRepoInfo();
    if (!repoInfo) {
      throw new NotFoundException(
        'No hay code repository configurado. Activa un repo en /factory/settings → Código antes de alinear branches.',
      );
    }

    // Snapshot del estado actual ANTES del step-up (necesitamos mainSha para
    // hacer el update; necesitamos devSha actual para el changelog).
    const [devHead, mainHead] = await Promise.all([
      this.github.getBranchHead(config.devBranch),
      this.github.getBranchHead(config.mainBranch),
    ]);
    if (!mainHead.exists || !mainHead.sha) {
      throw new NotFoundException(
        `La branch "${config.mainBranch}" no existe en el repo — no podemos usarla como source de la alineación.`,
      );
    }

    // Step-up auth — validates password contra Auth0. Throw 401 si falla.
    await this.auth.assertPasswordValid(user, password);

    const previousDevSha = devHead.sha;
    const userName = user.name ?? user.email ?? user.sub;

    // Force-update. Si dev no existía, octokit returna 422 — nuestro fallback:
    // crear la branch desde scratch con el SHA de main.
    let newSha: string;
    try {
      const result = await this.github.forceUpdateBranch(config.devBranch, mainHead.sha);
      newSha = result.sha;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 422 && !devHead.exists) {
        // Branch no existía — crearla en lugar de update.
        const created = await this.github.createIntegrationBranch({
          branchName: config.devBranch,
          devBranch: config.mainBranch,
          epicId: 'manual-align',
        });
        newSha = created.baseSha;
      } else {
        throw err;
      }
    }

    // Audit trail. Sin entityType específico para "config global" — usamos
    // 'branch_strategy' como tipo lógico.
    await this.prisma.changelogEntry.create({
      data: {
        entityType: 'branch_strategy',
        entityId: BranchStrategyService.SINGLETON_ID,
        entityTitle: `${repoInfo.owner}/${repoInfo.repo}`,
        action: 'aligned',
        field: config.devBranch,
        oldValue: previousDevSha ?? '(branch no existía)',
        newValue: newSha,
        changedById: user.sub,
        changedByName: userName,
      },
    });

    this.logger.warn(
      `[branch-strategy] align: "${config.devBranch}" reseteado a "${config.mainBranch}" ` +
        `@${newSha.slice(0, 7)} (antes ${previousDevSha?.slice(0, 7) ?? 'no existía'}) by=${userName}`,
    );

    return {
      devBranch: config.devBranch,
      mainBranch: config.mainBranch,
      previousDevSha,
      newDevSha: newSha,
      alignedAt: new Date().toISOString(),
      alignedByName: userName,
    };
  }
}
