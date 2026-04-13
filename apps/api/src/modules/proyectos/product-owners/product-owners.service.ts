import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductOwnerDto } from './dto/create-product-owner.dto';
import { UpdateProductOwnerDto } from './dto/update-product-owner.dto';

const PO_INCLUDE = {
  pods: {
    include: { pod: { select: { id: true, name: true, color: true } } },
  },
} as const;

function mapProductOwner(raw: any) {
  const { pods, ...po } = raw;
  return {
    ...po,
    podIds: pods.map((p: any) => p.podId),
    pods: pods.map((p: any) => p.pod),
  };
}

@Injectable()
export class ProductOwnersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const owners = await this.prisma.productOwner.findMany({
      include: PO_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return owners.map(mapProductOwner);
  }

  async findOne(id: string) {
    const owner = await this.prisma.productOwner.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!owner) throw new NotFoundException('Product Owner no encontrado');
    return mapProductOwner(owner);
  }

  async create(dto: CreateProductOwnerDto) {
    const owner = await this.prisma.productOwner.create({
      data: dto,
      include: PO_INCLUDE,
    });
    return mapProductOwner(owner);
  }

  async update(id: string, dto: UpdateProductOwnerDto) {
    const owner = await this.prisma.productOwner.update({
      where: { id },
      data: dto,
      include: PO_INCLUDE,
    });
    return mapProductOwner(owner);
  }

  async remove(id: string) {
    await this.prisma.productOwner.delete({ where: { id } });
  }
}
