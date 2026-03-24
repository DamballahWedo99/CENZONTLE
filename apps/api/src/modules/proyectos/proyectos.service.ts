import { Injectable } from "@nestjs/common";

@Injectable()
export class ProyectosService {
  findAllInitiatives() {
    return { data: [], message: "Initiatives endpoint ready" };
  }

  findAllEpics() {
    return { data: [], message: "Epics endpoint ready" };
  }

  findAllStories() {
    return { data: [], message: "Stories endpoint ready" };
  }
}
