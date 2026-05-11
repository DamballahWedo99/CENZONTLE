import { Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { CodeRepositoriesModule } from '../../code-repositories/code-repositories.module';

/**
 * GitHubModule — wrapper de Octokit para operaciones del Forge.
 *
 * Importa CodeRepositoriesModule para reusar `CodeRepositoryConfigService`
 * que maneja decryption del PAT.
 *
 * Exporta GitHubService para que AgentRunService (Fase 2: crear
 * integration branch al encolar) y reviewer flow (Fase 4) lo consuman.
 */
@Module({
  imports: [CodeRepositoriesModule],
  providers: [GitHubService],
  exports: [GitHubService],
})
export class GitHubModule {}
