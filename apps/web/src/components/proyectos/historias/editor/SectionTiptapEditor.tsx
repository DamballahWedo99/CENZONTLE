'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { TIPTAP_EXTENSIONS, getMarkdownFromEditor } from '@/components/shared/tiptap/extensions';
import { MiniToolbar, type MiniToolbarVariant } from '@/components/shared/tiptap/MiniToolbar';

interface SectionTiptapEditorProps {
  /** Markdown inicial. Cuando cambia desde fuera, se sincroniza al editor. */
  initialMarkdown: string;
  /** Notifica el markdown actual del editor en cada cambio. */
  onChange: (markdown: string) => void;
  /** Placeholder mostrado cuando el editor está vacío. */
  placeholder?: string;
  /** Restringe la toolbar y los nodos disponibles según el campo. */
  variant?: MiniToolbarVariant;
  /** Llamado al perder focus (blur). El padre puede usarlo para auto-confirm. */
  onBlur?: () => void;
  /** Llamado cuando se presiona Esc adentro del editor. */
  onEscape?: () => void;
  /** Auto-focus al montar (usado cuando se entra en edit mode). */
  autoFocus?: boolean;
}

/**
 * Mini-editor Tiptap reutilizable para una sección individual de una historia.
 *
 * - Usa las mismas extensiones que el vault (`TIPTAP_EXTENSIONS`).
 * - Toolbar full-feature en `paragraph` variant (paridad con vault), restringida
 *   en variants `list`/`tasklist`.
 * - Toggle "Ver markdown ↔ Vista visual" igual al vault — al pasar a source,
 *   muestra textarea con el markdown crudo; al volver a visual, lo re-parsea
 *   en Tiptap. Esto permite power-users editar markdown directamente.
 * - Serializa contenido a markdown via `editor.storage.markdown.getMarkdown()`.
 */
export function SectionTiptapEditor({
  initialMarkdown,
  onChange,
  placeholder,
  variant = 'paragraph',
  onBlur,
  onEscape,
  autoFocus = false,
}: SectionTiptapEditorProps) {
  // Snapshot del último markdown emitido — evita re-set spurious cuando el padre
  // re-renderea con el mismo valor (causa cursor jumps).
  const lastEmittedRef = useRef<string>(initialMarkdown);
  // Toggle entre vista visual (Tiptap) y vista source (textarea con markdown).
  const [showSource, setShowSource] = useState(false);
  const [sourceBuffer, setSourceBuffer] = useState(initialMarkdown);

  // El array de extensiones de Tiptap es invariante en su elemento type — al
  // mezclar StarterKit + Markdown + Placeholder cada uno tiene su propio
  // generic, así que el tipo conjunto se reduce al union explícito o `any[]`.
  // Usamos cast porque la verificación runtime la hace Tiptap por nosotros.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extensions = useMemo<any[]>(() => {
    const base = [...TIPTAP_EXTENSIONS];
    if (placeholder) {
      base.push(
        Placeholder.configure({
          placeholder,
          showOnlyWhenEditable: true,
          showOnlyCurrent: false,
          emptyEditorClass:
            'before:content-[attr(data-placeholder)] before:text-muted-foreground/60 before:float-left before:pointer-events-none before:h-0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
    }
    return base;
  }, [placeholder]);

  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    content: initialMarkdown,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class:
          'outline-none px-3 py-2 prose prose-sm dark:prose-invert max-w-none min-h-[60px] [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && onEscape) {
          event.preventDefault();
          onEscape();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const md = getMarkdownFromEditor(e);
      lastEmittedRef.current = md;
      setSourceBuffer(md);
      onChange(md);
    },
    onBlur: () => {
      onBlur?.();
    },
  });

  // Sync externo → editor cuando initialMarkdown cambia y NO viene del propio
  // editor (evita ciclo). Útil cuando el padre carga datos lazy.
  useEffect(() => {
    if (!editor) return;
    if (initialMarkdown === lastEmittedRef.current) return;
    editor.commands.setContent(initialMarkdown, { emitUpdate: false });
    lastEmittedRef.current = initialMarkdown;
    setSourceBuffer(initialMarkdown);
  }, [initialMarkdown, editor]);

  // Cuando se vuelve de source a visual, re-parsea el textarea al editor.
  // Solo si difiere del último estado del editor para no resetear el cursor.
  useEffect(() => {
    if (!editor || showSource) return;
    if (sourceBuffer !== lastEmittedRef.current) {
      editor.commands.setContent(sourceBuffer);
      lastEmittedRef.current = sourceBuffer;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSource]);

  return (
    <div className="rounded-md border border-border bg-background">
      <MiniToolbar
        editor={editor}
        variant={variant}
        showSource={showSource}
        onToggleSource={() => setShowSource((v) => !v)}
      />
      {showSource ? (
        <textarea
          value={sourceBuffer}
          onChange={(e) => {
            setSourceBuffer(e.target.value);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && onEscape) {
              e.preventDefault();
              onEscape();
            }
          }}
          className="w-full min-h-[120px] outline-none px-3 py-2 font-mono text-xs bg-transparent resize-y"
          spellCheck={false}
          autoFocus={autoFocus}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
