import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, Max, MinLength } from 'class-validator';

export class UpdateComputeNodeDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 32 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32)
  totalSlots?: number;
}
