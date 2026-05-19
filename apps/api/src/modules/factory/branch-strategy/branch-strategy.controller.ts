import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../auth/decorators';
import { FleetService } from '../fleet/fleet.service';
import { BranchStrategyService } from './branch-strategy.service';
import { UpdateBranchStrategyDto } from './dto/update-branch-strategy.dto';

class PauseForgeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class AbortRunsDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class AlignDevBranchDto {
  /** Password actual del user — step-up auth contra Auth0 antes del
   *  force-update de `dev`. La operación es destructiva (descarta historia
   *  única de dev) así que exigimos confirmación reciente de identidad. */
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

/**
 * Endpoints HUMANOS para gestión del modelo de branches del Forge. Solo
 * Alta Gerencia (validado vía `FleetService.assertCanManageFleet`) puede
 * leer/escribir.
 *
 *  - `GET /factory/branch-strategy` → config actual (con defaults si no
 *    existe la fila aún)
 *  - `PUT /factory/branch-strategy` → patch parcial de la config
 *
 * Reusamos el assertCanManageFleet del FleetService porque el control de
 * branches es parte del fleet management (mismo nivel de autoridad).
 */
@ApiTags('Factory Branch Strategy')
@Controller('factory/branch-strategy')
export class BranchStrategyController {
  constructor(
    private readonly fleet: FleetService,
    private readonly service: BranchStrategyService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Devuelve la configuración del modelo de branches del Forge. Auto-seed con defaults si no existe.',
  })
  async get(@CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.service.getOrInitDefault();
  }

  @Put()
  @ApiOperation({
    summary:
      'Actualiza la configuración del modelo de branches (patch parcial — solo los campos provistos cambian).',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBranchStrategyDto,
  ) {
    this.fleet.assertCanManageFleet(user);
    return this.service.update(dto, user.sub);
  }

  // ════════════════════════════════════════════════════════════════════
  // KILL SWITCH ENDPOINTS — pause/resume + emergency abort
  // ════════════════════════════════════════════════════════════════════

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pausa el Forge — claim-story devolverá null hasta que se llame /resume. Persistido en DB, sobrevive restarts.',
  })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PauseForgeDto,
  ) {
    this.fleet.assertCanManageFleet(user);
    return this.service.pause(user.sub, dto.reason);
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reanuda el Forge — claim-story vuelve a aceptar requests.',
  })
  async resume(@CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.service.resume(user.sub);
  }

  @Post('abort-all-runs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'EMERGENCY: marca TODOS los runs activos (claimed|running) como abandoned. ' +
      'Los workers recibirán 410 en próximo progress (~30s) y matarán claude. ' +
      'Combinar con /pause para detener completamente el Forge.',
  })
  async abortAllRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AbortRunsDto,
  ): Promise<{ aborted: number; reason: string }> {
    this.fleet.assertCanManageFleet(user);
    const aborted = await this.service.abortAllActiveRuns(user.sub, dto.reason);
    return { aborted, reason: dto.reason };
  }

  // ════════════════════════════════════════════════════════════════════
  // GIT STATE VALIDATION + ALIGNMENT — dev y main deben compartir historia
  // ════════════════════════════════════════════════════════════════════

  @Get('git-state')
  @ApiOperation({
    summary:
      'Valida el git state actual: dev y main existen y comparten historia. ' +
      'El frontend usa esto para mostrar un banner si hay un problema arreglable.',
  })
  async getGitState(@CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.service.validateGitState();
  }

  @Post('align-dev')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Force-update de la branch dev para que comparta historia con main. ' +
      'DESTRUCTIVO — descarta cualquier historia única de dev. Requiere ' +
      'step-up auth con password + rol TechLead o AltaGerencia.',
  })
  async alignDev(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AlignDevBranchDto,
  ) {
    // Note: NO llamamos fleet.assertCanManageFleet — el service hace su
    // propio role check (TechLead o AltaGerencia, mismo set que el
    // staging gate approval). El step-up auth con password es la barrera
    // crítica adicional.
    return this.service.alignDevWithMain(user, dto.password);
  }
}
