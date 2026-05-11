import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComputeNodeType } from '@prisma/client';
import { IsEnum, IsInt, IsString, MaxLength, Min, Max, MinLength } from 'class-validator';

/**
 * Single source of truth para los valores válidos de tipo de nodo: el enum
 * generado por Prisma. Si añadimos un valor al schema.prisma, este DTO lo
 * acepta automáticamente sin tocarlo (architecture-reviewer #8 MEDIUM
 * 2026-05-06).
 */
export class CreateComputeNodeDto {
  @ApiProperty({ description: 'Nombre legible del nodo (ej: "MacBook Pro Sala Pods")', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ enum: ComputeNodeType, default: ComputeNodeType.mac_mini })
  @IsEnum(ComputeNodeType)
  type: ComputeNodeType = ComputeNodeType.mac_mini;

  @ApiPropertyOptional({ description: 'Slots concurrentes que puede correr', minimum: 1, maximum: 32, default: 1 })
  @IsInt()
  @Min(1)
  @Max(32)
  totalSlots: number = 1;
}
