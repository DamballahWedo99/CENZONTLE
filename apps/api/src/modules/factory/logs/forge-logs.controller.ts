import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { ForgeLogsService } from './forge-logs.service';

@ApiTags('Factory Logs')
@Controller('factory/logs')
export class ForgeLogsController {
  constructor(private readonly logsService: ForgeLogsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Stream de logs del Forge derivado del estado persistido — lifecycle de batches en la cola, lifecycle de AgentRuns, milestones técnicos del worker y veredictos del DoD verifier. Filtra por pods del usuario para no-AltaGerencia.',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.logsService.listLogs(user);
  }
}
