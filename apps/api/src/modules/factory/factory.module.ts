import { Module } from "@nestjs/common";
import { FactoryController } from "./factory.controller";
import { FactoryService } from "./factory.service";
import { TerminalController } from "./terminal.controller";
import { TerminalService } from "./terminal.service";

@Module({
  controllers: [FactoryController, TerminalController],
  providers: [FactoryService, TerminalService],
  exports: [FactoryService, TerminalService],
})
export class FactoryModule {}
