import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, Permission } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../auth/decorators';
import { DiagramThemeSettingsService } from './diagram-theme-settings.service';
import { UpdateDiagramThemeDto } from './dto/update-diagram-theme.dto';

/**
 * Endpoints para la configuración singleton de colores de diagrama.
 *
 * - GET /diagram-theme: accesible a cualquier usuario autenticado (solo
 *   protegido por el JwtAuthGuard global). Todos los roles lo necesitan para
 *   renderizar diagramas con los colores correctos.
 * - PUT /diagram-theme: restringido a MANAGE_DIAGRAM_THEME (Alta Gerencia).
 */
@ApiTags('Diagram Theme')
@Controller('diagram-theme')
export class DiagramThemeSettingsController {
  constructor(private readonly settings: DiagramThemeSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Obtener la configuración actual de colores de diagrama',
  })
  get() {
    return this.settings.get();
  }

  @Put()
  @Permissions(Permission.MANAGE_DIAGRAM_THEME)
  @ApiOperation({
    summary:
      'Reemplazar los colores de diagrama (requiere MANAGE_DIAGRAM_THEME, solo Alta Gerencia)',
  })
  update(
    @Body() dto: UpdateDiagramThemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.update(dto.colors, user?.sub ?? null, dto.textColors);
  }
}
