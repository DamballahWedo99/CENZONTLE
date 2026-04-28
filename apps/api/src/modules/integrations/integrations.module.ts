import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { TrackerProviderFactory } from './providers/tracker-provider.factory';

/**
 * Reutiliza `CryptoService` (vía `VaultModule`) para no duplicar la derivación
 * de `VAULT_ENCRYPTION_KEY` ni la lógica AES-256-GCM. Exporta el factory para
 * que `proyectos` (epicas/stories) consuma `TrackerProvider` al hacer publish.
 */
@Module({
  imports: [PrismaModule, VaultModule],
  providers: [IntegrationsService, TrackerProviderFactory],
  controllers: [IntegrationsController],
  exports: [TrackerProviderFactory, IntegrationsService],
})
export class IntegrationsModule {}
