import { Module } from "@nestjs/common";
import { ProyectosController } from "./proyectos.controller";
import { ProyectosService } from "./proyectos.service";

@Module({
  controllers: [ProyectosController],
  providers: [ProyectosService],
  exports: [ProyectosService],
})
export class ProyectosModule {}
