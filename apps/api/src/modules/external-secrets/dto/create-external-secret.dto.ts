import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Input para crear un `ExternalSecret`. El `value` plaintext SOLO viaja en
 * esta request — nunca se persiste/logea sin encriptar.
 */
export class CreateExternalSecretDto {
  /**
   * Identificador canónico estilo env var: UPPER_SNAKE_CASE, alfanumérico +
   * guion bajo. Único en la org. Usado por `ExternalSecretsService.getByName`
   * en runtime como key de lookup.
   */
  @ApiProperty({ example: 'STRIPE_API_KEY' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'name debe ser UPPER_SNAKE_CASE (ej: STRIPE_API_KEY)',
  })
  name!: string;

  /**
   * Valor plaintext del secret. Máximo 2048 chars — suficiente para API keys,
   * OAuth client_secrets, merchant codes. Para certificados PEM grandes
   * (>2KB) usar un endpoint dedicado en una iteración futura.
   */
  @ApiProperty({ example: 'sk_live_xxxxxxxxxxxxxxxx' })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  value!: string;

  @ApiPropertyOptional({ example: 'Stripe' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string;

  @ApiPropertyOptional({ example: 'Tokenización de pagos checkout' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  /**
   * Identificador de la `DiscoveredDependency`/`EpicDependency` que originó
   * la creación. Acepta dos formatos:
   *   - `ai-dep-<uuid>` — prefijo que usa `normalizeDependency` para deps IA
   *   - `<uuid>` plano — para `EpicDependency` creadas manualmente
   *
   * Si viene, la dep se auto-marca como `resolved` con `linkedSecretId`
   * apuntando a este secret.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(ai-dep-)?[0-9a-fA-F-]{36}$/, {
    message: 'sourceDependencyId debe ser un UUID con o sin el prefijo "ai-dep-"',
  })
  sourceDependencyId?: string;
}
