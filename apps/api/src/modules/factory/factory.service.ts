import { Injectable } from "@nestjs/common";

@Injectable()
export class FactoryService {
  getStatus() {
    return { status: "online", timestamp: new Date().toISOString() };
  }

  findAllAgents() {
    return { data: [], message: "Agents endpoint ready" };
  }

  findAllPipelines() {
    return { data: [], message: "Pipelines endpoint ready" };
  }
}
