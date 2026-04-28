'use client';

import { SectionTiptapEditor } from './SectionTiptapEditor';

const TECHNICAL_PLACEHOLDER = `## Arquitectura y componentes

(Capa, propósito, componentes clave, patrón.)

## Flujo de integración

(Secuencia de llamadas paso a paso, fuentes de datos.)

## Validaciones

-

## Manejo de errores

-

## Contrato

(Schema de request/response, GraphQL SDL, JSON Schema, OpenAPI snippet...)`;

interface StoryTechnicalTabProps {
  value: string;
  onChange: (md: string) => void;
}

/**
 * Tab "Technical" del editor de historias. UN solo editor Tiptap full-feature.
 * Estructura obligatoria: Arquitectura, Flujo de integración, Validaciones,
 * Manejo de errores, Contrato.
 */
export function StoryTechnicalTab({ value, onChange }: StoryTechnicalTabProps) {
  const initial = value && value.trim().length > 0 ? value : TECHNICAL_PLACEHOLDER;
  return (
    <div className="space-y-2">
      <SectionTiptapEditor
        initialMarkdown={initial}
        onChange={onChange}
        variant="paragraph"
        placeholder="Escribe la sección Technical en markdown..."
      />
    </div>
  );
}
