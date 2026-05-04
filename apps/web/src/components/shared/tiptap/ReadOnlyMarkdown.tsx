'use client';

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { TIPTAP_READONLY_EXTENSIONS } from './extensions';

interface ReadOnlyMarkdownProps {
  /** Markdown source. Re-renderiza si cambia. */
  content: string;
  /** Clase opcional aplicada al `EditorContent` interno. */
  className?: string;
}

/**
 * Renderea markdown como HTML semántico usando Tiptap en modo `editable: false`.
 *
 * Reusable para cualquier vista read-only de markdown — vault, historias, etc.
 * Aplica las mismas extensiones que el modo edit (`TIPTAP_READONLY_EXTENSIONS`)
 * pero con links que abren en `_blank` y task items no-toggleables.
 *
 * Si `content` está vacío, devuelve `null` — el caller decide el placeholder.
 */
export function ReadOnlyMarkdown({ content, className }: ReadOnlyMarkdownProps) {
  const editor = useEditor({
    extensions: TIPTAP_READONLY_EXTENSIONS,
    immediatelyRender: false,
    editable: false,
    content,
    editorProps: {
      attributes: {
        // El selector neutraliza margin-top del primer hijo y margin-bottom del
        // último para evitar asimetría con el padding del card contenedor.
        class:
          className ??
          'outline-none prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0',
      },
    },
  });

  useEffect(() => {
    if (editor) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!content?.trim()) return null;
  return <EditorContent editor={editor} />;
}
