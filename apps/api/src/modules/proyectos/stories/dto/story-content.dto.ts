import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Cap defensive: 60K chars total por sección. Suma ≈180K para una historia
// completa, dentro del límite de Linear (~64K body) — el linear-tracker
// hace cap defensivo adicional al concatenar para no truncar dependencias.
const MAX_STORY_MARKDOWN = 60_000;

/**
 * Sección Product Owner. A partir de v2, un único string markdown con headings
 * obligatorios:
 *   ## Antecedentes
 *   ## Objetivo
 *   ## Historia de usuario
 *   ## What/How/When
 *   ## Criterios de aceptación
 *   ## Notas adicionales (opcional)
 *
 * El frontend renderea 1 editor Tiptap full-feature; el agente IA emite el
 * markdown via prompt. Los headings se validan con regex, NO con schema.
 */
export class StoryPoFieldsDto {
  @ApiPropertyOptional({ description: 'Markdown con headings obligatorios.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STORY_MARKDOWN)
  markdown?: string;
}

/**
 * Sección Solución Técnica. Markdown con headings:
 *   ## Arquitectura y componentes
 *   ## Flujo de integración
 *   ## Validaciones
 *   ## Manejo de errores
 *   ## Contrato
 */
export class StoryTechnicalFieldsDto {
  @ApiPropertyOptional({ description: 'Markdown con headings obligatorios.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STORY_MARKDOWN)
  markdown?: string;
}

/**
 * Sección QA. Markdown con headings:
 *   ## Pruebas unitarias
 *   ## Happy path
 *   ## Edge cases
 *   ## Mocks
 *   ## Herramientas
 */
export class StoryQaFieldsDto {
  @ApiPropertyOptional({ description: 'Markdown con headings obligatorios.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STORY_MARKDOWN)
  markdown?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Legacy shapes — solo type-only para que los helpers `legacy*ToMarkdown`
// del backend acepten data v1 al leer del vault. NO se exponen al runtime
// API ni se validan con class-validator.
// ─────────────────────────────────────────────────────────────────────

export interface WhatHowWhenLegacy {
  what?: string;
  how?: string;
  when?: string;
}

export interface StoryPoFieldsLegacy {
  background?: string;
  objective?: string;
  userStory?: string;
  whatHowWhen?: WhatHowWhenLegacy | string;
  acceptanceCriteria?: string;
  additionalNotes?: string;
}

export interface StoryTechnicalFieldsLegacy {
  architecture?: string;
  integrationFlow?: string;
  validations?: string[];
  errorHandling?: string[];
  implementationChecklist?: string[];
  contract?: string;
}

export interface StoryQaFieldsLegacy {
  testingStrategy?: string;
  linkedQAMatrixId?: string;
  unitTests?: string;
  happyPath?: string[];
  edgeCases?: string[];
  mocks?: string;
  tools?: string;
}
