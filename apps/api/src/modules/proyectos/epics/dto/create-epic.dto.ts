import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString, IsArray, IsBoolean, IsUUID, IsObject, MaxLength, Matches, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EpicStatus, Priority } from '@prisma/client';

// Límites de longitud para prevenir DoS vía commits gigantes al vault GitHub.
// CWE-770: unbounded user input → unbounded git history bloat + API rate exhaustion.
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5_000;
const MAX_NARRATIVE = 20_000;
// El handoff de Claude Design es una instrucción corta + URL al HTML exportado
// (~250 chars típicos). 2 KB deja margen para handoffs con varios archivos o
// instrucciones extendidas, y mantiene un cap razonable contra DoS al vault.
const MAX_HANDOFF = 2_000;

/**
 * Sub-DTO de un diagrama asociado a una epica.
 *
 * **Seguridad crítica**: el `id` se usa en `epicDiagramPath` para construir
 * el path del archivo en el vault. Sin validación de charset, un `id` con
 * `/`, `..`, o whitespace permitiría path traversal y overwrite de archivos
 * hermanos (`index.md`, `definicion.md`). Restringimos a charset UUID-safe
 * `[a-fA-F0-9-]` aunque el resto del objeto se acepta como `Record<string, any>`
 * porque el shape completo vive en el JSONB de PG sin schema estricto.
 */
export class EpicDiagramItemDto {
  @ApiProperty({ example: '04c4c744-edcc-4ede-80c1-455fbd2a59af' })
  @IsString()
  @Matches(/^[a-fA-F0-9-]+$/, { message: 'diagram.id debe contener solo [a-fA-F0-9-]' })
  id!: string;

  // El resto de campos (`type`, `nodes`, `edges`, `title`, etc.) se aceptan
  // sin validar campo-por-campo. Si el ValidationPipe global NO tiene
  // `forbidNonWhitelisted: true`, los campos extra sobreviven al pipe y
  // se persisten como JSONB. class-validator solo valida `id`, que es el
  // unico campo con impacto security (va a `epicDiagramPath`).
}

/**
 * Sub-DTO de un diseño UX/UI asociado a una epica.
 *
 * **Seguridad crítica**:
 * 1. El `id` se usa en `epicDesignPath` como componente del path en el vault.
 *    Charset restringido a UUID-safe `[a-fA-F0-9-]` previene path traversal.
 * 2. `name`/`description`/`handoff` DEBEN validarse aquí. Con ValidationPipe
 *    `whitelist: true`, cualquier campo no declarado es strippeado — si los
 *    omitiéramos, el payload HTTP llegaría al JSONB sin esos campos (bug
 *    funcional de integridad).
 * 3. `MaxLength` previene DoS por payloads gigantes al vault GitHub.
 *    `MAX_HANDOFF = 20_000` iguala el máximo histórico de campos narrativos.
 */
export class EpicDesignItemDto {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  @IsString()
  @Matches(/^[a-fA-F0-9-]+$/, { message: 'design.id debe contener solo [a-fA-F0-9-]' })
  id!: string;

  @ApiProperty({ example: 'Checkout Mobile' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION)
  description?: string;

  @ApiProperty({ example: 'Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/…' })
  @IsString()
  @MaxLength(MAX_HANDOFF)
  handoff!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  createdBy?: string;

  @ApiPropertyOptional({ example: '2026-04-24T12:00:00Z' })
  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-24T12:00:00Z' })
  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}

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
  @ApiPropertyOptional({ type: [EpicDiagramItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EpicDiagramItemDto)
  diagrams?: EpicDiagramItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsArray() dependencies?: any[];
  // `ArrayMaxSize(20)` previene DoS por payloads masivos al vault GitHub:
  // cada diseño dispara un commit secuencial, 1000 diseños podrían exhaurir
  // el rate limit de la API de GitHub (5000 req/h autenticado).
  @ApiPropertyOptional({ type: [EpicDesignItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EpicDesignItemDto)
  designs?: EpicDesignItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() designSkipped?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() tracker?: Record<string, any>;
}
