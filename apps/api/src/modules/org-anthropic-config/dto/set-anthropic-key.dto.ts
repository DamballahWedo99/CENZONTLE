import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, Matches } from 'class-validator';

/**
 * Body para `PUT /factory/anthropic-config`. El plaintext se valida en
 * tipo y longitud razonable; la encryption la hace el service con AES-256-GCM.
 *
 * SECURITY: este DTO NO se loguea (NestJS por default no loggea bodies).
 * Si en el futuro agregas un logger middleware con bodies, asegúrate de
 * excluir este endpoint o sanitizar el field `plaintext`.
 */
export class SetAnthropicKeyDto {
  @ApiProperty({
    description: 'API key plaintext de Anthropic. Empieza con `sk-ant-`. Se encripta inmediatamente al recibirla y NUNCA se persiste en cleartext.',
    minLength: 20,
    maxLength: 200,
    example: 'sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  @MinLength(20, { message: 'API key demasiado corta (mínimo 20 chars)' })
  @MaxLength(200, { message: 'API key demasiado larga (máximo 200 chars)' })
  // Validación pragmática: keys de Anthropic empiezan con `sk-ant-`. Si en
  // el futuro Anthropic cambia el prefix, esto rompe — fácil de actualizar.
  // Permitimos también `sk-` genérico para flexibilidad en development.
  @Matches(/^sk-(ant-)?[a-zA-Z0-9_-]+$/, {
    message: 'API key debe empezar con `sk-ant-` o `sk-` y contener solo letras, números, guiones y underscores',
  })
  plaintext!: string;
}
