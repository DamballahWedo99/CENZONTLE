import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthAwareThrottlerGuard } from "./common/guards/auth-aware-throttler.guard";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { ProyectosModule } from "./modules/proyectos/proyectos.module";
import { FactoryModule } from "./modules/factory/factory.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { VaultModule } from "./modules/vault/vault.module";
import { CodeRepositoriesModule } from "./modules/code-repositories/code-repositories.module";
import { DiagramThemeSettingsModule } from "./modules/diagram-theme-settings/diagram-theme-settings.module";
import { AgentTokenSettingsModule } from "./modules/agent-token-settings/agent-token-settings.module";
import { ExternalSecretsModule } from "./modules/external-secrets/external-secrets.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { AgentRunRegistryModule } from "./common/services/agent-run-registry.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting global. El default protege CADA endpoint contra fan-out
    // de un mismo IP. Endpoints específicos (los 3 SSE generate) sobre-
    // escriben con un cap más estricto vía @Throttle().
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 }, // 60 req/min global
    ]),
    PrismaModule,
    RedisModule,
    VaultModule,
    CodeRepositoriesModule,
    AgentRunRegistryModule,
    ProyectosModule,
    FactoryModule,
    AuthModule,
    DocumentsModule,
    DiagramThemeSettingsModule,
    AgentTokenSettingsModule,
    ExternalSecretsModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // AuthAwareThrottlerGuard prefiere `req.user.sub` sobre `req.ip` para
    // el bucket de throttle. Esto evita que múltiples users detrás del mismo
    // proxy/NAT compartan budget (un atacante DoS-eando al resto), y
    // previene bypass via IP rotation. Fallback a IP para endpoints
    // anónimos. Aplica a todas las rutas: las request pasan por
    // throttle → auth → permissions → handler.
    {
      provide: APP_GUARD,
      useClass: AuthAwareThrottlerGuard,
    },
  ],
})
export class AppModule {}
