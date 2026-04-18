import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;
const BRANCH_REGEX = /^[a-zA-Z0-9._/-]+$/;

export class CreateCodeRepositoryDto {
  @ApiProperty({ description: 'Nombre descriptivo del repositorio', example: 'Backend Principal' })
  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(100)
  @Matches(NAME_REGEX, { message: 'Name solo puede contener alfanuméricos, espacios, guiones y underscores' })
  name!: string;

  @ApiProperty({ description: 'GitHub owner (usuario u organización)', example: 'AeromexicoTech' })
  @IsString() @IsNotEmpty() @MaxLength(100) @Matches(/^[a-zA-Z0-9-]+$/, { message: 'Owner solo puede tener alfanuméricos y guiones' })
  owner!: string;

  @ApiProperty({ description: 'Nombre del repositorio GitHub', example: 'booking-service' })
  @IsString() @IsNotEmpty() @MaxLength(100) @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Repo solo puede tener alfanuméricos, puntos, guiones y underscores' })
  repo!: string;

  @ApiPropertyOptional({ description: 'Branch a clonar (default: main)', example: 'main' })
  @IsOptional() @IsString() @MaxLength(250)
  @Matches(BRANCH_REGEX, { message: 'Branch solo puede tener alfanuméricos, puntos, guiones, underscores y slashes' })
  branch?: string;

  @ApiProperty({ description: 'GitHub Personal Access Token', example: 'ghp_xxxxxxxxxxxxxxxxxxxx' })
  @IsString() @IsNotEmpty() @MinLength(20) @MaxLength(500)
  @Matches(/^(ghp_|github_pat_|ghs_|gho_|ghu_)[A-Za-z0-9_]+$/, { message: 'Debe ser un GitHub token válido (ghp_, github_pat_, ghs_, gho_, o ghu_)' })
  token!: string;

  @ApiPropertyOptional({ description: 'IDs de pods con acceso al repositorio', type: [String] })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  allowedPodIds?: string[];
}
