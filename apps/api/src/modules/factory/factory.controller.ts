import { Controller, Get } from "@nestjs/common";
import { FactoryService } from "./factory.service";

@Controller("factory")
export class FactoryController {
  constructor(private readonly factoryService: FactoryService) {}

  @Get("status")
  getStatus() {
    return this.factoryService.getStatus();
  }

  @Get("agents")
  findAllAgents() {
    return this.factoryService.findAllAgents();
  }

  @Get("pipelines")
  findAllPipelines() {
    return this.factoryService.findAllPipelines();
  }
}
