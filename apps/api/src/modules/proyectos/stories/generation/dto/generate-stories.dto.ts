import { IsOptional, IsString, MaxLength, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateStoriesQueryDto {
  @ApiPropertyOptional({ description: 'Contexto adicional o instrucciones para el agente' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiPropertyOptional({
    description:
      'Sugerencia (opcional) del numero aproximado de historias a generar. Si se omite, el agente PO decide ' +
      'segun el alcance REAL de la epica (typical 3-10, puede ser mas si el scope lo requiere). El cap duro ' +
      'de 15 es defensivo para evitar explosion de tokens, no un limite artistico.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(15)
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
