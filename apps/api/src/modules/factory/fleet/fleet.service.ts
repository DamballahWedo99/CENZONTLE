import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ComputeNodeStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangelogService } from '../../proyectos/changelog/changelog.service';
import { FactoryAuthzService } from '../authz/factory-authz.service';
import { WorkerTokenService } from './worker-token.service';
import { CreateComputeNodeDto } from './dto/create-node.dto';
import { UpdateComputeNodeDto } from './dto/update-node.dto';
import { WorkerRegisterDto } from './dto/worker-register.dto';
import { WorkerHeartbeatDto } from './dto/worker-heartbeat.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Threshold en milisegundos. Si `lastHeartbeat` es más viejo, el sweeper
 * cron marca el nodo como `offline`. Default 90s = 3x el heartbeat interval
 * del worker (30s). Permite 2 heartbeats fallidos antes de degradar status.
 */
const STALE_HEARTBEAT_MS = 90_000;

/**
 * Service central del Fleet. Maneja:
 *  - CRUD humano de nodos (`createNode`, `listNodes`, etc.)
 *  - Registration y heartbeat de workers (`registerWorker`, `heartbeat`)
 *  - Sweeper de nodos sin heartbeat reciente (`sweepStaleNodes`)
 *
 * NO maneja claim-story todavía — eso es Sprint 2 con `AgentRun`.
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: WorkerTokenService,
    private readonly changelog: ChangelogService,
    private readonly config: ConfigService,
    private readonly authz: FactoryAuthzService,
    @InjectPinoLogger(FleetService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * URL canonical del API que el worker debe usar para conectar. La fuente
   * de verdad es el backend mismo, no el frontend (`window.location.origin`
   * apunta al frontend Next.js — el worker NO pasa por el BFF proxy y
   * necesita el host del API NestJS directo).
   *
   * Resolución:
   *  1. `PUBLIC_API_URL` env var (lo que ops configura en producción)
   *  2. Fallback `http://localhost:3001` (asume API dev local en ese puerto)
   *
   * Recordatorio: si `PUBLIC_API_URL` es HTTP, el worker rechazará la
   * conexión salvo que tenga `FACTORY_WORKER_ALLOW_INSECURE=1` (security-
   * reviewer F-01 Sprint 2). El frontend muestra una nota cuando esto aplica.
   */
  private getDashboardUrl(): string {
    return this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3001';
  }

  // ── Endpoints humanos (Auth0 JWT) ────────────────────────────────────

  /**
   * Lista nodos de la flota (no retired). Para AltaGerencia: todos. Para
   * otros roles: solo nodos creados por miembros de su pod (deferred a Mes 2
   * cuando agreguemos `ComputeNode.podId` — por ahora todos los roles
   * autenticados ven todos los nodos no-retired).
   */
  async listNodes() {
    const nodes = await this.prisma.computeNode.findMany({
      where: { retiredAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Deriva freshness en runtime — si `lastHeartbeat` es viejo, el status
    // efectivo es `offline` aunque el campo no se haya actualizado todavía
    // (el sweeper corre cada 5 min, pero el listing tiene que ser correcto
    // entre runs del cron).
    return nodes.map((n) => ({
      ...n,
      effectiveStatus: this.deriveEffectiveStatus(n.status, n.lastHeartbeat),
    }));
  }

  async createNode(dto: CreateComputeNodeDto, user: AuthenticatedUser) {
    const node = await this.prisma.computeNode.create({
      data: {
        name: dto.name,
        type: dto.type,
        totalSlots: dto.totalSlots,
        createdById: user.sub,
      },
    });

    await this.changelog.create(
      {
        entityType: 'compute_node',
        entityId: node.id,
        entityTitle: node.name,
        action: 'created',
        field: undefined,
        oldValue: undefined,
        newValue: `Nodo "${node.name}" (${node.type}, ${node.totalSlots} slot${node.totalSlots !== 1 ? 's' : ''}) creado`,
      },
      user,
    );

    this.logger.info(
      `[node] created nodeId=${node.id} name="${node.name}" type=${node.type} createdBy=${user.sub}`,
    );

    return node;
  }

  async updateNode(id: string, dto: UpdateComputeNodeDto, user: AuthenticatedUser) {
    const existing = await this.prisma.computeNode.findUnique({ where: { id } });
    if (!existing || existing.retiredAt) {
      throw new NotFoundException('Nodo no encontrado');
    }

    const updated = await this.prisma.computeNode.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        totalSlots: dto.totalSlots ?? existing.totalSlots,
      },
    });

    this.logger.info({ id, sub: user.sub }, `[node] updated nodeId=${id} by=${user.sub}`);
    return updated;
  }

  /**
   * Soft delete: marca `retiredAt` y revoca todos los tokens del nodo.
   * Los registros históricos se preservan para auditoría.
   */
  async deleteNode(id: string, user: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.computeNode.findUnique({ where: { id } });
    if (!existing || existing.retiredAt) {
      throw new NotFoundException('Nodo no encontrado');
    }

    await this.prisma.$transaction([
      this.prisma.computeNode.update({
        where: { id },
        data: {
          retiredAt: new Date(),
          status: ComputeNodeStatus.offline,
        },
      }),
      this.prisma.workerToken.updateMany({
        where: { nodeId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.changelog.create(
      {
        entityType: 'compute_node',
        entityId: id,
        entityTitle: existing.name,
        action: 'deleted',
        field: undefined,
        oldValue: existing.name,
        newValue: undefined,
      },
      user,
    );

    this.logger.info({ id, sub: user.sub }, `[node] retired nodeId=${id} by=${user.sub}`);
  }

  // ── Token operations (delegado al WorkerTokenService) ────────────────

  async generateTokenForNode(nodeId: string, user: AuthenticatedUser) {
    const node = await this.prisma.computeNode.findUnique({ where: { id: nodeId } });
    if (!node || node.retiredAt) {
      throw new NotFoundException('Nodo no encontrado');
    }
    const token = await this.tokens.generate(nodeId, user.sub);
    await this.changelog.create(
      {
        entityType: 'compute_node',
        entityId: nodeId,
        entityTitle: node.name,
        action: 'updated',
        field: 'token',
        oldValue: undefined,
        newValue: `Token ${token.prefix}*** generado`,
      },
      user,
    );
    // Adjuntamos `dashboardUrl` desde la config del API (no desde
    // window.location del frontend). El frontend lo usa para construir el
    // comando `factory-worker register --dashboard <url>` correctamente,
    // apuntando al API NestJS y no al frontend Next.js.
    return {
      ...token,
      dashboardUrl: this.getDashboardUrl(),
    };
  }

  async listTokensForNode(nodeId: string) {
    const node = await this.prisma.computeNode.findUnique({ where: { id: nodeId } });
    if (!node) throw new NotFoundException('Nodo no encontrado');
    return this.tokens.listByNode(nodeId);
  }

  async revokeToken(nodeId: string, tokenId: string, user: AuthenticatedUser): Promise<void> {
    const token = await this.prisma.workerToken.findUnique({
      where: { id: tokenId },
      include: { node: { select: { id: true, name: true } } },
    });
    if (!token || token.nodeId !== nodeId) {
      throw new NotFoundException('Token no encontrado');
    }
    if (token.revokedAt) {
      // F-04 qa-reviewer: doble revocación silenciosa producía changelog
      // inconsistente. Falla ruidosamente para que el caller maneje retries.
      throw new ConflictException('Token ya está revocado');
    }
    await this.tokens.revoke(tokenId, user.sub);
    await this.changelog.create(
      {
        entityType: 'compute_node',
        entityId: nodeId,
        entityTitle: token.node.name,
        action: 'updated',
        field: 'token',
        oldValue: `Token ${token.prefix}*** activo`,
        newValue: `Token ${token.prefix}*** revocado`,
      },
      user,
    );
  }

  // ── Endpoints worker (Bearer worker_xxx) ─────────────────────────────

  /**
   * Registration handshake: el worker se conecta por primera vez con su
   * token. Ya pasó el `WorkerAuthGuard` (token válido), así que aquí solo
   * actualizamos los metadatos self-reported (os, hostname, ip) y marcamos
   * el nodo como `online`.
   *
   * Idempotente: si el worker hace register varias veces (ej. después de
   * restart), simplemente actualiza la fila existente.
   */
  async registerWorker(nodeId: string, dto: WorkerRegisterDto) {
    const node = await this.prisma.computeNode.findUnique({ where: { id: nodeId } });
    if (!node || node.retiredAt) {
      throw new NotFoundException('Nodo no encontrado o retirado');
    }

    // El dashboard es la fuente de verdad para `totalSlots` — el operador
    // declara la capacidad en el panel cuando crea/edita el nodo. El
    // worker NO puede modificar esto (antes lo hacía y el CLI default
    // de 1 sobrescribía lo que el operador puso en UI). Si el worker
    // reporta un valor diferente, lo ignoramos pero loggeamos warn para
    // que ops detecte mismatch (worker mal configurado o operador
    // desalineado con el deployment real).
    if (dto.totalSlots !== node.totalSlots) {
      this.logger.warn(
        `[register] nodeId=${nodeId} totalSlots mismatch: worker reportó ${dto.totalSlots}, dashboard tiene ${node.totalSlots}. Usando el del dashboard.`,
      );
    }

    const updated = await this.prisma.computeNode.update({
      where: { id: nodeId },
      data: {
        os: dto.os.slice(0, 200),
        location: dto.hostname.slice(0, 100),
        ip: (dto.ip ?? '').slice(0, 45),
        // totalSlots NO se actualiza desde register — dashboard es source of truth.
        status: ComputeNodeStatus.online,
        lastHeartbeat: new Date(),
      },
    });

    this.logger.info(
      `[register] nodeId=${nodeId} hostname="${dto.hostname}" os="${dto.os}" version=${dto.version ?? 'unknown'} totalSlots=${updated.totalSlots}`,
    );

    // Devolvemos `totalSlots` para que el worker sepa con qué capacidad
    // arrancar — el dashboard es source of truth, así que el worker lo
    // usa SIEMPRE en lugar de su config local.
    return { nodeId: updated.id, name: updated.name, totalSlots: updated.totalSlots };
  }

  async heartbeat(nodeId: string, dto: WorkerHeartbeatDto) {
    // Verifica que el nodo no esté retirado ANTES de update — un heartbeat
    // contra `prisma.update` directo lanzaría P2025 → 500. Si el nodo se
    // borró mid-flight (ver F-02 qa-reviewer), el worker debe recibir 404
    // limpio para que sepa salir.
    const node = await this.prisma.computeNode.findUnique({
      where: { id: nodeId },
      select: { id: true, retiredAt: true, totalSlots: true },
    });
    if (!node || node.retiredAt) {
      throw new NotFoundException('Nodo no encontrado o retirado');
    }

    await this.prisma.computeNode.update({
      where: { id: nodeId },
      data: {
        lastHeartbeat: new Date(),
        status: ComputeNodeStatus.online,
      },
    });

    this.logger.debug(
      `[heartbeat] nodeId=${nodeId} slotsUsed=${dto.slotsUsed}/${node.totalSlots}`,
    );

    // `totalSlots` viaja en cada heartbeat para que el worker se sincronice
    // sin necesidad de re-registrar. Si el operador edita el slot count en
    // el dashboard, el worker se entera al siguiente tick (≤30s).
    return { ok: true, nextHeartbeatInMs: 30_000, totalSlots: node.totalSlots };
  }

  // ── Sweeper (cron) ───────────────────────────────────────────────────

  /**
   * Marca como `offline` los nodos con `lastHeartbeat` viejo. Ejecutado
   * por cron cada 60s. Idempotente — si ya están offline, no hace nada.
   */
  async sweepStaleNodes(): Promise<number> {
    const threshold = new Date(Date.now() - STALE_HEARTBEAT_MS);
    const result = await this.prisma.computeNode.updateMany({
      where: {
        retiredAt: null,
        status: ComputeNodeStatus.online,
        OR: [{ lastHeartbeat: { lt: threshold } }, { lastHeartbeat: null }],
      },
      data: { status: ComputeNodeStatus.offline },
    });
    if (result.count > 0) {
      this.logger.warn({ count: result.count }, `[sweeper] markedOffline=${result.count}`);
    }
    return result.count;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Deriva el status efectivo del nodo en runtime. Si `lastHeartbeat` es
   * viejo, el listing UI ve `offline` aunque la columna `status` aún diga
   * `online` (entre runs del sweeper). Una sola fuente de verdad para el
   * frontend.
   */
  private deriveEffectiveStatus(
    persistedStatus: ComputeNodeStatus,
    lastHeartbeat: Date | null,
  ): ComputeNodeStatus {
    if (persistedStatus === ComputeNodeStatus.offline) return ComputeNodeStatus.offline;
    if (!lastHeartbeat) return ComputeNodeStatus.offline;
    const ageMs = Date.now() - lastHeartbeat.getTime();
    if (ageMs > STALE_HEARTBEAT_MS) return ComputeNodeStatus.offline;
    return persistedStatus;
  }

  // ── Authz helpers ─────────────────────────────────────────────────────

  /**
   * Delega a FactoryAuthzService.assertCanManageFleet — extraído ahí para
   * romper el ciclo FleetModule↔DodModule (architecture-reviewer 2026-05-13).
   * Este método se mantiene como facade para que los callers existentes
   * (FleetController, OrgAnthropicConfigController, BranchStrategyController)
   * no tengan que cambiar imports. Nuevos consumers pueden inyectar
   * FactoryAuthzService directamente.
   */
  assertCanManageFleet(user: AuthenticatedUser): void {
    this.authz.assertCanManageFleet(user);
  }
}
