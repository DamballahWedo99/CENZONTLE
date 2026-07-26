import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para PATCH parcial de la configuración de branding.
 *
 * Solo `companyName` es editable via PATCH. Los assets (logo, favicon) se
 * suben por POST `/upload/:type` (multipart) — no entran por este DTO porque
 * los binarios no caben en un JSON.
 *
 * Para "resetear" un asset al default, usar DELETE `/asset/:type`, no enviar
 * null aquí (ese campo ni siquiera está en el DTO — defense in depth contra
 * un cliente que intente sobrescribir las URL directamente).
 */
export class UpdateBrandingSettingsDto {
  @ApiPropertyOptional({
    description: 'Nombre legible de la organización (1-80 caracteres, trim aplicado)',
    example: 'Acme Corp',
    minLength: 1,
    maxLength: 80,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'companyName no puede estar vacío (después de trim)' })
  @MaxLength(80, { message: 'companyName excede 80 caracteres' })
  companyName?: string;
}
