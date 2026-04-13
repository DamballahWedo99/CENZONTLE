import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../../auth/decorators';
import { ProductOwnersService } from './product-owners.service';
import { CreateProductOwnerDto } from './dto/create-product-owner.dto';
import { UpdateProductOwnerDto } from './dto/update-product-owner.dto';

@ApiTags('Product Owners')
@Controller('proyectos/product-owners')
export class ProductOwnersController {
  constructor(private readonly productOwnersService: ProductOwnersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los product owners' })
  findAll() {
    return this.productOwnersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un product owner por ID' })
  findOne(@Param('id') id: string) {
    return this.productOwnersService.findOne(id);
  }

  @Post()
  @Permissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Crear un product owner' })
  create(@Body() dto: CreateProductOwnerDto) {
    return this.productOwnersService.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Actualizar un product owner' })
  update(@Param('id') id: string, @Body() dto: UpdateProductOwnerDto) {
    return this.productOwnersService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(Permission.MANAGE_USERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un product owner' })
  remove(@Param('id') id: string) {
    return this.productOwnersService.remove(id);
  }
}
