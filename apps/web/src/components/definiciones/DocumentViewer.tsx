'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
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
import {
  Pencil, Save, Tag, Clock, BookOpen, Folder, FileText, X, Plus,
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Code, Quote, Minus, Link, Table, Image,
  Highlighter, Code2, Eye,
} from 'lucide-react';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { DefinicionNode } from '@/types/definiciones';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';

/* ─── Tag helpers ─── */

function collectAllTags(nodes: DefinicionNode[]): string[] {
  const tagSet = new Set<string>();
  function traverse(items: DefinicionNode[]) {
    for (const item of items) {
      if (item.tags) item.tags.forEach(t => tagSet.add(t));
      if (item.children) traverse(item.children);
    }
  }
  traverse(nodes);
  return Array.from(tagSet).sort();
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { state } = useDefiniciones();
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const allTags = useMemo(() => collectAllTags(state.tree), [state.tree]);

  const suggestions = useMemo(() => {
    if (!newTag.trim()) return [];
    const query = newTag.toLowerCase();
    return allTags
      .filter(t => t.includes(query) && !tags.includes(t))
      .slice(0, 8);
  }, [newTag, allTags, tags]);

  useEffect(() => {
    if (isAdding) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isAdding]);

  useEffect(() => {
    setSelectedSuggestion(0);
  }, [suggestions.length]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setNewTag('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0 && newTag.trim()) {
        addTag(suggestions[selectedSuggestion]);
      } else if (newTag.trim()) {
        addTag(newTag);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestion(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestion(i => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setNewTag('');
      setIsAdding(false);
    } else if (e.key === 'Backspace' && !newTag && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        if (newTag.trim()) addTag(newTag);
        setIsAdding(false);
      }
    }, 150);
  };

  const handleRemove = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  return (
    <div ref={containerRef} className="flex items-center gap-1.5 flex-wrap relative">
      <Tag className="h-3 w-3 text-primary/60 shrink-0" />
      {tags.map(tag => (
        <Badge key={tag} variant="secondary" className="text-[11px] font-normal shrink gap-1 group/tag bg-primary/10 text-primary hover:bg-primary/20 border-0">
          {tag}
          <button
            onClick={() => handleRemove(tag)}
            className="hidden group-hover/tag:inline-flex hover:text-destructive"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      {isAdding ? (
        <div className="relative">
          <input
            ref={inputRef}
            className="bg-transparent border border-border rounded-full px-2 py-0.5 text-[11px] outline-none w-28 focus:border-primary focus:w-36 transition-all"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="agregar tag..."
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    i === selectedSuggestion ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                  onMouseDown={e => { e.preventDefault(); addTag(s); }}
                  onMouseEnter={() => setSelectedSuggestion(i)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="text-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}


/* ─── TipTap WYSIWYG Toolbar ─── */

type ToolbarItem = {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  action: () => void;
  isActive?: () => boolean;
  popover?: {
    placeholder: string;
    onSubmit: (value: string) => void;
  };
};

function ToolbarPopoverButton({ icon: Icon, label, shortcut, placeholder, onSubmit, className }: {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setTimeout(() => inputRef.current?.focus(), 50); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" className={className} onMouseDown={e => e.preventDefault()}>
              <Icon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
          {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-72 p-2" onOpenAutoFocus={e => e.preventDefault()}>
        <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} className="flex gap-2">
          <Input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" className="h-8 px-3 shrink-0">
            OK
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function WysiwygToolbar({ items, showSource, onToggleSource }: {
  items: (ToolbarItem | 'sep')[];
  showSource: boolean;
  onToggleSource: () => void;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border/50 bg-muted/40 overflow-x-auto shrink-0">
        {items.map((item, i) => {
          if (item === 'sep') {
            return <Separator key={`sep-${i}`} orientation="vertical" className="h-5 mx-1" />;
          }
          const Icon = item.icon;
          const active = item.isActive?.() ?? false;
          const btnClass = `p-1.5 rounded-md transition-colors ${
            active
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`;

          if (item.popover) {
            return (
              <ToolbarPopoverButton
                key={item.label}
                icon={Icon}
                label={item.label}
                shortcut={item.shortcut}
                placeholder={item.popover.placeholder}
                onSubmit={item.popover.onSubmit}
                className={btnClass}
              />
            );
          }

          return (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={btnClass}
                  onMouseDown={e => { e.preventDefault(); item.action(); }}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {item.label}
                {item.shortcut && <span className="ml-2 text-muted-foreground">{item.shortcut}</span>}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <Separator orientation="vertical" className="h-5 mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`p-1.5 rounded-md transition-colors ${
                showSource
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onMouseDown={e => { e.preventDefault(); onToggleSource(); }}
            >
              {showSource ? <Eye className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {showSource ? 'Vista visual' : 'Ver markdown'}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/* ─── TipTap extensions ─── */

const TIPTAP_EXTENSIONS = [
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
    html: true,
    tightLists: true,
    transformPastedText: true,
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

/* ─── Read-only viewer using TipTap ─── */

function ReadOnlyViewer({ content, onContentChange }: { content: string; onContentChange?: (markdown: string) => void }) {
  const readOnlyExtensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      bulletList: { HTMLAttributes: { class: 'list-disc pl-6 my-2' } },
      orderedList: { HTMLAttributes: { class: 'list-decimal pl-6 my-2' } },
      listItem: { HTMLAttributes: { class: 'my-1' } },
      blockquote: { HTMLAttributes: { class: 'border-l-3 border-border pl-4 my-2 text-muted-foreground' } },
    }),
    Markdown.configure({ html: true, tightLists: true }),
    Highlight,
    TaskList,
    TaskItem.configure({
      nested: true,
      onReadOnlyChecked: () => true,
    }),
    TiptapImage,
    TiptapLink.configure({
      openOnClick: true,
      HTMLAttributes: { class: 'text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80', target: '_blank', rel: 'noopener noreferrer' },
    }),
    TiptapTable.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
  ], []);

  const viewer = useEditor({
    extensions: readOnlyExtensions,
    immediatelyRender: false,
    editable: false,
    content,
    editorProps: {
      attributes: {
        class: 'outline-none p-6 prose prose-sm dark:prose-invert max-w-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      if (onContentChange) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onContentChange((e.storage as any).markdown.getMarkdown());
      }
    },
  });

  useEffect(() => {
    if (viewer) {
      viewer.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, viewer]);

  return (
    <div className="p-6">
      <div className="bg-card rounded-lg border border-border/40 shadow-sm">
        <EditorContent editor={viewer} />
      </div>
    </div>
  );
}

/* ─── Main component ─── */

export function DocumentViewer() {
  const { selectedNode, state, toggleEditing, updateContent, selectNode, updateTags } = useDefiniciones();
  const [editBuffer, setEditBuffer] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [, setEditorTick] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentOnEditStart = useRef<string>('');
  const userHasEdited = useRef(false);

  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    immediatelyRender: false,
    content: selectedNode?.content ?? '',
    editorProps: {
      attributes: {
        class: 'outline-none p-6 min-h-full prose prose-sm dark:prose-invert max-w-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (e.storage as any).markdown.getMarkdown();
      setEditBuffer(md);
      userHasEdited.current = true;
      setEditorTick(t => t + 1);
    },
    onSelectionUpdate: () => {
      setEditorTick(t => t + 1);
    },
  });

  // Sync content when selecting a new node or entering edit mode
  useEffect(() => {
    const content = selectedNode?.content ?? '';
    setEditBuffer(content);
    userHasEdited.current = false;
    if (editor) {
      // Load without triggering onUpdate to avoid marking as "edited"
      editor.commands.setContent(content, { emitUpdate: false });
      // Capture the re-serialized baseline for accurate diff
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseline = (editor.storage as any).markdown.getMarkdown();
      contentOnEditStart.current = baseline;
      setEditBuffer(baseline);
    }
  }, [selectedNode?.id, state.isEditing]);

  // Sync from source textarea back to TipTap when switching from source to visual
  useEffect(() => {
    if (!showSource && editor && state.isEditing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentTiptap = (editor.storage as any).markdown.getMarkdown();
      if (currentTiptap !== editBuffer) {
        editor.commands.setContent(editBuffer);
      }
    }
  }, [showSource]);

  // Build toolbar items from TipTap editor
  const toolbarItems = useMemo((): (ToolbarItem | 'sep')[] => {
    if (!editor) return [];
    return [
      {
        icon: Bold, label: 'Negrita', shortcut: 'Ctrl+B',
        action: () => editor.chain().focus().toggleBold().run(),
        isActive: () => editor.isActive('bold'),
      },
      {
        icon: Italic, label: 'Cursiva', shortcut: 'Ctrl+I',
        action: () => editor.chain().focus().toggleItalic().run(),
        isActive: () => editor.isActive('italic'),
      },
      {
        icon: Strikethrough, label: 'Tachado', shortcut: 'Ctrl+Shift+X',
        action: () => editor.chain().focus().toggleStrike().run(),
        isActive: () => editor.isActive('strike'),
      },
      {
        icon: Highlighter, label: 'Resaltado', shortcut: 'Ctrl+Shift+H',
        action: () => editor.chain().focus().toggleHighlight().run(),
        isActive: () => editor.isActive('highlight'),
      },
      'sep',
      {
        icon: Heading1, label: 'Título 1',
        action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: () => editor.isActive('heading', { level: 1 }),
      },
      {
        icon: Heading2, label: 'Título 2',
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: () => editor.isActive('heading', { level: 2 }),
      },
      {
        icon: Heading3, label: 'Título 3',
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: () => editor.isActive('heading', { level: 3 }),
      },
      'sep',
      {
        icon: List, label: 'Lista',
        action: () => editor.chain().focus().toggleBulletList().run(),
        isActive: () => editor.isActive('bulletList'),
      },
      {
        icon: ListOrdered, label: 'Lista numerada',
        action: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: () => editor.isActive('orderedList'),
      },
      {
        icon: CheckSquare, label: 'Checklist',
        action: () => editor.chain().focus().toggleTaskList().run(),
        isActive: () => editor.isActive('taskList'),
      },
      'sep',
      {
        icon: Code, label: 'Código', shortcut: 'Ctrl+E',
        action: () => {
          if (editor.isActive('codeBlock')) {
            editor.chain().focus().toggleCodeBlock().run();
          } else {
            editor.chain().focus().toggleCode().run();
          }
        },
        isActive: () => editor.isActive('code') || editor.isActive('codeBlock'),
      },
      {
        icon: Quote, label: 'Cita',
        action: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: () => editor.isActive('blockquote'),
      },
      {
        icon: Minus, label: 'Línea horizontal',
        action: () => editor.chain().focus().setHorizontalRule().run(),
      },
      'sep',
      {
        icon: Link, label: 'Enlace', shortcut: 'Ctrl+K',
        action: () => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
          }
        },
        isActive: () => editor.isActive('link'),
        popover: {
          placeholder: 'https://ejemplo.com',
          onSubmit: (url: string) => editor.chain().focus().setLink({ href: url }).run(),
        },
      },
      {
        icon: Table, label: 'Tabla',
        action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        icon: Image, label: 'Imagen',
        action: () => {},
        popover: {
          placeholder: 'https://ejemplo.com/imagen.png',
          onSubmit: (url: string) => editor.chain().focus().setImage({ src: url }).run(),
        },
      },
    ];
  }, [editor]);

  if (!selectedNode) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/20">
        <div className="text-center space-y-3">
          <div className="p-4 rounded-2xl bg-primary/5 w-fit mx-auto">
            <BookOpen className="h-10 w-10 text-primary/30" />
          </div>
          <div>
            <p className="text-lg font-medium">Selecciona un documento</p>
            <p className="text-sm">Elige un archivo del explorador para ver su contenido</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedNode.type === 'folder') {
    const children = selectedNode.children ?? [];
    const folders = children.filter(c => c.type === 'folder');
    const documents = children.filter(c => c.type === 'document');

    return (
      <div className="flex-1 overflow-y-auto p-6 bg-muted/20">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-1.5 rounded-md bg-primary/10">
              <Folder className="h-4 w-4 text-primary/70" />
            </div>
            <h2 className="text-lg font-semibold">{selectedNode.name}</h2>
          </div>
          <p className="text-sm text-muted-foreground ml-10">
            {folders.length > 0 && `${folders.length} ${folders.length === 1 ? 'carpeta' : 'carpetas'}`}
            {folders.length > 0 && documents.length > 0 && ' · '}
            {documents.length > 0 && `${documents.length} ${documents.length === 1 ? 'documento' : 'documentos'}`}
            {children.length === 0 && 'Carpeta vacía'}
          </p>
        </div>

        {children.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {children.map(child => (
              <button
                key={child.id}
                onClick={() => selectNode(child.id)}
                className="text-left rounded-lg border border-border/40 bg-card p-4 hover:bg-card hover:border-primary/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-2 mb-2">
                  {child.type === 'folder'
                    ? <Folder className="h-4 w-4 text-primary/50 group-hover:text-primary/70 transition-colors" />
                    : <FileText className="h-4 w-4 text-primary/50 group-hover:text-primary/70 transition-colors" />
                  }
                  <span className="font-medium text-sm truncate">{child.name}</span>
                </div>
                {child.type === 'document' && child.content && (
                  <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                    {child.content.replace(/^#.*\n/gm, '').replace(/[#*|`\->\[\]]/g, '').trim().slice(0, 150)}
                  </p>
                )}
                {child.type === 'folder' && child.children && (
                  <p className="text-xs text-muted-foreground">
                    {child.children.length} {child.children.length === 1 ? 'elemento' : 'elementos'}
                  </p>
                )}
                {child.tags && child.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {child.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-primary/8 rounded-full text-primary/70">
                        {tag}
                      </span>
                    ))}
                    {child.tags.length > 3 && (
                      <span className="text-[10px] text-muted-foreground/50">+{child.tags.length - 3}</span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const handleSave = () => {
    if (userHasEdited.current) {
      updateContent(selectedNode.id, editBuffer, contentOnEditStart.current);
    }
    userHasEdited.current = false;
    setShowSource(false);
    toggleEditing();
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border/50 shrink-0 space-y-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold truncate">{selectedNode.name}</h2>
            {state.isEditing ? (
              <button onClick={handleSave} className="text-muted-foreground hover:text-primary transition-colors shrink-0" title="Guardar">
                <Save className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={toggleEditing} className="text-muted-foreground hover:text-primary transition-colors shrink-0" title="Editar">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <span className="hidden md:flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {formatDate(selectedNode.updatedAt)}
          </span>
        </div>
        <TagEditor
          tags={selectedNode.tags || []}
          onChange={tags => updateTags(selectedNode.id, tags)}
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 bg-muted/20">
        {state.isEditing && (
          <WysiwygToolbar
            items={toolbarItems}
            showSource={showSource}
            onToggleSource={() => setShowSource(s => !s)}
          />
        )}
        {state.isEditing ? (
          <div className="flex-1 overflow-y-auto">
            {showSource ? (
              /* Source mode: raw markdown textarea */
              <textarea
                ref={textareaRef}
                className="w-full h-full p-6 bg-background resize-none outline-none font-mono text-sm leading-relaxed"
                value={editBuffer}
                onChange={e => setEditBuffer(e.target.value)}
                spellCheck={false}
              />
            ) : (
              /* Visual mode: TipTap WYSIWYG editor */
              <EditorContent editor={editor} className="h-full" />
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <ReadOnlyViewer
              content={selectedNode.content || ''}
              onContentChange={(md) => updateContent(selectedNode.id, md)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
