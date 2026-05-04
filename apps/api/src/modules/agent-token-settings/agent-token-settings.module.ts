import { Global, Module } from '@nestjs/common';
import { AgentTokenSettingsController } from './agent-token-settings.controller';
import { AgentTokenSettingsService } from './agent-token-settings.service';

/**
 * Configuración singleton de tokens (extended thinking + max_tokens) por
 * agente IA. PrismaService es global, no requiere import.
 *
 * Marcado @Global porque el service se inyecta en los 3 services de
 * generación (stories, epics, diagrams) que viven en ProyectosModule —
 * sin Global tendríamos que importar este módulo en cada uno.
 */
@Global()
@Module({
  controllers: [AgentTokenSettingsController],
  providers: [AgentTokenSettingsService],
  exports: [AgentTokenSettingsService],
})
export class AgentTokenSettingsModule {}
