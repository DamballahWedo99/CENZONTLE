import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import type { DiagramGroupColors, DiagramTextColors } from '@cenzontle/shared';

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const HEX_MESSAGE = 'Debe ser un color hex válido de 6 dígitos (e.g. #3b82f6)';

/**
 * Shape del body del PUT /diagram-theme. Cada uno de los 7 layers
 * arquitectónicos del DiagramNodeGroup debe estar presente y ser un hex
 * string válido. Cualquier propiedad extra se descarta por el
 * ValidationPipe global (`whitelist: true`) y cualquier propiedad faltante
 * falla la validación.
 */
export class DiagramGroupColorsDto implements DiagramGroupColors {
  @ApiProperty({ example: '#6366f1', description: 'Color del nodo inicial' })
  @Matches(HEX_COLOR_REGEX, { message: `start: ${HEX_MESSAGE}` })
  start!: string;

  @ApiProperty({ example: '#10b981', description: 'Color del nodo terminal' })
  @Matches(HEX_COLOR_REGEX, { message: `end: ${HEX_MESSAGE}` })
  end!: string;

  @ApiProperty({ example: '#38bdf8', description: 'Color de nodos frontend (UI, web, móvil)' })
  @Matches(HEX_COLOR_REGEX, { message: `frontend: ${HEX_MESSAGE}` })
  frontend!: string;

  @ApiProperty({ example: '#a855f7', description: 'Color de nodos backend (microservicios)' })
  @Matches(HEX_COLOR_REGEX, { message: `backend: ${HEX_MESSAGE}` })
  backend!: string;

  @ApiProperty({ example: '#f59e0b', description: 'Color de nodos de datos (DBs, colas)' })
  @Matches(HEX_COLOR_REGEX, { message: `data: ${HEX_MESSAGE}` })
  data!: string;

  @ApiProperty({ example: '#94a3b8', description: 'Color de nodos de infraestructura (gateways, CDNs)' })
  @Matches(HEX_COLOR_REGEX, { message: `infra: ${HEX_MESSAGE}` })
  infra!: string;

  @ApiProperty({ example: '#f43f5e', description: 'Color de nodos externos (terceros)' })
  @Matches(HEX_COLOR_REGEX, { message: `external: ${HEX_MESSAGE}` })
  external!: string;
}

/**
 * Shape del campo opcional `textColors` en el PUT /diagram-theme. Controla
 * los colores del TÍTULO y la DESCRIPCIÓN dentro de cada nodo del diagrama.
 * Son globales al diagrama (no por grupo) para evitar una UI abrumadora.
 *
 * Ambos campos son requeridos cuando se envía el objeto — si se omite
 * `textColors` por completo el service preserva lo que haya en DB (o los
 * defaults del paquete shared si la fila es legacy / sin el campo).
 */
export class DiagramTextColorsDto implements DiagramTextColors {
  @ApiProperty({
    example: '#ffffff',
    description: 'Color hex del TÍTULO dentro de cada nodo (ej: "Frontend App")',
  })
  @IsString({ message: 'title debe ser un string' })
  @Matches(HEX_COLOR_REGEX, {
    message: 'title debe ser color hex de 6 dígitos (ej: #ffffff)',
  })
  title!: string;

  @ApiProperty({
    example: '#e4e4e7',
    description: 'Color hex de la DESCRIPCIÓN (texto pequeño debajo del título)',
  })
  @IsString({ message: 'description debe ser un string' })
  @Matches(HEX_COLOR_REGEX, {
    message: 'description debe ser color hex de 6 dígitos (ej: #ffffff)',
  })
  description!: string;
}

export class UpdateDiagramThemeDto {
  @ApiProperty({
    type: DiagramGroupColorsDto,
    description: 'Mapa de 7 layers arquitectónicos → hex color. Todos los grupos son requeridos.',
  })
  @IsDefined({ message: 'colors es requerido' })
  @IsNotEmptyObject({ nullable: false }, { message: 'colors no puede estar vacío' })
  @ValidateNested()
  @Type(() => DiagramGroupColorsDto)
  colors!: DiagramGroupColorsDto;

  @ApiPropertyOptional({
    type: DiagramTextColorsDto,
    description:
      'Colores del título y la descripción dentro de cada nodo. Opcional — si se omite, se preservan los valores previos (o defaults).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiagramTextColorsDto)
  textColors?: DiagramTextColorsDto;
}
