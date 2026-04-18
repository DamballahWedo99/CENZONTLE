import { Module } from '@nestjs/common';
import { CodeRepositoryConfigService } from './code-repository-config.service';
import { CodeRepositoryController } from './code-repository.controller';
import { CodeRepoCloneService } from './code-repo-clone.service';
import { CodeSearchService } from './code-search.service';

/**
 * Módulo para gestionar repositorios de código conectados (GitHub).
 *
 * Reutiliza CryptoService del VaultModule (que es @Global) para encriptar
 * tokens at-rest con el mismo esquema AES-256-GCM y la misma VAULT_ENCRYPTION_KEY.
 *
 * Exporta CodeRepoCloneService + CodeSearchService para que las tools del agente
 * (Fase D, en factory/agent-tools) puedan inyectarlos.
 */
@Module({
  controllers: [CodeRepositoryController],
  providers: [CodeRepositoryConfigService, CodeRepoCloneService, CodeSearchService],
  exports: [CodeRepositoryConfigService, CodeRepoCloneService, CodeSearchService],
})
export class CodeRepositoriesModule {}
