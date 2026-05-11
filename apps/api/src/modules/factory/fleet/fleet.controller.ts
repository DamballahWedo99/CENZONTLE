import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { FleetService } from './fleet.service';
import { AgentRunService } from './agent-run.service';
import { CreateComputeNodeDto } from './dto/create-node.dto';
import { UpdateComputeNodeDto } from './dto/update-node.dto';

/**
 * Endpoints HUMANOS para gestión de la flota de cómputo. Todos requieren
 * Auth0 JWT (heredado del JwtAuthGuard global) + rol Alta Gerencia
 * (validado en el service via `assertCanManageFleet`).
 */
@ApiTags('Factory Fleet')
@Controller('factory/nodes')
export class FleetController {
  constructor(
    private readonly fleet: FleetService,
    private readonly runs: AgentRunService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar nodos de cómputo (no retirados) con effective status.' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.fleet.listNodes();
  }

  @Get('active-runs')
  @ApiOperation({
    summary:
      'Lista AgentRuns activos (claimed/running) con metadata de story+epic. Usado por el frontend Resource Pool drawer para mostrar qué se está corriendo en cada nodo.',
  })
  async listActiveRuns(@CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.runs.listActiveRuns();
  }

  @Get('runs/:runId')
  @ApiOperation({
    summary:
      'Detalle de un AgentRun (incluye lastOutput) — usado por /factory/agents/:runId/terminal para mostrar lo que está haciendo claude con polling 5s.',
  })
  async getRunDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId') runId: string,
  ) {
    this.fleet.assertCanManageFleet(user);
    const run = await this.runs.getRunDetail(runId);
    if (!run) {
      throw new NotFoundException(`AgentRun ${runId} no encontrado`);
    }
    return run;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un nuevo nodo de cómputo. Solo Alta Gerencia.' })
  async create(@Body() dto: CreateComputeNodeDto, @CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.fleet.createNode(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar nombre o totalSlots de un nodo.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateComputeNodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.fleet.assertCanManageFleet(user);
    return this.fleet.updateNode(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Retirar nodo (soft delete). Revoca todos sus tokens. Preserva agentRuns históricos.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    this.fleet.assertCanManageFleet(user);
    await this.fleet.deleteNode(id, user);
  }

  // ── Token endpoints ──────────────────────────────────────────────────

  @Post(':id/tokens')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Generar nuevo token Bearer para el nodo. Plaintext devuelto UNA SOLA VEZ — el caller debe mostrarlo al user inmediatamente.',
  })
  async createToken(@Param('id') nodeId: string, @CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.fleet.generateTokenForNode(nodeId, user);
  }

  @Get(':id/tokens')
  @ApiOperation({ summary: 'Listar tokens del nodo (sin plaintext, solo prefix + metadata).' })
  async listTokens(@Param('id') nodeId: string, @CurrentUser() user: AuthenticatedUser) {
    this.fleet.assertCanManageFleet(user);
    return this.fleet.listTokensForNode(nodeId);
  }

  @Delete(':id/tokens/:tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revocar token. Workers con ese token reciben 401 inmediatamente.' })
  async revokeToken(
    @Param('id') nodeId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    this.fleet.assertCanManageFleet(user);
    await this.fleet.revokeToken(nodeId, tokenId, user);
  }
}
