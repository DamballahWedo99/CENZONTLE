import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;
const BRANCH_REGEX = /^[a-zA-Z0-9._/-]+$/;

export class UpdateCodeRepositoryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  @Matches(NAME_REGEX, { message: 'Name solo puede contener alfanuméricos, espacios, guiones y underscores' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[a-zA-Z0-9-]+$/, { message: 'Owner solo puede tener alfanuméricos y guiones' })
  owner?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Repo solo puede tener alfanuméricos, puntos, guiones y underscores' })
  repo?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(250)
  @Matches(BRANCH_REGEX, { message: 'Branch solo puede tener alfanuméricos, puntos, guiones, underscores y slashes' })
  branch?: string;

  @ApiPropertyOptional({ description: 'Nuevo GitHub PAT. Omitir para mantener el actual.' })
  @IsOptional() @IsString() @MinLength(20) @MaxLength(500)
  @Matches(/^(ghp_|github_pat_|ghs_|gho_|ghu_)[A-Za-z0-9_]+$/, { message: 'Debe ser un GitHub token válido' })
  token?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  allowedPodIds?: string[];
}
