import { Module, type OnModuleDestroy } from '@nestjs/common';
import { PreviewController } from './preview.controller';
import { PreviewService } from './preview.service';
import { GitHubModule } from '../github/github.module';
import { FactoryAuthzModule } from '../authz/factory-authz.module';

/**
 * PreviewModule — local dev server preview de sprint-batch branches.
 *
 * Imports:
 *  - GitHubModule → reusa GitHubService.getRepoCredentials() para clone URL
 *  - FactoryAuthzModule → assertCanManageFleet en el controller (Vuln 2 fix
 *    2026-05-17 — solo AltaGerencia puede gatillar spawn de código agent).
 *  - PrismaService: inyectado automáticamente (PrismaModule es @Global), no
 *    requiere import explícito.
 *
 * OnModuleDestroy: NestJS llama cleanupAll() en graceful shutdown para
 * matar todos los preview processes y limpiar tmpdirs, evitando zombies
 * cuando se mata el API.
 */
@Module({
  imports: [GitHubModule, FactoryAuthzModule],
  controllers: [PreviewController],
  providers: [PreviewService],
  exports: [PreviewService],
})
export class PreviewModule implements OnModuleDestroy {
  constructor(private readonly preview: PreviewService) {}

  async onModuleDestroy(): Promise<void> {
    await this.preview.cleanupAll();
  }
}
