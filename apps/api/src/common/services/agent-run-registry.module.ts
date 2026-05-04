import { Global, Module } from '@nestjs/common';
import { AgentRunRegistryService } from './agent-run-registry.service';

/**
 * @Global para que los 3 generation controllers (story / diagram / epic)
 * lo inyecten sin tener que importar el módulo en cada generation module.
 */
@Global()
@Module({
  providers: [AgentRunRegistryService],
  exports: [AgentRunRegistryService],
})
export class AgentRunRegistryModule {}
