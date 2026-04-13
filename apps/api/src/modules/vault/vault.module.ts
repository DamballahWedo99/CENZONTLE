import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { VaultConfigService } from './vault-config.service';
import { VaultConfigController } from './vault-config.controller';
import { CryptoService } from './crypto.service';
import { VaultAccessGuard } from './guards/vault-access.guard';

@Global()
@Module({
  controllers: [VaultController, VaultConfigController],
  providers: [VaultService, VaultConfigService, CryptoService, VaultAccessGuard],
  exports: [VaultService, VaultConfigService, CryptoService],
})
export class VaultModule {}
