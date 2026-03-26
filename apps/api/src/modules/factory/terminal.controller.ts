import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TerminalService } from './terminal.service';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

class StartSessionDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @IsString()
  @IsNotEmpty()
  workdir!: string;

  @IsOptional()
  @IsString()
  initialPrompt?: string;
}

class StopSessionDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string;
}

class SendKeysDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @IsString()
  @IsNotEmpty()
  keys!: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller('factory/terminal')
export class TerminalController {
  constructor(private readonly terminalService: TerminalService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async startSession(@Body() body: StartSessionDto) {
    const { port } = await this.terminalService.startSession(
      body.agentId,
      body.workdir,
      body.initialPrompt,
    );
    return {
      agentId: body.agentId,
      port,
      url: `http://localhost:${port}`,
    };
  }

  @Post('stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  stopSession(@Body() body: StopSessionDto): void {
    this.terminalService.stopSession(body.agentId);
  }

  @Post('send-keys')
  @HttpCode(HttpStatus.NO_CONTENT)
  sendKeys(@Body() body: SendKeysDto): void {
    this.terminalService.sendKeys(body.agentId, body.keys);
  }

  @Get('session/:agentId')
  getSession(@Param('agentId') agentId: string) {
    const session = this.terminalService.getSession(agentId);
    if (!session) {
      throw new NotFoundException(`No active terminal session for agent ${agentId}`);
    }
    return { agentId, ...session };
  }

  @Get('sessions')
  getSessions() {
    return this.terminalService.getSessions();
  }
}
