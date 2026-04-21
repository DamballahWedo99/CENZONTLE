import { IsOptional, IsString, MaxLength, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { DiagramGenerationType } from '@cenzontle/shared';

export class GenerateDiagramQueryDto {
  @ApiPropertyOptional({
    description: 'Tipo de diagrama a generar: business (flujo de negocio) o technical (arquitectura).',
    enum: ['business', 'technical'],
    default: 'business',
  })
  @IsOptional()
  @IsIn(['business', 'technical'])
  type?: DiagramGenerationType;

  @ApiPropertyOptional({ description: 'Contexto adicional o instrucciones para el agente' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;
}
