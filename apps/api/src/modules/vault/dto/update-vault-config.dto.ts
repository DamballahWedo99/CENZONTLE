import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;
const BRANCH_REGEX = /^[a-zA-Z0-9._/-]+$/;

export class UpdateVaultConfigDto {
  @ApiPropertyOptional({ description: 'Nombre descriptivo del vault' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) @Matches(NAME_REGEX)
  name?: string;

  @ApiPropertyOptional({ description: 'GitHub owner (usuario u organización)' })
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[a-zA-Z0-9-]+$/)
  owner?: string;

  @ApiPropertyOptional({ description: 'Nombre del repositorio GitHub' })
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[a-zA-Z0-9._-]+$/)
  repo?: string;

  @ApiPropertyOptional({ description: 'Branch del vault' })
  @IsOptional() @IsString() @MaxLength(250) @Matches(BRANCH_REGEX)
  branch?: string;

  @ApiPropertyOptional({ description: 'GitHub Personal Access Token (enviar solo si se actualiza)' })
  @IsOptional() @IsString() @MinLength(20) @MaxLength(500)
  @Matches(/^(ghp_|github_pat_|ghs_|gho_|ghu_)[A-Za-z0-9_]+$/)
  token?: string;

  @ApiPropertyOptional({ description: 'IDs de pods con acceso al vault', type: [String] })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  allowedPodIds?: string[];

  @ApiPropertyOptional({ description: 'Niveles de acceso por defecto por rol' })
  @IsOptional() @IsObject()
  roleDefaults?: Record<string, string>;
}
