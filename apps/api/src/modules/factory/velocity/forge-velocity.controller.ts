import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { ForgeVelocityService } from './forge-velocity.service';

@ApiTags('Factory Velocity')
@Controller('factory/velocity')
export class ForgeVelocityController {
  constructor(private readonly velocityService: ForgeVelocityService) {}

  @Get()
  @ApiOperation({
    summary:
      'Velocity tracker del Forge — cruza Story.storyPoints contra el esfuerzo real de los AgentRuns (costo + duración + attempts del DoD) y clasifica cada historia como over/calibrated/under. Derivación 100% read-time desde Prisma (ventana: últimos 50 batches encolados), con trend semanal de SP entregados y tabla de calibración por bucket Fibonacci. Filtra por pods del usuario para no-AltaGerencia.',
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.velocityService.getVelocityAnalytics(user);
  }
}
