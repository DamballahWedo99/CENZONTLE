import { IsString, IsNotEmpty, MaxLength, Matches, IsArray, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePodDto {
  @ApiProperty({ example: 'Payments Backend' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Procesamiento de pagos y reconciliación' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: '#3b82f6' })
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be a valid hex color (e.g. #3b82f6)' })
  color!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  productOwnerIds?: string[];
}
