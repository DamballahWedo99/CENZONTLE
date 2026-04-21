import { IsIn, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { EpicDiagram, DiagramGenerationType } from '@cenzontle/shared';

/**
 * DTO para persistir un diagrama editado al cache Redis.
 *
 * Validación lax intencional sobre `diagram`:
 *   - El shape interno (nodes[], edges[]) YA pasó por la validación estricta
 *     del agente IA al generarse inicialmente. Las ediciones manuales son del
 *     usuario authenticated (gated por `Permission.EDIT_DIAGRAM`).
 *   - Construir DTOs anidados para Node/Edge duplicaría las reglas que ya
 *     viven en `DiagramGenerationService.validateDiagramInput`.
 *   - El service aplica un smoke-check (id, nodes >= 1, edges array) antes
 *     de escribir a Redis. Esa es la barrera server-side de integridad.
 *
 * ValidationPipe global está en `whitelist: true`, por lo que cualquier
 * propiedad extra del body se descarta silenciosamente.
 */
export class SaveCachedDiagramDto {
  @ApiProperty({
    description: 'Tipo de diagrama: business (flujo) o technical (arquitectura).',
    enum: ['business', 'technical'],
  })
  @IsIn(['business', 'technical'])
  type!: DiagramGenerationType;

  @ApiProperty({
    description:
      'Diagrama completo (EpicDiagram) con nodos, aristas y metadatos. El service valida el shape mínimo antes de persistir.',
  })
  @IsObject()
  diagram!: EpicDiagram;
}
