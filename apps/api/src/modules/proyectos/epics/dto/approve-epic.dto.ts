import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body de un Visto Bueno (VoBo) sobre una épica. La contraseña confirma
 * la identidad del usuario (step-up authentication) — el rol que aprueba
 * se infiere del path (:role = 'po' | 'tl' | 'qa') y debe coincidir con
 * el rol del usuario autenticado.
 *
 * Comment es opcional (la mayoría de los VoBos no llevan comentario), pero
 * si está presente se incluye en el ChangelogEntry para auditoría.
 */
export class ApproveEpicDto {
  @ApiProperty({
    description:
      'Contraseña actual del aprobador. Verificada server-side contra Auth0 (Resource Owner Password Grant) antes de persistir el VoBo.',
    minLength: 1,
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  // Auth0 max password length es 128 chars; 256 nos da margen sin permitir
  // bombas (CWE-1284). El throttle del endpoint también limita el blast.
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Comentario opcional del aprobador. Se incluye en el ChangelogEntry y en epic.{role}Approval.comment.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
