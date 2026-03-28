import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import { randomUUID } from 'crypto';
import { TerminalService } from './terminal.service';

const UPLOAD_DIR = '/tmp/cenzontle-uploads';

// Agent ID pattern: alphanumeric, hyphens, underscores only
const AGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/;
// Branch pattern: alphanumeric, hyphens, underscores, dots, slashes
const BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_./]*$/;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

class StartSessionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(AGENT_ID_PATTERN, { message: 'agentId must contain only alphanumeric, hyphens, and underscores' })
  @MaxLength(128)
  agentId!: string;

  @IsString()
  @IsNotEmpty()
  workdir!: string;

  @IsOptional()
  @IsString()
  initialPrompt?: string;

  @IsOptional()
  @IsString()
  @Matches(BRANCH_PATTERN, { message: 'branch must contain only alphanumeric, hyphens, underscores, dots, and slashes' })
  branch?: string;
}

class StopSessionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(AGENT_ID_PATTERN, { message: 'agentId must contain only alphanumeric, hyphens, and underscores' })
  agentId!: string;
}

class SendKeysDto {
  @IsString()
  @IsNotEmpty()
  @Matches(AGENT_ID_PATTERN, { message: 'agentId must contain only alphanumeric, hyphens, and underscores' })
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
    const { port, worktreePath, branch } = await this.terminalService.startSession(
      body.agentId,
      body.workdir,
      body.initialPrompt,
      body.branch,
    );
    return {
      agentId: body.agentId,
      port,
      url: `http://localhost:${port}`,
      worktreePath,
      branch,
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

  @Post('upload/:agentId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadFile(
    @Param('agentId') agentId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

    // Sanitize originalname — strip path components and dangerous characters
    const safeName = basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${randomUUID()}-${safeName}`;
    const filepath = join(UPLOAD_DIR, filename);

    // Verify resolved path stays inside upload dir (defense in depth)
    if (!resolve(filepath).startsWith(resolve(UPLOAD_DIR))) {
      throw new BadRequestException('Invalid filename');
    }

    writeFileSync(filepath, file.buffer);

    return { filepath, filename, agentId };
  }

  @Get('copy-mode/:agentId')
  getCopyMode(@Param('agentId') agentId: string) {
    return { inCopyMode: this.terminalService.isInCopyMode(agentId) };
  }

  @Get('session/:agentId')
  getSession(@Param('agentId') agentId: string) {
    const session = this.terminalService.getSession(agentId);
    if (!session) {
      throw new NotFoundException('No active terminal session found');
    }
    return { agentId, ...session };
  }

  @Get('sessions')
  getSessions() {
    return this.terminalService.getSessions();
  }
}
