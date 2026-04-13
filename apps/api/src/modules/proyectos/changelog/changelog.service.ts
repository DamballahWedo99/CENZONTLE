import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChangelogDto } from './dto/create-changelog.dto';

@Injectable()
export class ChangelogService {
  constructor(private prisma: PrismaService) {}

  async findAll(entityType?: string, entityId?: string) {
    return this.prisma.changelogEntry.findMany({
      where: {
        ...(entityType && { entityType }),
        ...(entityId && { entityId }),
      },
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
  }

  async create(dto: CreateChangelogDto, user: AuthenticatedUser) {
    return this.prisma.changelogEntry.create({
      data: {
        ...dto,
        changedById: user.sub,
        changedByName: user.name || user.email,
      },
    });
  }

  async createMany(entries: CreateChangelogDto[], user: AuthenticatedUser) {
    const data = entries.map((entry) => ({
      ...entry,
      changedById: user.sub,
      changedByName: user.name || user.email,
    }));
    return this.prisma.changelogEntry.createMany({ data });
  }
}
