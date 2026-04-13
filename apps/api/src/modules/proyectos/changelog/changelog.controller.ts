import { Controller, Get, Post, Body, Query, ParseArrayPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthenticatedUser, Permission } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../auth/decorators';
import { ChangelogService } from './changelog.service';
import { CreateChangelogDto } from './dto/create-changelog.dto';

@ApiTags('Changelog')
@Controller('proyectos/changelog')
export class ChangelogController {
  constructor(private readonly changelogService: ChangelogService) {}

  @Get()
  @ApiOperation({ summary: 'Listar entradas de changelog' })
  findAll(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.changelogService.findAll(entityType, entityId);
  }

  @Post()
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @ApiOperation({ summary: 'Crear entrada de changelog' })
  create(@Body() dto: CreateChangelogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.changelogService.create(dto, user);
  }

  @Post('batch')
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @ApiOperation({ summary: 'Crear múltiples entradas de changelog' })
  createMany(
    @Body(new ParseArrayPipe({ items: CreateChangelogDto })) entries: CreateChangelogDto[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changelogService.createMany(entries, user);
  }
}
