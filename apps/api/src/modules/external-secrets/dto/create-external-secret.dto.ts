import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Nombres de entorno reservados — un `ExternalSecret` NO puede usarlos como
 * `name`, porque al inyectarse como env var en el worker del Forge
 * colisionarían con variables críticas del proceso:
 *  - `PATH`/`HOME`/`USER`/`LANG` — corromperlas rompe el spawn de `claude`
 *    y de los comandos del verifier.
 *  - `ANTHROPIC_API_KEY` — pisarla desviaría la facturación a una key
 *    arbitraria (y violaría el contrato de aislamiento del claim).
 *  - `NODE_OPTIONS`/`LD_PRELOAD`/`LD_LIBRARY_PATH` — vectores clásicos de
 *    inyección de código en el proceso hijo.
 *  - `CI` — altera el comportamiento de test runners y build tools.
 * El prefijo `GIT_*` se rechaza aparte (en el regex de `name`): `GIT_DIR`,
 * `GIT_INDEX_FILE`, etc. desviarían las operaciones git del worker.
 *
 * Defensa en profundidad: el worker tiene una lista equivalente
 * (`RESERVED_ENV_NAMES` en `apps/worker/src/lib/secrets.ts`) que descarta
 * estos nombres en runtime. Validar también acá rechaza el nombre en origen
 * con un 400 legible en vez de un descarte silencioso. Mantener ambas
 * listas en sync.
 */
const RESERVED_ENV_NAMES = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'CI',
  'ANTHROPIC_API_KEY',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
];

/**
 * Input para crear un `ExternalSecret`. El `value` plaintext SOLO viaja en
 * esta request — nunca se persiste/logea sin encriptar.
 */
export class CreateExternalSecretDto {
  /**
   * Identificador canónico estilo env var: UPPER_SNAKE_CASE, alfanumérico +
   * guion bajo. Único en la org. Usado por `ExternalSecretsService.getByName`
   * en runtime como key de lookup, y como nombre de env var cuando se
   * forwardea al worker del Forge. No puede colisionar con env vars
   * reservadas del sistema (ver `RESERVED_ENV_NAMES`) ni usar el prefijo
   * `GIT_`.
   */
  @ApiProperty({ example: 'STRIPE_API_KEY' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^(?!GIT_)[A-Z][A-Z0-9_]*$/, {
    message:
      'name debe ser UPPER_SNAKE_CASE (ej: STRIPE_API_KEY) y no puede usar el prefijo reservado GIT_',
  })
  @IsNotIn(RESERVED_ENV_NAMES, {
    message: 'name colisiona con una variable de entorno reservada del sistema',
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
