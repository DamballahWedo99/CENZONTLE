/**
 * Configuración compartida de extensiones Tiptap.
 *
 * Usado por:
 *   - El editor del vault (`DocumentViewer`)
 *   - El editor de historias (`SectionTiptapEditor`)
 *
 * Conserva el comportamiento existente del vault — listas, tablas, imágenes,
 * links, highlight, task list y serialización a markdown via `tiptap-markdown`.
 */
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TiptapImage from '@tiptap/extension-image';
import { Table as TiptapTable } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TiptapLink from '@tiptap/extension-link';

/** Extensiones para modo edición (link openOnClick=false para permitir edit). */
export const TIPTAP_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bulletList: {
      HTMLAttributes: { class: 'list-disc pl-6 my-2' },
    },
    orderedList: {
      HTMLAttributes: { class: 'list-decimal pl-6 my-2' },
    },
    listItem: {
      HTMLAttributes: { class: 'my-1' },
    },
    blockquote: {
      HTMLAttributes: { class: 'border-l-3 border-border pl-4 my-2 text-muted-foreground' },
    },
  }),
  Markdown.configure({
    // SECURITY: html=false bloquea raw HTML (incluyendo <script>, <img onerror>,
    // <iframe>, event handlers) en el markdown del user/agente IA. Sin esto,
    // tiptap-markdown pasa raw HTML directo a ProseMirror y de ahí al DOM,
    // permitiendo XSS stored. El editor sigue soportando markdown completo
    // (headings, listas, tablas, links, code, blockquotes, task lists).
    html: false,
    tightLists: true,
    transformPastedText: true,
    breaks: true, // GFM: un \n genera <br>, no se colapsa como en CommonMark strict
  }),
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
  TiptapImage,
  TiptapLink.configure({
    openOnClick: false,
    HTMLAttributes: { class: 'text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80' },
  }),
  TiptapTable.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
];

/** Extensiones para modo read-only (link openOnClick=true, target=_blank). */
export const TIPTAP_READONLY_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bulletList: { HTMLAttributes: { class: 'list-disc pl-6 my-2' } },
    orderedList: { HTMLAttributes: { class: 'list-decimal pl-6 my-2' } },
    listItem: { HTMLAttributes: { class: 'my-1' } },
    blockquote: { HTMLAttributes: { class: 'border-l-3 border-border pl-4 my-2 text-muted-foreground' } },
  }),
  // SECURITY: html=false (mismo motivo que TIPTAP_EXTENSIONS arriba).
  Markdown.configure({ html: false, tightLists: true, breaks: true }),
  Highlight,
  TaskList,
  TaskItem.configure({
    nested: true,
    onReadOnlyChecked: () => true,
  }),
  TiptapImage,
  TiptapLink.configure({
    openOnClick: true,
    HTMLAttributes: {
      class: 'text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  }),
  TiptapTable.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
];

/**
 * Helper type-safe para serializar el contenido del editor a markdown.
 * tiptap-markdown registra su storage bajo `editor.storage.markdown` pero
 * el tipo de TS lo expone como `any` — encapsulamos para evitar repetir el cast.
 *
 * Acepta cualquier `Editor | null | undefined`. El cast a `unknown` es
 * intencional porque el `Editor.storage` es un Storage interno de Tiptap que
 * no es asignable al index signature `Record<string, unknown>` directamente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMarkdownFromEditor(editor: any | null | undefined): string {
  if (!editor) return '';
  const markdownStorage = editor.storage?.markdown as { getMarkdown?: () => string } | undefined;
  return markdownStorage?.getMarkdown?.() ?? '';
}
