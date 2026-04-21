import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { DiagramGenerationType } from '@cenzontle/shared';

/**
 * DTO compartido para los endpoints que solo aceptan el query `type`. Sin
 * este DTO, los controladores reciben `@Query('type') type: DiagramGenerationType`
 * con el TS type erase en runtime — un atacante puede enviar `type=../../foo`
 * y el valor se concatena directo al path del vault o a la key de Redis.
 */
export class DiagramTypeQueryDto {
  @ApiPropertyOptional({
    description: 'Tipo de diagrama: business (flujo de negocio) o technical (arquitectura).',
    enum: ['business', 'technical'],
    default: 'business',
  })
  @IsOptional()
  @IsIn(['business', 'technical'])
  type?: DiagramGenerationType;
}
