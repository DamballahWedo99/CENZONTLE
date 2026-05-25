import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  BRANDING_ASSET_CONSTRAINTS,
  BRANDING_ASSET_TYPES,
  type BrandingAssetType,
  type BrandingSettings,
  Permission,
} from '@cenzontle/shared';
import type { Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser, Permissions, Public } from '../auth/decorators';
import { BrandingSettingsService } from './branding-settings.service';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';

/**
 * Endpoints de configuración de identidad de marca.
 *
 * Auth model:
 *  - GET (settings + asset binary): @Public — el layout raíz lo consume en
 *    SSR antes de Auth0; el favicon DEBE estar en el HTML inicial. La
 *    metadata sensible (updatedBy) se filtra del response público.
 *  - PATCH, POST upload, DELETE asset: @Permissions(MANAGE_BRANDING) — solo
 *    Alta Gerencia. Cambiar branding tiene blast radius global. Además
 *    validamos Origin/Referer contra el allowlist (defense in depth CSRF).
 */
@ApiTags('Branding Settings')
@Controller('branding-settings')
export class BrandingSettingsController {
  constructor(
    private readonly branding: BrandingSettingsService,
    @InjectPinoLogger(BrandingSettingsController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Obtener la configuración de branding actual (público, sin metadata)',
  })
  async get(): Promise<Omit<BrandingSettings, 'updatedBy'>> {
    const full = await this.branding.get();
    // `updatedBy` es un Auth0 `sub` — info útil para spear-phishing si se
    // filtra a anónimos. Excluimos del response público (los admins ven
    // metadata completa al loguearse en la UI de settings, donde el GET
    // sigue siendo el mismo endpoint pero el frontend ya tiene la sesión).
    const { updatedBy: _updatedBy, ...publicShape } = full;
    return publicShape;
  }

  @Patch()
  @Permissions(Permission.MANAGE_BRANDING)
  @ApiOperation({
    summary: 'Actualizar parcialmente la configuración (solo companyName por ahora)',
  })
  async update(
    @Body() dto: UpdateBrandingSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('origin') origin: string | undefined,
    @Headers('referer') referer: string | undefined,
  ) {
    this.assertSameOrigin(origin, referer);
    return this.branding.update(dto, user?.sub ?? null);
  }

  /**
   * Sube un asset binario. El path es `/upload/:type` donde type ∈
   * {logo, logoCollapsed, favicon}. Multipart con field `file`.
   * Límite enforced doble: multer (server) + UI (client). El service
   * valida también magic bytes contra mimetype declarado.
   */
  @Post('upload/:type')
  @Permissions(Permission.MANAGE_BRANDING)
  @ApiOperation({ summary: 'Subir un asset de branding (logo | logoCollapsed | favicon)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: BRANDING_ASSET_CONSTRAINTS.maxFileSizeBytes },
    }),
  )
  async upload(
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('origin') origin: string | undefined,
    @Headers('referer') referer: string | undefined,
  ) {
    this.assertSameOrigin(origin, referer);
    const assetType = this.parseAssetType(type);
    return this.branding.uploadAsset(assetType, file, user?.sub ?? null);
  }

  @Delete('asset/:type')
  @Permissions(Permission.MANAGE_BRANDING)
  @ApiOperation({ summary: 'Eliminar un asset (vuelve al default estático del frontend)' })
  async deleteAsset(
    @Param('type') type: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('origin') origin: string | undefined,
    @Headers('referer') referer: string | undefined,
  ) {
    this.assertSameOrigin(origin, referer);
    const assetType = this.parseAssetType(type);
    return this.branding.removeAsset(assetType, user?.sub ?? null);
  }

  /**
   * Sirve el binario del asset al navegador. Endpoint PÚBLICO porque el
   * favicon se carga desde la pestaña del navegador sin cookies/headers de
   * auth. El path incluye `?v=<timestamp>` (query, no path) para cache
   * busting — el server ignora el query y siempre devuelve la versión
   * actual del singleton.
   *
   * SECURITY headers:
   *  - `X-Content-Type-Options: nosniff` evita que browsers content-sniffeen
   *    un archivo declarado como image/png pero que contiene HTML.
   *  - `Content-Disposition: inline; filename=...` previene download attacks
   *    via Content-Type confusion.
   *  - `Content-Security-Policy: default-src 'none'` — defense en profundidad
   *    si por alguna razón se llegara a aceptar SVG en el futuro: ningún
   *    script ejecuta aunque el archivo contenga uno.
   */
  @Get('asset/:type')
  @Public()
  @ApiOperation({ summary: 'Servir el binario del asset (público, stream desde S3)' })
  async serveAsset(@Param('type') type: string, @Res() res: Response) {
    const assetType = this.parseAssetType(type);
    const found = await this.branding.getAssetObject(assetType);
    if (!found) {
      // 404 explícito — el frontend ya tiene un fallback estático y este
      // endpoint solo se llama cuando el GET de settings devolvió un URL no-null.
      // Si llegamos aquí con null es porque hubo race entre delete + cache,
      // o el objeto fue borrado del bucket out-of-band.
      res.status(404).json({ error: 'Asset no encontrado' });
      return;
    }
    res.setHeader('Content-Type', found.mimetype);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${assetType}${getExt(found.mimetype)}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // Cache headers conservadores. `must-revalidate` fuerza al navegador a
    // chequear con If-Modified-Since cada vez — y como el URL ya cambia con
    // `?v=<timestamp>`, en la práctica el cache solo se usa entre updates.
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');

    // Pipe del stream S3 al response. Manejo de error en el stream (e.g.
    // conexión a S3 cae a mitad del pipe) — si headers ya fueron enviados
    // no podemos cambiar status, solo destruir el response para que el
    // cliente vea conexión cerrada y reintente. Si NO fueron enviados,
    // 502 explícito.
    //
    // Observabilidad: el success path NO se loggea (este endpoint sirve
    // cada favicon/logo load — sería ruido por-request sin valor de audit).
    // El log HTTP de pino ya captura `GET /asset/:type 200 Xms` para
    // métricas de tráfico. Solo loggeamos el error path (anomalía real).
    let bytesServed = 0;
    const pipeStartedAt = Date.now();
    found.stream.on('data', (chunk: Buffer) => {
      bytesServed += chunk.length;
    });
    found.stream.on('error', (err) => {
      this.logger.error(
        {
          event: 'branding.serveasset.stream_error',
          assetType,
          bytesServedBeforeError: bytesServed,
          pipeLatencyMs: Date.now() - pipeStartedAt,
          headersSent: res.headersSent,
          errorName: (err as { name?: string }).name,
          errorMessage: err.message,
        },
        `[branding] SERVE stream error type=${assetType} after ${bytesServed}B / ${Date.now() - pipeStartedAt}ms — ${err.message}`,
      );
      if (!res.headersSent) {
        res.status(502).json({ error: 'Storage error' });
      } else {
        res.destroy(err);
      }
    });
    found.stream.pipe(res);
  }

  // ─────────────────────────────────────────────────────────────────────

  private parseAssetType(raw: string): BrandingAssetType {
    if (!(BRANDING_ASSET_TYPES as readonly string[]).includes(raw)) {
      throw new BadRequestException(
        `Tipo de asset inválido: "${raw}". Esperado: ${BRANDING_ASSET_TYPES.join(' | ')}`,
      );
    }
    return raw as BrandingAssetType;
  }

  /**
   * Defensa CSRF: rechaza requests cuyo Origin/Referer no esté en el
   * allowlist. Es una capa adicional sobre la cookie de Auth0 — un atacante
   * cross-origin no puede setear Origin/Referer arbitrario desde el browser
   * (los headers son enforced).
   *
   * Allowlist: `CORS_ORIGIN` env var (CSV de URLs permitidas) o, en dev,
   * cualquier `http://localhost:*`. Si no hay Origin Y no hay Referer,
   * pasamos — esto cubre clientes API legítimos (curl, scripts CI/CD).
   */
  private assertSameOrigin(origin: string | undefined, referer: string | undefined): void {
    if (!origin && !referer) return; // curl / script — no es CSRF
    const allowlist = parseAllowlist(process.env.CORS_ORIGIN, process.env.NODE_ENV);
    if (allowlist === null) return; // wildcard / no configurado — confiar
    const candidate = origin ?? extractOrigin(referer ?? '');
    if (!candidate) {
      this.logger.warn(
        { event: 'branding.csrf.reject', reason: 'malformed-headers', origin, referer },
        '[branding] CSRF reject: malformed Origin/Referer',
      );
      throw new ForbiddenException('Origin/Referer header missing or malformed');
    }
    if (!allowlist.some((allowed) => matchesOrigin(candidate, allowed))) {
      this.logger.warn(
        { event: 'branding.csrf.reject', reason: 'not-in-allowlist', origin: candidate },
        `[branding] CSRF reject: origin=${candidate} not in allowlist`,
      );
      throw new ForbiddenException('Origin not allowed');
    }
  }
}

function getExt(mimetype: string): string {
  switch (mimetype) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico';
    default:
      return '';
  }
}

/**
 * Parse del CORS_ORIGIN env var. Comportamiento:
 *  - `null` retornado ⇒ wildcard (no enforce CSRF) — usar SOLO en dev sin env var.
 *  - `[]` retornado ⇒ enforce estricto, ningún origin pasa.
 *  - Array no vacío ⇒ allowlist.
 *
 * En dev (`NODE_ENV !== 'production'`) sin CORS_ORIGIN, permitimos
 * `http://localhost:*` para que el dev local funcione sin config adicional.
 */
function parseAllowlist(envVar: string | undefined, nodeEnv: string | undefined): string[] | null {
  if (envVar && envVar.trim().length > 0) {
    return envVar.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (nodeEnv !== 'production') {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }
  // Producción sin CORS_ORIGIN: no validamos (fail-open). Documentar que
  // el operador DEBE setear CORS_ORIGIN en prod para activar la defensa.
  return null;
}

function extractOrigin(refererUrl: string): string | null {
  try {
    const url = new URL(refererUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function matchesOrigin(candidate: string, allowed: string): boolean {
  // Match exacto. Sin wildcards aquí — si quieres `*.example.com`, expandirlo
  // explícitamente en CORS_ORIGIN. Tener wildcards en este enforcer es
  // historial común de bypass (e.g. `evil.com.example.com.attacker.tld`).
  return candidate === allowed;
}
