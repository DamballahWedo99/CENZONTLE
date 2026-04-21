import {
  IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional,
  IsUUID, IsInt, Min, IsArray, ValidateNested, IsIn, ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryStatus } from '@prisma/client';
import { StoryPoFieldsDto, StoryTechnicalFieldsDto, StoryQaFieldsDto } from './story-content.dto';

// Caps alineados con los defensivos del StoryGenerationService.
const MAX_DEP_MD = 10_000;
const MAX_DEPS = 80;
const MAX_DOCS = 50;

export class RelatedDocumentDto {
  @ApiProperty() @IsString() @MaxLength(200) docId!: string;
  @ApiProperty() @IsString() @MaxLength(300) docName!: string;
  @ApiProperty() @IsString() @MaxLength(500) bucketUrl!: string;
  @ApiProperty() @IsString() @MaxLength(20_000) relevanceSummary!: string;
}

export class DiscoveredDependencyDto {
  @ApiProperty() @IsString() @MaxLength(120) id!: string;
  @ApiProperty() @IsString() @MaxLength(300) title!: string;
  @ApiProperty() @IsString() @MaxLength(2_000) description!: string;
  @ApiProperty() @IsString() @IsIn(['critical', 'high', 'medium', 'low']) severity!: string;
  @ApiProperty() @IsString() @IsIn(['api', 'service', 'data', 'team', 'other']) type!: string;
  @ApiProperty() @IsString() @MaxLength(MAX_DEP_MD) mdContent!: string;
}

export class CreateStoryDto {
  @ApiProperty({ example: 'Tokenizar pagos en checkout' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsUUID()
  epicId!: string;

  @ApiProperty()
  @IsUUID()
  podId!: string;

  @ApiPropertyOptional({ enum: StoryStatus })
  @IsOptional()
  @IsEnum(StoryStatus)
  status?: StoryStatus;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  storyPoints?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  labels?: string[];

  // Narrative content (will be stored in vault as markdown)
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StoryPoFieldsDto)
  po?: StoryPoFieldsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StoryTechnicalFieldsDto)
  technical?: StoryTechnicalFieldsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StoryQaFieldsDto)
  qa?: StoryQaFieldsDto;

  @ApiPropertyOptional({ type: [RelatedDocumentDto], description: 'Documentos de la iniciativa relacionados (del agente PO)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DOCS)
  @ValidateNested({ each: true })
  @Type(() => RelatedDocumentDto)
  relatedDocuments?: RelatedDocumentDto[];

  @ApiPropertyOptional({ type: [DiscoveredDependencyDto], description: 'Dependencias descubiertas por el agente QA' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DEPS)
  @ValidateNested({ each: true })
  @Type(() => DiscoveredDependencyDto)
  discoveredDependencies?: DiscoveredDependencyDto[];
}
