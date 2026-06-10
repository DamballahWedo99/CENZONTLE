import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { VaultConfigService } from './vault-config.service';
import { VaultConfigController } from './vault-config.controller';
import { VaultCloneService } from './vault-clone.service';
import { VaultConnectionsService } from './vault-connections.service';
import { VaultFolderService } from './vault-folder.service';
import { CryptoService } from './crypto.service';
import { VaultAccessGuard } from './guards/vault-access.guard';
import { OrgAnthropicConfigModule } from '../org-anthropic-config/org-anthropic-config.module';

@Global()
@Module({
  // OrgAnthropicConfigModule NO importa VaultModule (usa CryptoService vía
  // @Global), así que este import no crea ciclo de módulos.
  imports: [OrgAnthropicConfigModule],
  controllers: [VaultController, VaultConfigController],
  providers: [VaultService, VaultConfigService, VaultCloneService, VaultConnectionsService, VaultFolderService, CryptoService, VaultAccessGuard],
  exports: [VaultService, VaultConfigService, VaultCloneService, VaultFolderService, CryptoService],
})
export class VaultModule {}
