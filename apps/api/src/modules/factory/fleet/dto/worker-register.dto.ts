import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIP,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

/**
 * Body que el worker CLI envía al endpoint `POST /factory/workers/register`
 * después de leer su token local. El token NO viaja en el body — viaja en
 * el header `Authorization: Bearer worker_xxx` y es validado por el
 * `WorkerAuthGuard` antes de que llegue al controller.
 *
 * SECURITY (CWE-345): `os`/`hostname`/`ip` son self-reported. Se persisten
 * en DB y eventualmente se renderizan en el dashboard de Alta Gerencia.
 * Validamos format strict (regex de chars seguros + `@IsIP`) para
 * evitar payloads HTML/JS aunque React escape por default.
 */
export class WorkerRegisterDto {
  @ApiProperty({ description: 'Sistema operativo reportado por el worker', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  // Permite letras, dígitos, espacios, paréntesis, puntos, guiones, slashes —
  // suficiente para "macOS 15.3 (Apple M3 Pro)" o "Linux 6.8.0-generic".
  // Rechaza `<`, `>`, `&`, comillas, backticks que son vectores HTML/JS.
  @Matches(/^[\w\s().\-:/+]+$/, {
    message: 'os contains invalid characters',
  })
  os!: string;

  @ApiProperty({ description: 'Hostname de la máquina', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  // RFC 1123 hostname pattern (relajado): alphanumeric + dots + hyphens.
  @Matches(/^[a-zA-Z0-9.\-_]+$/, {
    message: 'hostname must be alphanumeric with dots/dashes/underscores',
  })
  hostname!: string;

  @ApiProperty({ description: 'Slots disponibles configurados localmente', minimum: 1, maximum: 32 })
  @IsInt()
  @Min(1)
  @Max(32)
  totalSlots!: number;

  @ApiPropertyOptional({ description: 'Versión del binario factory-worker', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[\w.\-+]+$/, { message: 'version must be alphanumeric' })
  version?: string;

  @ApiPropertyOptional({ description: 'IP self-reported (NO usado para auth)' })
  @IsOptional()
  @IsIP()
  ip?: string;
}
