import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { UpdatePodDto } from './dto/update-pod.dto';

const POD_INCLUDE = {
  productOwners: {
    include: { productOwner: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  },
  _count: { select: { epics: true } },
} as const;

function mapPod(raw: any) {
  const { productOwners, _count, ...pod } = raw;
  return {
    ...pod,
    productOwnerIds: productOwners.map((po: any) => po.productOwnerId),
    productOwners: productOwners.map((po: any) => po.productOwner),
    epicCount: _count.epics,
  };
}

@Injectable()
export class PodsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const pods = await this.prisma.pod.findMany({
      include: POD_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return pods.map(mapPod);
  }

  async findOne(id: string) {
    const pod = await this.prisma.pod.findUnique({
      where: { id },
      include: POD_INCLUDE,
    });
    if (!pod) throw new NotFoundException('Pod no encontrado');
    return mapPod(pod);
  }

  async create(dto: CreatePodDto) {
    const { productOwnerIds, ...data } = dto;
    const pod = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pod.create({ data });
      if (productOwnerIds?.length) {
        await tx.podProductOwner.createMany({
          data: productOwnerIds.map((poId) => ({ podId: created.id, productOwnerId: poId })),
        });
      }
      return tx.pod.findUniqueOrThrow({ where: { id: created.id }, include: POD_INCLUDE });
    });
    return mapPod(pod);
  }

  async update(id: string, dto: UpdatePodDto) {
    const { productOwnerIds, ...data } = dto;
    const pod = await this.prisma.$transaction(async (tx) => {
      await tx.pod.update({ where: { id }, data });
      if (productOwnerIds !== undefined) {
        await tx.podProductOwner.deleteMany({ where: { podId: id } });
        if (productOwnerIds.length) {
          await tx.podProductOwner.createMany({
            data: productOwnerIds.map((poId) => ({ podId: id, productOwnerId: poId })),
          });
        }
      }
      return tx.pod.findUniqueOrThrow({ where: { id }, include: POD_INCLUDE });
    });
    return mapPod(pod);
  }

  async remove(id: string) {
    const epicCount = await this.prisma.epicPod.count({ where: { podId: id } });
    if (epicCount > 0) {
      throw new BadRequestException('No se puede eliminar un pod con épicas asignadas');
    }
    await this.prisma.pod.delete({ where: { id } });
  }
}
