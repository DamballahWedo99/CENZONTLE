import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ProyectosModule } from "./modules/proyectos/proyectos.module";
import { FactoryModule } from "./modules/factory/factory.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ProyectosModule,
    FactoryModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
