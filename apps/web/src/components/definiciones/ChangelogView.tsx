'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import {
  FilePlus, Pencil, Trash2, FileEdit, FolderInput, Tag, ArrowUpDown,
  Folder, FileText, Clock, ArrowRight, User,
} from 'lucide-react';
import { useDefiniciones, ChangelogAction, ChangelogEntry } from '@/context/DefinicionesContext';

const VIEWER_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] },
    bulletList: { HTMLAttributes: { class: 'list-disc pl-6 my-2' } },
    orderedList: { HTMLAttributes: { class: 'list-decimal pl-6 my-2' } },
    listItem: { HTMLAttributes: { class: 'my-1' } },
  }),
  Markdown.configure({ html: true, tightLists: true }),
  Highlight, TaskList, TaskItem.configure({ nested: true }),
  TiptapImage,
  TiptapTable.configure({ resizable: false }), TableRow, TableCell, TableHeader,
];

const ACTION_CONFIG: Record<ChangelogAction, {
  icon: React.ElementType;
  label: string;
  color: string;
  dotColor: string;
}> = {
  create:  { icon: FilePlus,    label: 'Creado',     color: 'text-green-500',  dotColor: 'bg-green-500' },
  edit:    { icon: Pencil,      label: 'Editado',    color: 'text-blue-500',   dotColor: 'bg-blue-500' },
  delete:  { icon: Trash2,      label: 'Eliminado',  color: 'text-red-500',    dotColor: 'bg-red-500' },
  rename:  { icon: FileEdit,    label: 'Renombrado', color: 'text-amber-500',  dotColor: 'bg-amber-500' },
  move:    { icon: FolderInput, label: 'Movido',     color: 'text-amber-500',  dotColor: 'bg-amber-500' },
  tags:    { icon: Tag,         label: 'Tags',       color: 'text-purple-500', dotColor: 'bg-purple-500' },
  reorder: { icon: ArrowUpDown, label: 'Reordenado', color: 'text-gray-500',   dotColor: 'bg-gray-500' },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function getDateGroup(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';

  const diffDays = Math.floor((today.getTime() - date.getTime()) / 86400000);
  if (diffDays < 7) return 'Esta semana';
  if (diffDays < 30) return 'Este mes';
  return date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

function EntryDetail({ entry }: { entry: ChangelogEntry }) {
  const { details } = entry;
  if (!details) return null;

  const parts: string[] = [];
  if (details.oldName && details.newName) parts.push(`"${details.oldName}" → "${details.newName}"`);
  if (details.parentName) parts.push(`en ${details.parentName}`);
  if (details.addedTags?.length) parts.push(`+${details.addedTags.join(', +')}`);
  if (details.removedTags?.length) parts.push(`-${details.removedTags.join(', -')}`);
  if (details.contentPreview && entry.action === 'edit') {
    parts.push(details.contentPreview.length > 50 ? details.contentPreview.slice(0, 50) + '…' : details.contentPreview);
  }
  if (parts.length === 0) return null;
  return <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">{parts.join(' · ')}</p>;
}

/* ─── Content Preview Panel ─── */

function ContentPreview({ content, label }: { content: string; label: string }) {
  const editor = useEditor({
    extensions: VIEWER_EXTENSIONS,
    immediatelyRender: false,
    editable: false,
    content,
    editorProps: {
      attributes: { class: 'outline-none p-4 prose prose-sm dark:prose-invert max-w-none text-sm' },
    },
  });

  // Sync editor content when the prop changes (useEditor only uses content on mount)
  useEffect(() => {
    if (editor && content !== undefined) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-border/50 bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function DiffPreview({ entry }: { entry: ChangelogEntry }) {
  const { details, action } = entry;
  const config = ACTION_CONFIG[action];

  const hasBeforeAfter = details?.previousContent !== undefined || details?.newContent !== undefined;

  if (!hasBeforeAfter) {
    // Non-content change: show summary card
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-6">
        <div className="text-center space-y-3 max-w-sm">
          <div className={`p-3 rounded-xl ${config.color} bg-current/5 w-fit mx-auto`}>
            <config.icon className="h-8 w-8" />
          </div>
          <div>
            <p className="text-base font-medium text-foreground">{config.label}</p>
            <p className="text-sm mt-1">{entry.nodeName}</p>
            {details?.oldName && details?.newName && (
              <div className="flex items-center gap-2 justify-center mt-2 text-sm">
                <span className="line-through text-red-400">{details.oldName}</span>
                <ArrowRight className="h-3 w-3" />
                <span className="text-green-500">{details.newName}</span>
              </div>
            )}
            {details?.parentName && <p className="text-xs mt-1">Carpeta: {details.parentName}</p>}
            {details?.addedTags && details.addedTags.length > 0 && (
              <div className="flex gap-1 flex-wrap justify-center mt-2">
                {details.addedTags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-600 rounded-full">+{t}</span>)}
              </div>
            )}
            {details?.removedTags && details.removedTags.length > 0 && (
              <div className="flex gap-1 flex-wrap justify-center mt-1">
                {details.removedTags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded-full">-{t}</span>)}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground/50">
            {entry.userName && <>{entry.userName} · </>}
            {new Date(entry.timestamp).toLocaleString('es-MX')}
          </p>
        </div>
      </div>
    );
  }

  // Content change: show before/after
  if (action === 'create') {
    return <ContentPreview content={details?.newContent ?? ''} label="Contenido creado" />;
  }

  if (action === 'delete') {
    return <ContentPreview content={details?.previousContent ?? ''} label="Contenido eliminado" />;
  }

  // Edit: show side-by-side
  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 border-r border-border/50 flex flex-col min-h-0">
        <ContentPreview content={details?.previousContent ?? ''} label="Antes" />
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <ContentPreview content={details?.newContent ?? ''} label="Después" />
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export function ChangelogView({ onNavigateToNode }: { onNavigateToNode: (nodeId: string) => void }) {
  const { changelog } = useDefiniciones();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const selectedEntry = useMemo(
    () => changelog.find(e => e.id === selectedEntryId) ?? null,
    [changelog, selectedEntryId],
  );

  // Group by date
  const groups = useMemo(() => {
    const result: { label: string; entries: ChangelogEntry[] }[] = [];
    let currentGroup = '';
    for (const entry of changelog) {
      const group = getDateGroup(entry.timestamp);
      if (group !== currentGroup) {
        currentGroup = group;
        result.push({ label: group, entries: [] });
      }
      result[result.length - 1].entries.push(entry);
    }
    return result;
  }, [changelog]);

  if (changelog.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-3">
          <div className="p-4 rounded-2xl bg-primary/5 w-fit mx-auto">
            <Clock className="h-10 w-10 text-primary/30" />
          </div>
          <div>
            <p className="text-lg font-medium">Sin actividad</p>
            <p className="text-sm">Los cambios que hagas aparecerán aquí</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Left: Timeline */}
      <div className="w-80 shrink-0 border-r border-border/50 overflow-y-auto bg-muted/10">
        <div className="p-4">
          {groups.map(group => (
            <div key={group.label} className="mb-2">
              <div className="sticky top-0 z-10 bg-muted/10 backdrop-blur-sm py-1.5 mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </span>
              </div>
              {group.entries.map(entry => {
                const config = ACTION_CONFIG[entry.action];
                const Icon = config.icon;
                const NodeIcon = entry.nodeType === 'folder' ? Folder : FileText;
                const isSelected = selectedEntryId === entry.id;

                return (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntryId(isSelected ? null : entry.id)}
                    className={`w-full text-left mb-1 rounded-lg p-2.5 transition-colors ${
                      isSelected
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-muted/50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${config.dotColor} shrink-0`} />
                      <Icon className={`h-3 w-3 ${config.color} shrink-0`} />
                      <span className="text-xs font-medium text-muted-foreground">{config.label}</span>
                      <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 ml-5">
                      <NodeIcon className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                      <span className={`text-sm truncate ${entry.action === 'delete' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {entry.nodeName}
                      </span>
                    </div>
                    {entry.userName && (
                      <div className="flex items-center gap-1 mt-0.5 ml-5">
                        <User className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                        <span className="text-[10px] text-muted-foreground/60 truncate">{entry.userName}</span>
                      </div>
                    )}
                    <EntryDetail entry={entry} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Preview */}
      <div className="flex-1 flex flex-col min-h-0">
        {selectedEntry ? (
          <DiffPreview entry={selectedEntry} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <Clock className="h-8 w-8 mx-auto opacity-20" />
              <p className="text-sm">Selecciona una entrada para ver los detalles</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
