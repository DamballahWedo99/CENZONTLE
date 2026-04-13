import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../../auth/decorators';
import { PodsService } from './pods.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { UpdatePodDto } from './dto/update-pod.dto';

@ApiTags('Pods')
@Controller('proyectos/pods')
export class PodsController {
  constructor(private readonly podsService: PodsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los pods' })
  findAll() {
    return this.podsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un pod por ID' })
  findOne(@Param('id') id: string) {
    return this.podsService.findOne(id);
  }

  @Post()
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Crear un pod' })
  create(@Body() dto: CreatePodDto) {
    return this.podsService.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Actualizar un pod' })
  update(@Param('id') id: string, @Body() dto: UpdatePodDto) {
    return this.podsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un pod' })
  remove(@Param('id') id: string) {
    return this.podsService.remove(id);
  }
}
