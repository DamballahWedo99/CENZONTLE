import { Module } from '@nestjs/common';
import { BrandingSettingsController } from './branding-settings.controller';
import { BrandingSettingsService } from './branding-settings.service';

/**
 * Configuración singleton de identidad de marca (logo, favicon, nombre).
 * PrismaService es global, no requiere import explícito aquí.
 *
 * NO marcado @Global — actualmente solo el frontend consume el service vía
 * HTTP. Cuando aparezca un consumer backend (p.ej. PDF generator que
 * inyecte el logo en outputs), añadir `@Global()` o importar este módulo
 * explícitamente desde el consumer.
 */
@Module({
  controllers: [BrandingSettingsController],
  providers: [BrandingSettingsService],
  exports: [BrandingSettingsService],
})
export class BrandingSettingsModule {}
