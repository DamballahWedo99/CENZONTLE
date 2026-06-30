import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser, UserRole, type ReleaseGateApprovalResponse } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { assertUserCanAccessEpicPods } from '../../proyectos/epics/epic-access.util';

/**
 * Release gate humano. Clon de approveStagingGate: pod access + rol
 * (TechLead/AltaGerencia) + step-up auth + CAS idempotente + changelog inline.
 * Aprobar = rollout: marca releaseApprovedAt → el batch pasa a RELEASED. No hay
 * endpoint de "rechazo" (igual que el staging gate): no aprobar = el operador
 * re-corre QA o arregla el batch. El QAReport.recommendation es advisory; el
 * humano decide.
 */
@Injectable()
export class QaGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    @InjectPinoLogger(QaGateService.name)
    private readonly logger: PinoLogger,
  ) {}

  async approveReleaseGate(
    batchId: string,
    user: AuthenticatedUser,
    input: { password: string; notes?: string },
  ): Promise<ReleaseGateApprovalResponse> {
    const epic = await this.prisma.epic.findFirst({
      where: { enqueuedBatchId: batchId },
      include: { pods: { select: { podId: true } } },
    });
    if (!epic) {
      throw new NotFoundException(`Batch ${batchId} no encontrado`);
    }

    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    if (user.role !== UserRole.TechLead && user.role !== UserRole.AltaGerencia) {
      throw new ForbiddenException(
        'Solo Tech Lead o Alta Gerencia puede aprobar el release gate. ' +
          `Tu rol actual es ${user.role}.`,
      );
    }

    if (epic.releaseApprovedAt) {
      throw new ConflictException(
        `El batch ya fue liberado el ${epic.releaseApprovedAt.toISOString()} ` +
          `por ${epic.releaseApprovedByName ?? epic.releaseApprovedBy ?? 'unknown'}.`,
      );
    }

    // El gate solo se habilita cuando la campaña QA terminó (QAReport listo).
    if (!epic.qaCompletedAt) {
      throw new BadRequestException(
        'El batch no está listo para liberar: la campaña de QA aún no completa. ' +
          'Espera a que el QAReport esté disponible.',
      );
    }

    await this.auth.assertPasswordValid(user, input.password);

    const now = new Date();
    const approverName = user.name ?? user.email ?? user.sub;

    await this.prisma.$transaction(async (tx) => {
      // CAS: el row debe seguir sin aprobar (otro TL pudo aprobar en paralelo).
      const result = await tx.epic.updateMany({
        where: { id: epic.id, releaseApprovedAt: null },
        data: {
          releaseApprovedAt: now,
          releaseApprovedBy: user.sub,
          releaseApprovedByName: approverName,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'El estado del batch cambió mientras procesábamos el approval ' +
            '(probablemente otro aprobó en paralelo). Recarga y reintenta.',
        );
      }
      await tx.changelogEntry.create({
        data: {
          entityType: 'epic',
          entityId: epic.id,
          entityTitle: epic.title,
          action: 'release_approved',
          newValue: input.notes ? input.notes : `Liberado por ${approverName}`,
          changedById: user.sub,
          changedByName: approverName,
        },
      });
    });

    this.logger.info(
      { event: 'qa.gate.released', batchId, epicId: epic.id, approvedBy: user.sub },
      `[qa-gate] batch ${batchId} liberado por ${approverName}`,
    );

    return {
      batchId,
      epicId: epic.id,
      approvedAt: now.toISOString(),
      approvedBy: user.sub,
      approvedByName: approverName,
    };
  }
}
