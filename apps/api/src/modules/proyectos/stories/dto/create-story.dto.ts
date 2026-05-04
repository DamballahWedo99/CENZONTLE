import {
  IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional,
  IsUUID, IsInt, Min, IsArray, ValidateNested, IsIn, ArrayMaxSize,
  IsBoolean,
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

/**
 * Entry del DAG de orden entre historias del batch. Referencia a otra
 * historia por `storyId` o por `clientId` (staging).
 */
export class StoryOrderDependencyDto {
  @ApiProperty({ description: 'clientId (staging) o storyId (post-accept) de la historia que bloquea' })
  @IsString()
  @MaxLength(200)
  storyClientId!: string;

  @ApiProperty({ enum: ['hard', 'soft'] })
  @IsString()
  @IsIn(['hard', 'soft'])
  hardness!: string;

  @ApiProperty({ enum: ['api_contract', 'migration_order', 'shared_model', 'sequential_logic', 'other'] })
  @IsString()
  @IsIn(['api_contract', 'migration_order', 'shared_model', 'sequential_logic', 'other'])
  reason!: string;

  @ApiProperty() @IsString() @MaxLength(500) description!: string;
}

export class DiscoveredDependencyDto {
  @ApiProperty() @IsString() @MaxLength(120) id!: string;
  @ApiProperty() @IsString() @MaxLength(300) title!: string;
  @ApiProperty() @IsString() @MaxLength(2_000) description!: string;
  @ApiProperty() @IsString() @IsIn(['critical', 'high', 'medium', 'low']) severity!: string;
  @ApiProperty() @IsString() @IsIn(['api', 'service', 'data', 'team', 'other']) type!: string;
  @ApiProperty() @IsString() @MaxLength(MAX_DEP_MD) mdContent!: string;
  /**
   * Campos opcionales del feature "External Secrets". Los emite el agente
   * Tech Lead cuando la dep requiere credencial externa (API key de Stripe,
   * merchant code, OAuth client_secret). El QA puede emitirlos también
   * pero su foco es mocks/fixtures.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) vendor?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresCredential?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isBlocking?: boolean;
  /**
   * `linkedSecretId` poblado en `emitProposals` cuando la dep matchea con un
   * secret YA provisto en `external_secrets` (registry global cross-iniciativa).
   * Llega del frontend al aceptar la propuesta — debe persistirse intacto en
   * `story_technical_dependencies` con `status='resolved'`. Sin este campo,
   * el auto-link cross-org se pierde al persistir y la dep aparece como
   * pendiente aunque el secret ya exista.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) linkedSecretId?: string;
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

  /**
   * clientId de la propuesta staging (`ai-story-<uuid>`) que originó esta
   * historia. Persistido en `story.sourceClientId` para poder resolver
   * `blockedBy` cuando otras historias del mismo batch se aceptan después.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceClientId?: string;

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

  /**
   * DAG de orden entre historias del mismo batch (emitido por el Tech Lead).
   * Cada entry apunta a una historia bloqueante por `clientId` (si viene de
   * staging) o `storyId` (si viene de un sistema externo). El service busca
   * matches en el mismo batch al aceptar y crea rows en `StoryDependency`.
   */
  @ApiPropertyOptional({ type: [StoryOrderDependencyDto], description: 'DAG de orden entre historias del batch' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StoryOrderDependencyDto)
  blockedBy?: StoryOrderDependencyDto[];
}
