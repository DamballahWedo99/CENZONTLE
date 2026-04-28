import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../auth/decorators';
import { IntegrationsService } from './integrations.service';
import { SaveLinearConfigDto } from './dto/save-linear-config.dto';
import { TestLinearConnectionDto } from './dto/test-linear-connection.dto';
import { DeleteIntegrationParamDto } from './dto/delete-integration.dto';

/**
 * Configuración persistente de tracker integrations (Linear, Jira). El plaintext
 * de la API key NUNCA se devuelve por HTTP — los GET siempre incluyen `maskedKey`.
 * Permission `MANAGE_INTEGRATIONS` (default: AltaGerencia, TechLead).
 */
@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('linear')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Obtener la configuración Linear (sin plaintext de API key).' })
  async getLinear() {
    const config = await this.integrations.getConfigOrNull('linear');
    if (!config) throw new NotFoundException('Linear no está configurado.');
    return config;
  }

  @Put('linear')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({
    summary: 'Crear o actualizar la configuración Linear.',
    description:
      'Si `apiKey` viene, la cifra y persiste. Si se omite y ya hay config, se conserva la key actual.',
  })
  async saveLinear(
    @Body() dto: SaveLinearConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrations.saveLinearConfig(dto, user?.sub);
  }

  @Post('linear/test')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Probar la conexión Linear con la API key provista o la persistida.',
  })
  async testLinear(@Body() dto: TestLinearConnectionDto) {
    return this.integrations.testLinearConnection(dto);
  }

  @Delete(':provider')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar la configuración de un proveedor.' })
  async deleteConfig(@Param() params: DeleteIntegrationParamDto) {
    await this.integrations.deleteConfig(params.provider);
  }
}
