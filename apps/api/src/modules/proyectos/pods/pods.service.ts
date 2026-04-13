import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { UpdatePodDto } from './dto/update-pod.dto';

const POD_INCLUDE = {
  _count: { select: { epics: true } },
} as const;

function mapPod(raw: any) {
  const { _count, ...pod } = raw;
  return {
    ...pod,
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
    const pod = await this.prisma.pod.create({
      data: dto,
      include: POD_INCLUDE,
    });
    return mapPod(pod);
  }

  async update(id: string, dto: UpdatePodDto) {
    const pod = await this.prisma.pod.update({
      where: { id },
      data: dto,
      include: POD_INCLUDE,
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
