import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Input para `POST /integrations/linear/test`. TODOS los campos son opcionales
 * para soportar dos modos:
 *   1) Pre-save: el form pasa `apiKey` + metadata para validar antes de
 *      persistir. El status persistido NO se altera.
 *   2) Re-validar: el caller pasa `{}` y el service usa la config persistida.
 */
export class TestLinearConnectionDto {
  @ApiPropertyOptional({
    example: 'lin_api_xxxxxxxxxxxxxxxx',
    description: 'API key a probar. Si se omite, se usa la guardada.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  @Matches(/^lin_api_[A-Za-z0-9_-]{8,}$/, {
    message: 'apiKey debe ser una Linear PAT con prefijo "lin_api_"',
  })
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  teamId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  teamName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  workspaceSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string;
}
