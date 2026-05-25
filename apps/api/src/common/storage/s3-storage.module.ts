import { Global, Module } from '@nestjs/common';
import { S3StorageService } from './s3-storage.service';

/**
 * Módulo global del cliente S3. @Global porque varios módulos lo van a
 * consumir (BrandingSettings ahora, futuro DocumentsService, futuro
 * exports de reportes, etc.) y sería ruido importarlo en cada uno.
 *
 * Configurable 100% via env vars (`S3_*`) — el módulo no requiere providers
 * adicionales del consumer.
 */
@Global()
@Module({
  providers: [S3StorageService],
  exports: [S3StorageService],
})
export class S3StorageModule {}
