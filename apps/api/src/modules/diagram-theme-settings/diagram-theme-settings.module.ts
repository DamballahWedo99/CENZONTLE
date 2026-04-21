import { Module } from '@nestjs/common';
import { DiagramThemeSettingsController } from './diagram-theme-settings.controller';
import { DiagramThemeSettingsService } from './diagram-theme-settings.service';

/**
 * Módulo de configuración de tema de diagramas (colores por grupo).
 * PrismaService es global (provisto por PrismaModule@Global), no requiere import.
 */
@Module({
  controllers: [DiagramThemeSettingsController],
  providers: [DiagramThemeSettingsService],
  exports: [DiagramThemeSettingsService],
})
export class DiagramThemeSettingsModule {}
