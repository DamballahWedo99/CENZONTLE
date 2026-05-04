import { IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional, IsDateString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InitiativeStatus } from '@prisma/client';

// CWE-770: límites para prevenir DoS vía commits gigantes al vault.
const MAX_NAME = 200;
const MAX_DESCRIPTION = 20_000;
const MAX_OWNER = 200;

export class CreateInitiativeDto {
  @ApiProperty({ example: 'Modernización de Plataforma Digital' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name!: string;

  @ApiProperty({ example: 'Migración a microservicios y modernización del checkout' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESCRIPTION)
  description!: string;

  @ApiPropertyOptional({ enum: InitiativeStatus, default: 'planning' })
  @IsOptional()
  @IsEnum(InitiativeStatus)
  status?: InitiativeStatus;

  // Las fechas son opcionales: una iniciativa puede crearse en estado
  // 'planning' (borrador) sin compromiso temporal todavía. El frontend pide
  // las fechas cuando se transiciona el status fuera de 'planning'.
  @ApiPropertyOptional({ example: '2026-01-06' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiProperty({ example: 'VP de Tecnología' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_OWNER)
  owner!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  documents?: any[];
}
