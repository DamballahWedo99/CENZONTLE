import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString, IsArray, IsUUID, IsObject, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EpicStatus, Priority } from '@prisma/client';

// Límites de longitud para prevenir DoS vía commits gigantes al vault GitHub.
// CWE-770: unbounded user input → unbounded git history bloat + API rate exhaustion.
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5_000;
const MAX_NARRATIVE = 20_000;

export class CreateEpicDto {
  @ApiProperty({ example: 'Rediseño de Checkout Web' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE)
  title!: string;

  @ApiProperty({ example: 'Rediseño completo del flujo de checkout' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESCRIPTION)
  description!: string;

  @ApiPropertyOptional({ enum: EpicStatus, default: 'draft' })
  @IsOptional()
  @IsEnum(EpicStatus)
  status?: EpicStatus;

  @ApiPropertyOptional({ enum: Priority, default: 'medium' })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  targetDate!: string;

  @ApiProperty()
  @IsUUID()
  initiativeId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  podIds?: string[];

  // Rich text fields
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) qualitativeBenefits?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) quantitativeBenefits?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) benefitsMeasurement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) scopeDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) acceptanceCriteria?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) technologicalImprovements?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) businessPriority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) teamsInvolved?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) impactedChannels?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) impactedFlows?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) impactSabreLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_NARRATIVE) thirdPartyDependencies?: string;

  // JSONB fields
  @ApiPropertyOptional() @IsOptional() @IsArray() documents?: any[];
  @ApiPropertyOptional() @IsOptional() @IsArray() diagrams?: any[];
  @ApiPropertyOptional() @IsOptional() @IsArray() dependencies?: any[];
  @ApiPropertyOptional() @IsOptional() @IsObject() tracker?: Record<string, any>;
}
