import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  PipeTransform,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, basename, resolve } from 'path';
import { randomUUID } from 'crypto';
import { TerminalService } from './terminal.service';

const UPLOAD_DIR = '/tmp/cenzontle-uploads';

// Agent ID pattern: alphanumeric, hyphens, underscores only
const AGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/;
// Branch pattern: alphanumeric, hyphens, underscores, dots, slashes
const BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_./]*$/;

// ---------------------------------------------------------------------------
// Param Pipe
// ---------------------------------------------------------------------------

@Injectable()
class ParseAgentIdPipe implements PipeTransform {
  transform(value: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/.test(value) || value.length > 128) {
      throw new BadRequestException('Invalid agentId parameter');
    }
    return value;
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

class StartSessionDto {
  @ApiProperty({ description: 'Agent identifier (alphanumeric, hyphens, underscores)', example: 'agent-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(AGENT_ID_PATTERN, { message: 'agentId must contain only alphanumeric, hyphens, and underscores' })
  @MaxLength(128)
  agentId!: string;

  @ApiProperty({ description: 'Working directory for the terminal session', example: '/home/user/project' })
  @IsString()
  @IsNotEmpty()
  workdir!: string;

  @ApiPropertyOptional({ description: 'Initial prompt to send after session starts' })
  @IsOptional()
  @IsString()
  initialPrompt?: string;

  @ApiPropertyOptional({ description: 'Git branch to checkout (alphanumeric, hyphens, underscores, dots, slashes)', example: 'feat/my-branch' })
  @IsOptional()
  @IsString()
  @Matches(BRANCH_PATTERN, { message: 'branch must contain only alphanumeric, hyphens, underscores, dots, and slashes' })
  branch?: string;
}

class StopSessionDto {
  @ApiProperty({ description: 'Agent identifier to stop', example: 'agent-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(AGENT_ID_PATTERN, { message: 'agentId must contain only alphanumeric, hyphens, and underscores' })
  agentId!: string;
}

class SendKeysDto {
  @ApiProperty({ description: 'Agent identifier to send keys to', example: 'agent-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(AGENT_ID_PATTERN, { message: 'agentId must contain only alphanumeric, hyphens, and underscores' })
  agentId!: string;

  @ApiProperty({ description: 'Keys to send to the terminal session', example: 'ls -la' })
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
    @Param('agentId', ParseAgentIdPipe) agentId: string,
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
  getCopyMode(@Param('agentId', ParseAgentIdPipe) agentId: string) {
    return { inCopyMode: this.terminalService.isInCopyMode(agentId) };
  }

  @Get('session/:agentId')
  getSession(@Param('agentId', ParseAgentIdPipe) agentId: string) {
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

  @Get('audit-log')
  getAuditLog(
    @Query('agentId') agentId?: string,
    @Query('limit') limit?: string,
  ) {
    const logPath = this.terminalService.getAuditLogPath();
    if (!existsSync(logPath)) return { entries: [], total: 0 };

    const raw = readFileSync(logPath, 'utf-8').trim();
    if (!raw) return { entries: [], total: 0 };

    let entries = raw.split('\n').map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    if (agentId) {
      entries = entries.filter((e: { agentId?: string }) => e.agentId === agentId);
    }

    const total = entries.length;
    const cap = Math.min(parseInt(limit ?? '100', 10) || 100, 500);
    // Return most recent entries first
    entries = entries.slice(-cap).reverse();

    return { entries, total };
  }
}
