import { Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { CodeRepositoriesModule } from '../../code-repositories/code-repositories.module';

/**
 * GitHubModule — wrapper de Octokit para operaciones del Forge.
 *
 * Importa CodeRepositoriesModule para reusar `CodeRepositoryConfigService`
 * que maneja decryption del PAT.
 *
 * Exporta GitHubService — el wrapper de Octokit que consumen los flujos
 * del Forge (crear integration branch, abrir/mergear PRs, preview, branch
 * strategy). El módulo no expone endpoints HTTP propios.
 */
@Module({
  imports: [CodeRepositoriesModule],
  providers: [GitHubService],
  exports: [GitHubService],
})
export class GitHubModule {}
