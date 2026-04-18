import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { ProyectosModule } from "./modules/proyectos/proyectos.module";
import { FactoryModule } from "./modules/factory/factory.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { VaultModule } from "./modules/vault/vault.module";
import { CodeRepositoriesModule } from "./modules/code-repositories/code-repositories.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    VaultModule,
    CodeRepositoriesModule,
    ProyectosModule,
    FactoryModule,
    AuthModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
