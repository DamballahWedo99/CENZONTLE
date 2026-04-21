import { IsOptional, IsString, MaxLength, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateEpicsQueryDto {
  @ApiPropertyOptional({ description: 'Contexto adicional o instrucciones para el agente' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiPropertyOptional({ description: 'Número máximo de épicas a generar (3-8)', default: 5 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(8)
  count?: number;

  @ApiPropertyOptional({
    description: 'Habilitar búsqueda en internet (web_search). Por defecto false — el agente solo investiga con tools locales.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  webSearch?: boolean;
}
