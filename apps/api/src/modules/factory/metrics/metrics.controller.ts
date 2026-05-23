import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { FactoryAuthzService } from '../authz/factory-authz.service';
import { FactoryMetricsService } from './metrics.service';
import { FactoryMetricsResponseDto } from './dto/timeseries-response.dto';

/**
 * Telemetría 24h del Factory para los charts CapacityChart + TokenBurnChart
 * del dashboard `/factory`. Gated a Alta Gerencia (mismo nivel que el resto
 * del FleetController) — expone burn agregado de la organización entera,
 * info competitiva sensible.
 */
@ApiTags('Factory Metrics')
@Controller('factory/metrics')
export class FactoryMetricsController {
  constructor(
    private readonly authz: FactoryAuthzService,
    private readonly metricsService: FactoryMetricsService,
  ) {}

  @Get('timeseries')
  @ApiOperation({
    summary:
      'Timeseries 24h para los charts del dashboard /factory — capacity (slots ocupados/hora) y token burn (input+output+cache_creation por hora, split de cache_read). Solo Alta Gerencia. Reemplaza el mock seeded del frontend con agregación real de AgentRun.',
  })
  @ApiOkResponse({ type: FactoryMetricsResponseDto })
  getTimeseries(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FactoryMetricsResponseDto> {
    this.authz.assertCanManageFleet(user);
    return this.metricsService.getTimeseries();
  }
}
