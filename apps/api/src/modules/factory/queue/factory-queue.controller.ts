import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { FactoryQueueService } from './factory-queue.service';

@ApiTags('Factory Queue')
@Controller('factory/queue')
export class FactoryQueueController {
  constructor(private readonly queueService: FactoryQueueService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista las épicas actualmente en la cola "in queue" del Forge. Filtra por pods del usuario para no-AltaGerencia.',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.queueService.listQueue(user);
  }

  @Post('enqueue/:epicId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Envía una épica al Forge (la encola). Valida pod intersection, artefactos completos (definición/diagrama/historias) y los 3 VoBos approved.',
  })
  enqueue(
    @Param('epicId') epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queueService.enqueueEpic(epicId, user);
  }
}
