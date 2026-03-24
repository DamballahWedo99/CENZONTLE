import { Controller, Get } from "@nestjs/common";
import { ProyectosService } from "./proyectos.service";

@Controller("proyectos")
export class ProyectosController {
  constructor(private readonly proyectosService: ProyectosService) {}

  @Get("iniciativas")
  findAllInitiatives() {
    return this.proyectosService.findAllInitiatives();
  }

  @Get("epicas")
  findAllEpics() {
    return this.proyectosService.findAllEpics();
  }

  @Get("historias")
  findAllStories() {
    return this.proyectosService.findAllStories();
  }
}
