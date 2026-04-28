'use client';

import { SectionTiptapEditor } from './SectionTiptapEditor';

/**
 * Placeholder con la estructura mínima sugerida. El user lo ve cuando el
 * markdown está vacío y empieza a escribir. Los headings son obligatorios
 * según el prompt al agente IA — el agente los genera automáticamente y el
 * user los puede modificar pero debería preservarlos para que el resto del
 * sistema (Linear publish, exports) renderice las secciones correctamente.
 */
const PO_PLACEHOLDER = `## Antecedentes

## Objetivo

## Historia de usuario

Como [rol], quiero [acción] para [beneficio].

## What/How/When

**What:**

**How:**

**When:**

## Criterios de aceptación

1.
2.
3.

## Notas adicionales

(opcional)`;

interface StoryPOTabProps {
  /** Markdown de la sección PO. */
  value: string;
  /** Callback cuando el user edita. */
  onChange: (md: string) => void;
}

/**
 * Tab "Product Owner" del editor de historias. UN solo editor Tiptap
 * full-feature reemplaza los N EditableSection del shape v1. La estructura
 * obligatoria (Antecedentes, Objetivo, Historia, What/How/When, Criterios,
 * Notas) se sugiere via placeholder y se asegura via prompt al agente.
 */
export function StoryPOTab({ value, onChange }: StoryPOTabProps) {
  // Si el markdown está vacío Y el user no ha tocado, mostramos el placeholder
  // como contenido inicial — escribe directo encima. Si ya hay contenido,
  // muestra el contenido tal cual.
  const initial = value && value.trim().length > 0 ? value : PO_PLACEHOLDER;
  return (
    <div className="space-y-2">
      <SectionTiptapEditor
        initialMarkdown={initial}
        onChange={onChange}
        variant="paragraph"
        placeholder="Escribe la sección Product Owner en markdown..."
      />
    </div>
  );
}
