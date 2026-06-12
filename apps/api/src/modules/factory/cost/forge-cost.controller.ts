import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { ForgeCostService } from './forge-cost.service';

@ApiTags('Factory Cost')
@Controller('factory/cost')
export class ForgeCostController {
  constructor(private readonly costService: ForgeCostService) {}

  @Get()
  @ApiOperation({
    summary:
      'Analytics de costo del Forge — agrega cost/tokens de TODOS los AgentRuns (planner + generator + verifier, retries incluidos) por batch encolado (ventana: últimos 50) y por story, con run-rate de los últimos 30 días. Filtra por pods del usuario para no-AltaGerencia.',
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.costService.getCostAnalytics(user);
  }
}
