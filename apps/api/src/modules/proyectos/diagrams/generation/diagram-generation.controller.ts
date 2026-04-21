import { Body, Controller, Get, Param, Patch, Put, Query, Req, Res, Logger, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import type { AuthenticatedUser, EpicDiagram } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../../auth/decorators';
import { DiagramGenerationService } from './diagram-generation.service';
import { GenerateDiagramQueryDto } from './dto/generate-diagram.dto';
import { SaveCachedDiagramDto } from './dto/save-cached-diagram.dto';
import { DiagramTypeQueryDto } from './dto/diagram-type.dto';
import { sanitizeForLog } from '../../../../common/utils/sanitize-llm-input.util';
import type { Request, Response } from 'express';

@ApiTags('Diagramas — Generación IA')
@Controller('proyectos/diagram-generation')
export class DiagramGenerationController {
  private readonly logger = new Logger(DiagramGenerationController.name);

  constructor(private readonly generation: DiagramGenerationService) {}

  /**
   * Lectura del cache Redis (TTL 5 días). Se registra ANTES de `@Get(':epicId')`
   * por claridad de lectura — NestJS resuelve rutas por especificidad así que
   * `/cached` gana automáticamente, pero mantener el orden en el archivo ayuda.
   */
  @Get(':epicId/cached')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Obtener diagrama cacheado de la épica (si existe)' })
  async getCached(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
  ): Promise<{ diagram: EpicDiagram | null }> {
    const type = query.type ?? 'business';
    const diagram = await this.generation.getCached(epicId, type);
    return { diagram };
  }

  /**
   * Persiste un diagrama editado manualmente. El frontend llama aquí tras
   * cambios del editor (drag de nodos, edición de labels, etc.). El service
   * marca `generatedBy: 'manual'` y refresca `generatedAt`. TTL 5 días al
   * igual que el flujo de generación IA.
   */
  @Put(':epicId/cached')
  @Permissions(Permission.EDIT_DIAGRAM)
  @ApiOperation({ summary: 'Persiste un diagrama editado al cache Redis (TTL 5d)' })
  async saveCached(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Body() dto: SaveCachedDiagramDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ diagram: EpicDiagram }> {
    this.logger.log(`[saveCached] epic=${epicId} type=${dto.type}`);
    const diagram = await this.generation.saveCached(
      epicId,
      dto.type,
      dto.diagram,
      user,
    );
    return { diagram };
  }

  /**
   * Resetea el layout manual del diagrama cacheado. Pone `hasManualLayout=false`
   * y elimina `manualPositions`, forzando que el siguiente render recalcule
   * las posiciones con el layout engine actual.
   *
   * Útil tras mejoras al engine — los diagramas con layout manual previo no
   * aprovechaban los cambios. El user dispara este reset explícitamente desde
   * la UI; es irreversible en términos de positions (las posiciones manuales
   * se pierden), pero el contenido semántico (nodos/edges/labels) se preserva.
   */
  @Patch(':epicId/reset-layout')
  @Permissions(Permission.EDIT_DIAGRAM)
  @ApiOperation({ summary: 'Recalcula el layout del diagrama (descarta posiciones manuales)' })
  async resetLayout(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ diagram: EpicDiagram | null }> {
    const type = query.type ?? 'business';
    this.logger.log(`[resetLayout] epic=${epicId} type=${type}`);
    const diagram = await this.generation.resetLayout(epicId, type, user);
    return { diagram };
  }

  /**
   * Backfill: genera el documento de flujo de integración + `steps` sobre
   * un diagrama YA cacheado. El backend NO regenera el diagrama — solo
   * enriquece el diagrama existente con metadatos nuevos y escribe el
   * documento al vault. Útil para diagramas legacy (pre-fase 3) que no
   * tienen `steps` ni `integrationFlowDocPath`.
   *
   * Registrado ANTES de `@Get(':epicId')` porque es más específico: sin
   * este orden NestJS resolvería esta ruta con el handler genérico `generate`,
   * tratando "generate-integration-doc" como un epicId (que fallaría el
   * ParseUUIDPipe, aunque silenciosamente en otro endpoint de misma forma).
   * Mantener el orden explícito previene futuras regresiones de routing.
   */
  @Get(':epicId/generate-integration-doc')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Backfill: genera documento de flujo sobre un diagrama existente' })
  generateIntegrationDoc(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const type = query.type ?? 'business';
    this.logger.log(`[generateIntegrationDoc] epic=${epicId} type=${type}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const abortController = new AbortController();

    req.on('close', () => {
      this.logger.log(`[generateIntegrationDoc] Client disconnected, aborting agent`);
      abortController.abort();
    });

    const subject = this.generation.generateIntegrationDoc(
      epicId,
      type,
      user,
      abortController.signal,
    );

    subject.subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      },
      complete: () => {
        this.logger.log(`[generateIntegrationDoc] SSE stream finalized for epic=${epicId}`);
        res.end();
      },
      error: (err) => {
        this.logger.error(`[generateIntegrationDoc] SSE stream error: ${err?.message}`);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        res.end();
      },
    });
  }

  @Get(':epicId')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Generar un diagrama de la épica con IA via SSE' })
  generate(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: GenerateDiagramQueryDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const type = query.type ?? 'business';
    const safePromptForLog = query.prompt ? sanitizeForLog(query.prompt) : '';
    this.logger.log(`[generate] epic=${epicId} type=${type} prompt="${safePromptForLog}"`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const abortController = new AbortController();

    req.on('close', () => {
      this.logger.log(`[generate] Client disconnected, aborting agent`);
      abortController.abort();
    });

    const subject = this.generation.generate(
      epicId,
      type,
      query.prompt,
      abortController.signal,
      user,
    );

    subject.subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      },
      complete: () => {
        this.logger.log(`[generate] SSE stream finalized for epic=${epicId}`);
        res.end();
      },
      error: (err) => {
        this.logger.error(`[generate] SSE stream error: ${err?.message}`);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        res.end();
      },
    });
  }
}
