'use client';

import { SectionTiptapEditor } from './SectionTiptapEditor';

const QA_PLACEHOLDER = `## Pruebas unitarias

(Estrategia narrativa: qué clases/funciones se testean.)

## Happy path

-

## Edge cases

-

## Mocks

(Qué se mockea, con qué library, fixtures.)

## Herramientas

(Framework + cobertura objetivo + comandos.)`;

interface StoryQATabProps {
  value: string;
  onChange: (md: string) => void;
}

/**
 * Tab "QA" del editor de historias. UN solo editor Tiptap full-feature.
 * Estructura obligatoria: Pruebas unitarias, Happy path, Edge cases, Mocks,
 * Herramientas.
 */
export function StoryQATab({ value, onChange }: StoryQATabProps) {
  const initial = value && value.trim().length > 0 ? value : QA_PLACEHOLDER;
  return (
    <div className="space-y-2">
      <SectionTiptapEditor
        initialMarkdown={initial}
        onChange={onChange}
        variant="paragraph"
        placeholder="Escribe la sección QA en markdown..."
      />
    </div>
  );
}
