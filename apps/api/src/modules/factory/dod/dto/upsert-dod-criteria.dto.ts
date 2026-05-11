import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Un criterio individual del DoD. `kind` es opcional — solo los criterios
 * estándar (code-written, tests-passing, etc.) lo tienen, custom criteria
 * que el operador agrega tienen kind=null.
 */
export class DodCriterionInputDto {
  @ApiProperty({
    description:
      'Identificador estable para mapping determinístico de evaluación. ' +
      'Solo aplica a criterios estándar (code-written, tests-passing, pr-created, no-errors, docs-updated, security-scan, perf-budget, accessibility). ' +
      'Custom criteria deben tener kind=null.',
    nullable: true,
    required: false,
    example: 'code-written',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  kind?: string | null;

  @ApiProperty({
    description: 'Texto del criterio mostrado en la UI.',
    example: 'Código escrito y funcional',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @ApiProperty({
    description:
      'Descripción larga (markdown-friendly) que se inyecta en el prompt del agente para darle contexto sobre el criterio. REQUERIDA — todos los criterios del DoD deben tener descripción para que el agente sepa qué validar.',
    example: 'El código debe ejecutarse sin errores de runtime y cumplir el comportamiento descrito...',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ description: 'Si el criterio aparece en la lista activa del DoD.' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: 'Si el criterio bloquea el merge cuando no se cumple.' })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ description: 'Orden de display (drag&drop persiste aquí).', minimum: 0 })
  @IsInt()
  @Min(0)
  position!: number;
}

export class UpsertDodCriteriaDto {
  @ApiProperty({
    description:
      'Array completo de criterios. Operación replace-all: el backend borra ' +
      'los que no estén en este payload y crea/actualiza los que sí. Limite 64 ' +
      'criterios — más implica que la UX se está saliendo de control.',
    type: () => DodCriterionInputDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => DodCriterionInputDto)
  criteria!: DodCriterionInputDto[];
}
