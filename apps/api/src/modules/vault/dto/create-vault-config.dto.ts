import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;
const BRANCH_REGEX = /^[a-zA-Z0-9._/-]+$/;

export class CreateVaultConfigDto {
  @ApiProperty({ description: 'Nombre descriptivo del vault', example: 'Vault Principal' })
  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(100)
  @Matches(NAME_REGEX, { message: 'Name solo puede contener alfanuméricos, espacios, guiones y underscores' })
  name!: string;

  @ApiProperty({ description: 'GitHub owner (usuario u organización)', example: 'DamballahWedo99' })
  @IsString() @IsNotEmpty() @MaxLength(100) @Matches(/^[a-zA-Z0-9-]+$/, { message: 'Owner solo puede tener alfanuméricos y guiones' })
  owner!: string;

  @ApiProperty({ description: 'Nombre del repositorio GitHub', example: 'CENZONTLE' })
  @IsString() @IsNotEmpty() @MaxLength(100) @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Repo solo puede tener alfanuméricos, puntos, guiones y underscores' })
  repo!: string;

  @ApiPropertyOptional({ description: 'Branch del vault (default: main)', example: 'main' })
  @IsOptional() @IsString() @MaxLength(250)
  @Matches(BRANCH_REGEX, { message: 'Branch solo puede tener alfanuméricos, puntos, guiones, underscores y slashes' })
  branch?: string;

  @ApiProperty({ description: 'GitHub Personal Access Token', example: 'ghp_xxxxxxxxxxxxxxxxxxxx' })
  @IsString() @IsNotEmpty() @MinLength(20) @MaxLength(500)
  @Matches(/^(ghp_|github_pat_|ghs_|gho_|ghu_)[A-Za-z0-9_]+$/, { message: 'Debe ser un GitHub token válido (ghp_, github_pat_, ghs_, gho_, o ghu_)' })
  token!: string;

  @ApiPropertyOptional({ description: 'IDs de pods con acceso al vault', type: [String] })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  allowedPodIds?: string[];

  @ApiPropertyOptional({ description: 'Niveles de acceso por defecto por rol', example: { product_owner: 'editor', qa: 'viewer' } })
  @IsOptional() @IsObject()
  roleDefaults?: Record<string, string>;
}
