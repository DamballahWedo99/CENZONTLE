import { Module } from '@nestjs/common';
import { VelocityCalibrationService } from './velocity-calibration.service';

/**
 * Módulo INDEPENDIENTE a propósito: la calibración la consume el PO agent
 * de ProyectosModule, y FactoryModule ya importa ProyectosModule — si la
 * calibración viviera dentro de FactoryModule se cerraría el ciclo
 * FactoryModule → ProyectosModule → (calibración) → FactoryModule, que
 * obligaría a forwardRef en ambos lados. Al ser standalone, ProyectosModule
 * lo importa directo sin tocar el grafo del Factory.
 *
 * Sin imports: PrismaModule es @Global y nestjs-pino registra el logger
 * app-wide, así que el service resuelve sus dos deps sin declarar nada.
 */
@Module({
  providers: [VelocityCalibrationService],
  exports: [VelocityCalibrationService],
})
export class VelocityCalibrationModule {}
