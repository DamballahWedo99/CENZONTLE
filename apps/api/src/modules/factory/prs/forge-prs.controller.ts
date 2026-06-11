import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { ForgePrsService } from './forge-prs.service';

@ApiTags('Factory PRs')
@Controller('factory/prs')
export class ForgePrsController {
  constructor(private readonly prsService: ForgePrsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista todos los PRs del flujo Forge — story PRs contra la integration branch y consolidated PRs contra el branch de staging (devBranch) — enriquecidos con estado vivo de GitHub. Filtra por pods del usuario para no-AltaGerencia.',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prsService.listPrs(user);
  }
}
