import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const MAX_PATH = 500;
const MAX_CONTENT = 500_000;
const MAX_COMMIT_MSG = 500;

export class WriteFileDto {
  @ApiProperty({ description: 'Ruta del archivo en el vault', example: 'epics/EP-001/overview.md' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PATH)
  path!: string;

  @ApiProperty({ description: 'Contenido markdown del archivo' })
  @IsString()
  @MaxLength(MAX_CONTENT)
  content!: string;

  @ApiPropertyOptional({ description: 'Mensaje de commit personalizado' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMMIT_MSG)
  message?: string;
}
