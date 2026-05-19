import {
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ComputeNodeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Modos de ejecución del Forge:
 *
 *  - `local-tmux`: spawn Claude Code en el mismo proceso del backend via
 *    `terminal.service.ts` (asume host con tmux + ttyd). Modo legacy/dev.
 *
 *  - `remote-worker`: dispatch a `ComputeNode` via el sistema de claim del
 *    fleet. El worker en otra máquina hace claim-story, spawn Claude Code
 *    headless, y reporta back. Modo producción.
 */
export type ExecutionMode = 'local-tmux' | 'remote-worker';

/**
 * Service que decide dónde ejecutar el trabajo del Forge: local en el host
 * del backend (modo dev) o remoto en un nodo del fleet (modo producción).
 *
 * La decisión se basa en:
 *  1. Override explícito vía env var `FORGE_EXECUTION_MODE`
 *     (`local` | `remote` | undefined)
 *  2. Si no hay override: si hay ≥1 nodo online, usa `remote-worker`;
 *     si no, fallback a `local-tmux`.
 *
 * Esto permite que un dev sin nodos remotos siga teniendo flow funcional
 * (modo legacy) y que producción haga remote automático cuando hay flota.
 *
 * AUDIT TRAIL (security-reviewer F-07 2026-05-06): cuando el override
 * está activo, emitimos:
 *  - WARN log al boot (banner visible en logs de arranque)
 *  - WARN log en cada `route()` (operador entiende por qué cambió la
 *    decisión cuando esperaba auto-detect)
 *  - 1 fila de ChangelogEntry al boot por cada arranque del proceso
 *    (auditable desde el dashboard "/proyectos/changelog" sin tocar
 *    los logs del host, así un atacante con shell pero sin DB write
 *    no puede flippar el modo invisible).
 */
@Injectable()
export class ExecutionRouterService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectPinoLogger(ExecutionRouterService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Hook de NestJS — corre una vez por arranque del proceso. Si hay
   * override activo, emite el audit row en `changelog_entries`.
   *
   * Si la inserción falla (DB down al boot), NO bloqueamos el arranque
   * — solo loguamos error. El WARN sigue activo en cada `route()`.
   */
  async onModuleInit(): Promise<void> {
    const override = this.config.get<string>('FORGE_EXECUTION_MODE');
    if (!override) {
      this.logger.info(
        '[router:boot] FORGE_EXECUTION_MODE no configurado — auto-detect activo (remote si hay nodos online, local si no)',
      );
      return;
    }

    const normalized = override.toLowerCase();
    if (normalized !== 'local' && normalized !== 'remote') {
      this.logger.error(
        `[router:boot] FORGE_EXECUTION_MODE="${override}" inválido — solo 'local' o 'remote'. Ignorando override; auto-detect activo.`,
      );
      return;
    }

    this.logger.warn(
      `[router:boot] ⚠️  FORGE_EXECUTION_MODE=${normalized} OVERRIDE ACTIVO — el auto-detect del fleet está bypaseado. Verifica que esto sea intencional.`,
    );

    try {
      await this.prisma.changelogEntry.create({
        data: {
          entityType: 'forge_execution_router',
          entityId: 'global',
          entityTitle: 'Forge Execution Router',
          action: 'override_active_at_boot',
          field: 'FORGE_EXECUTION_MODE',
          oldValue: null,
          newValue: normalized,
          changedById: 'system:forge-router',
          changedByName: 'Forge Execution Router (boot)',
        },
      });
      this.logger.info(
        `[router:boot] Audit row emitida en changelog_entries (override=${normalized})`,
      );
    } catch (err) {
      // No crash al boot — solo log. El admin verá el WARN del banner.
      this.logger.error(
        `[router:boot] Failed to emit audit changelog row: ${(err as Error).message.slice(0, 120)}`,
      );
    }
  }

  /**
   * Decide el modo de ejecución para el momento actual. NO está cached —
   * cada llamada consulta DB para reflejar cambios de fleet en tiempo real.
   * Cost: 1 SELECT count(*) sobre `compute_nodes` con índice `[status, retiredAt]`.
   */
  async route(): Promise<ExecutionMode> {
    const override = this.config.get<string>('FORGE_EXECUTION_MODE');

    if (override === 'local') {
      // WARN (no debug): override es estado anómalo y vale la pena que
      // sea visible en cada decisión. El auditor puede grep "router:override"
      // en los logs y reconstruir la timeline.
      this.logger.warn(`[router:override] mode=local-tmux (FORGE_EXECUTION_MODE=local)`);
      return 'local-tmux';
    }
    if (override === 'remote') {
      this.logger.warn(`[router:override] mode=remote-worker (FORGE_EXECUTION_MODE=remote)`);
      return 'remote-worker';
    }

    // Auto-detect: ¿hay nodos online?
    const onlineCount = await this.prisma.computeNode.count({
      where: { status: ComputeNodeStatus.online, retiredAt: null },
    });

    const mode: ExecutionMode = onlineCount > 0 ? 'remote-worker' : 'local-tmux';
    this.logger.debug({ mode, onlineCount }, `[router] mode=${mode} onlineNodes=${onlineCount}`);
    return mode;
  }
}
