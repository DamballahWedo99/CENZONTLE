import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';
import { ExternalSecretsService } from './external-secrets.service';
import { ExternalSecretsController } from './external-secrets.controller';

/**
 * Módulo de credenciales externas. Reutiliza `CryptoService` exportado por
 * `VaultModule` para no duplicar la derivación de key (`VAULT_ENCRYPTION_KEY`)
 * ni la lógica AES-256-GCM.
 *
 * Exporta `ExternalSecretsService` para que servicios runtime (ej: futuro
 * payment gateway) puedan inyectarlo y consumir secrets vía `getByName`.
 */
@Module({
  imports: [PrismaModule, VaultModule],
  providers: [ExternalSecretsService],
  controllers: [ExternalSecretsController],
  exports: [ExternalSecretsService],
})
export class ExternalSecretsModule {}
