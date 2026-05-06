import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyPasswordDto {
  @ApiProperty({
    description:
      'Contraseña actual del usuario autenticado para confirmar acciones sensibles (step-up authentication).',
    minLength: 1,
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  // Auth0 max password length es 128 chars. 256 nos da margen sin permitir
  // bombas (CWE-1284). El throttle del endpoint también limita el blast.
  @MaxLength(256)
  password!: string;
}
