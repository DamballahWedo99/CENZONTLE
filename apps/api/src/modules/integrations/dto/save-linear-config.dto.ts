import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Input para `PUT /integrations/linear`. La `apiKey` plaintext SOLO viaja en
 * esta request — al persistir se cifra con AES-256-GCM y el plaintext se
 * descarta. Si la request omite `apiKey` y ya hay config previa, se mantiene
 * la key existente (caso "editar metadata sin rotar credencial").
 */
export class SaveLinearConfigDto {
  @ApiPropertyOptional({
    example: 'lin_api_xxxxxxxxxxxxxxxx',
    description:
      'API key personal de Linear. Omitir para conservar la key actual al actualizar metadata.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  // Linear PATs siempre comienzan con "lin_api_". Validar el shape impide que
  // este endpoint se use como oracle para credential stuffing genérico.
  @Matches(/^lin_api_[A-Za-z0-9_-]{8,}$/, {
    message: 'apiKey debe ser una Linear PAT con prefijo "lin_api_"',
  })
  apiKey?: string;

  @ApiProperty({ example: 'a1b2c3d4-...', description: 'UUID del Team en Linear' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  teamId!: string;

  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  teamName!: string;

  @ApiProperty({ example: 'my-company' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  workspaceSlug!: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-...' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectId?: string;

  @ApiPropertyOptional({ example: 'Q1 Sprint' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string;
}
