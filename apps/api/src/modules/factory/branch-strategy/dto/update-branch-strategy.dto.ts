import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body para `PUT /factory/branch-strategy`. Todos los campos opcionales —
 * un patch parcial actualiza solo lo provisto.
 *
 * Validación: nombres de branch siguen las reglas de Git (sin espacios,
 * caracteres especiales restringidos, no empieza con `-`).
 */
export class UpdateBranchStrategyDto {
  @ApiProperty({
    description: 'Branch de integración (DEV). Los PRs consolidados del Forge mergean acá. Default: "dev".',
    example: 'dev',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  // Reglas básicas de naming Git: alfanuméricos + algunos chars especiales,
  // sin espacios, sin empezar con guion.
  @Matches(/^[a-zA-Z0-9._/-]+$/, {
    message: 'devBranch tiene caracteres inválidos para un nombre de branch Git',
  })
  devBranch?: string;

  @ApiProperty({
    description: 'Branch de producción. NO se modifica desde el Forge — solo PRs humanos. Default: "main".',
    example: 'main',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9._/-]+$/, {
    message: 'mainBranch tiene caracteres inválidos para un nombre de branch Git',
  })
  mainBranch?: string;

  @ApiProperty({
    description: 'Prefix para las integration branches de cada batch. El Forge sufija el epicId. Default: "forge/sprint-batch-".',
    example: 'forge/sprint-batch-',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9._/-]+$/, {
    message: 'forgeBranchPrefix tiene caracteres inválidos para un prefijo de branch Git',
  })
  forgeBranchPrefix?: string;

  @ApiProperty({
    description: 'Si true, las integration branches se borran tras el merge a DEV. Útil para mantener limpio el repo. Default: true.',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  autoDeleteForgeBranch?: boolean;
}
