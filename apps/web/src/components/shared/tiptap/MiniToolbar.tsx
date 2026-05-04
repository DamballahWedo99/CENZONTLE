'use client';

import { useState, useRef, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare,
  Code, Quote, Minus,
  Link as LinkIcon, Table, Image,
  Eye, Code2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type MiniToolbarItem = {
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

/**
 * Toolbar full-feature para el editor Tiptap. Misma capacidad que la del
 * vault (`WysiwygToolbar` en `DocumentViewer.tsx`) — bold, italic, strike,
 * highlight, headings 1-3, lists, tasklist, code, quote, hr, link, table,
 * image, y toggle source/visual.
 *
 * El parámetro `variant` controla restricciones para sub-campos estructurados:
 *   - `paragraph` (default): set completo — equivalente al vault.
 *   - `list`: solo inline + bullet/ordered + link. Esconde headings/tasklist
 *     porque el campo es típicamente una lista de items cortos (ej: validations).
 *   - `tasklist`: inline + tasklist + link. Para acceptanceCriteria estilo
 *     "Dado/Cuando/Entonces" con checkboxes.
 */
function MiniPopoverButton({
  icon: Icon,
  label,
  shortcut,
  placeholder,
  onSubmit,
  className,
}: {
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
            <button
              type="button"
              className={className}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Icon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
          {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-72 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex gap-2">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
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

export type MiniToolbarVariant = 'paragraph' | 'list' | 'tasklist';

interface MiniToolbarProps {
  editor: Editor | null;
  variant: MiniToolbarVariant;
  /** Si está set, muestra el toggle source/visual al final (paragraph variant). */
  showSource?: boolean;
  onToggleSource?: () => void;
}

export function MiniToolbar({ editor, variant, showSource, onToggleSource }: MiniToolbarProps) {
  const items = useMemo((): (MiniToolbarItem | 'sep')[] => {
    if (!editor) return [];

    // ── Bloque inline (siempre disponible en todas las variantes) ──
    const inline: MiniToolbarItem[] = [
      {
        icon: Bold,
        label: 'Negrita',
        shortcut: 'Ctrl+B',
        action: () => editor.chain().focus().toggleBold().run(),
        isActive: () => editor.isActive('bold'),
      },
      {
        icon: Italic,
        label: 'Cursiva',
        shortcut: 'Ctrl+I',
        action: () => editor.chain().focus().toggleItalic().run(),
        isActive: () => editor.isActive('italic'),
      },
      {
        icon: Strikethrough,
        label: 'Tachado',
        shortcut: 'Ctrl+Shift+X',
        action: () => editor.chain().focus().toggleStrike().run(),
        isActive: () => editor.isActive('strike'),
      },
      {
        icon: Highlighter,
        label: 'Resaltado',
        shortcut: 'Ctrl+Shift+H',
        action: () => editor.chain().focus().toggleHighlight().run(),
        isActive: () => editor.isActive('highlight'),
      },
    ];

    const linkItem: MiniToolbarItem = {
      icon: LinkIcon,
      label: 'Enlace',
      shortcut: 'Ctrl+K',
      action: () => {
        if (editor.isActive('link')) editor.chain().focus().unsetLink().run();
      },
      isActive: () => editor.isActive('link'),
      popover: {
        placeholder: 'https://ejemplo.com',
        onSubmit: (url: string) => editor.chain().focus().setLink({ href: url }).run(),
      },
    };

    // ── Variant restringidos: list (sin headings/tasklist) ──
    if (variant === 'list') {
      return [
        ...inline,
        'sep',
        {
          icon: List,
          label: 'Lista',
          action: () => editor.chain().focus().toggleBulletList().run(),
          isActive: () => editor.isActive('bulletList'),
        },
        {
          icon: ListOrdered,
          label: 'Lista numerada',
          action: () => editor.chain().focus().toggleOrderedList().run(),
          isActive: () => editor.isActive('orderedList'),
        },
        'sep',
        linkItem,
      ];
    }

    // ── Variant restringidos: tasklist (inline + tasklist + link) ──
    if (variant === 'tasklist') {
      return [
        ...inline,
        'sep',
        {
          icon: CheckSquare,
          label: 'Checklist',
          action: () => editor.chain().focus().toggleTaskList().run(),
          isActive: () => editor.isActive('taskList'),
        },
        'sep',
        linkItem,
      ];
    }

    // ── Variant `paragraph`: set completo (paridad con vault toolbar) ──
    return [
      ...inline,
      'sep',
      {
        icon: Heading1,
        label: 'Título 1',
        action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: () => editor.isActive('heading', { level: 1 }),
      },
      {
        icon: Heading2,
        label: 'Título 2',
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: () => editor.isActive('heading', { level: 2 }),
      },
      {
        icon: Heading3,
        label: 'Título 3',
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: () => editor.isActive('heading', { level: 3 }),
      },
      'sep',
      {
        icon: List,
        label: 'Lista',
        action: () => editor.chain().focus().toggleBulletList().run(),
        isActive: () => editor.isActive('bulletList'),
      },
      {
        icon: ListOrdered,
        label: 'Lista numerada',
        action: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: () => editor.isActive('orderedList'),
      },
      {
        icon: CheckSquare,
        label: 'Checklist',
        action: () => editor.chain().focus().toggleTaskList().run(),
        isActive: () => editor.isActive('taskList'),
      },
      'sep',
      {
        icon: Code,
        label: 'Código',
        shortcut: 'Ctrl+E',
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
        icon: Quote,
        label: 'Cita',
        action: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: () => editor.isActive('blockquote'),
      },
      {
        icon: Minus,
        label: 'Línea horizontal',
        action: () => editor.chain().focus().setHorizontalRule().run(),
      },
      'sep',
      linkItem,
      {
        icon: Table,
        label: 'Tabla',
        action: () =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        icon: Image,
        label: 'Imagen',
        action: () => {},
        popover: {
          placeholder: 'https://ejemplo.com/imagen.png',
          onSubmit: (url: string) => editor.chain().focus().setImage({ src: url }).run(),
        },
      },
    ];
  }, [editor, variant]);

  if (!editor) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="sticky top-0 z-10 flex items-center gap-0.5 px-3 py-1.5 border-b border-border/50 bg-muted/95 backdrop-blur-sm overflow-x-auto shrink-0 rounded-t-md">
        {items.map((item, i) => {
          if (item === 'sep') {
            // Div explícito con bg-foreground/20 — el componente Separator de
            // shadcn usa `bg-border` que en theme oscuro casi se camufla con el
            // fondo `bg-muted/40` del contenedor (ambos son grises sutiles).
            // Foreground/20 da contraste suficiente sin ser intrusivo.
            return (
              <div
                key={`sep-${i}`}
                role="separator"
                aria-orientation="vertical"
                className="h-5 w-px mx-1.5 shrink-0 bg-foreground/20"
              />
            );
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
              <MiniPopoverButton
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
                  onMouseDown={(e) => { e.preventDefault(); item.action(); }}
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

        {/* Toggle Visual ↔ Source markdown — solo cuando el caller lo activa.
            La sección Tiptap maneja el render condicional del textarea. */}
        {onToggleSource && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              className="h-5 w-px mx-1.5 shrink-0 bg-foreground/20"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`p-1.5 rounded-md transition-colors ${
                    showSource
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  onMouseDown={(e) => { e.preventDefault(); onToggleSource(); }}
                >
                  {showSource ? <Eye className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {showSource ? 'Vista visual' : 'Ver markdown'}
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
