import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body para `POST /factory/tests/:batchId/approve`. El operador (TechLead o
 * AltaGerencia) confirma con step-up auth que aprueba el rollout del batch
 * tras revisar el QAReport. Clon del ApproveStagingGateDto — misma deny-list
 * para `notes` (van al ChangelogEntry de la epica).
 *
 * El backend valida (en este orden): pod intersection -> rol -> QA completada
 * -> password (Auth0) -> CAS idempotente.
 */

// Misma deny-list que el staging gate — construida via `new RegExp(string)`
// para que U+2028/U+2029 se interpreten a sus codepoints correctamente. Los
// control chars U+000B (VT) y U+000C (FF) son INTENCIONALES en la deny-list
// (bloquean garbling en el commit/PR); de ahi el disable de no-control-regex.
// eslint-disable-next-line no-control-regex
const NOTES_SAFE_PATTERN = new RegExp('^[^\\r\\n\\u0085\\u2028\\u2029\\u000B\\u000C\\t#@`<>\\[\\]]*$');

export class ApproveReleaseGateDto {
  @ApiProperty({
    description:
      'Contrasena actual del usuario para step-up auth (Auth0). NUNCA se persiste.',
    minLength: 1,
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Notas opcionales del approver — persistidas en el ChangelogEntry de la ' +
      'epica. Solo caracteres seguros (sin markdown/co-author injection).',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(NOTES_SAFE_PATTERN, {
    message:
      'Las notas solo aceptan letras, numeros, espacios y puntuacion basica. ' +
      'No se permiten saltos de linea, tabs, ni los simbolos #, @, comillas, <, >, [, ].',
  })
  notes?: string;
}
