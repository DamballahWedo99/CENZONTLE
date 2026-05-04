import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const CATEGORIES = ['secrets', 'apis', 'testing', 'services', 'teams', 'knowledge', 'other'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const SOURCES = ['manual', 'discovered'] as const;
const STATUSES = ['identified', 'in_progress', 'resolved', 'blocked', 'mitigated'] as const;

/**
 * Input para crear una `StoryTechnicalDependency`. La mayoría de campos
 * son opcionales — solo `title`, `category` y `severity` son obligatorios.
 * `source` defaultea a 'manual' si lo omite el caller (caso UI). El agente
 * IA pasa explícitamente `source: 'discovered'`.
 */
export class CreateStoryDependencyDto {
  @ApiProperty({ example: 'Stripe API key para Tokenization' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ example: 'Necesitamos la API key de prod para checkout.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: CATEGORIES })
  @IsString()
  @IsIn(CATEGORIES as unknown as string[])
  category!: (typeof CATEGORIES)[number];

  @ApiPropertyOptional({ enum: SEVERITIES, default: 'medium' })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: (typeof SEVERITIES)[number];

  @ApiPropertyOptional({ enum: SOURCES, default: 'manual' })
  @IsOptional()
  @IsString()
  @IsIn(SOURCES as unknown as string[])
  source?: (typeof SOURCES)[number];

  @ApiPropertyOptional({ example: 'Stripe' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresCredential?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  linkedSecretId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isBlocking?: boolean;

  @ApiPropertyOptional({ example: 'Equipo de Pagos' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  targetExternalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetEpicId?: string;

  @ApiPropertyOptional({ enum: STATUSES, default: 'identified' })
  @IsOptional()
  @IsString()
  @IsIn(STATUSES as unknown as string[])
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  owner?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string;

  @ApiPropertyOptional({
    description:
      'Markdown extenso opcional (max 20K chars). Usado por el agente IA para preservar el detalle de discovered deps que vivían como .md en el vault. Cualquier renderer futuro DEBE pasar este contenido por DOMPurify (o equivalente) — no está sanitizado en el persist para preservar fidelidad markdown.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  mdContent?: string;
}
