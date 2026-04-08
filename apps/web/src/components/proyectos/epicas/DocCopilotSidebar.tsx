'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Epic, UserStory, EpicDocument, EpicDocumentSection } from '@cenzontle/shared';
import {
  CopilotMessage,
  CopilotDocPreview,
  CopilotContext,
  sendCopilotMessage,
  suggestedPrompts,
} from '@/lib/doc-copilot-agent';
import { exportToPDF, exportToExcel, exportToWord, exportToCSV } from '@/lib/doc-exporter';
import {
  SendHorizontal,
  Sparkles,
  FileText,
  Loader2,
  Check,
  X,
  Pencil,
  Download,
  ChevronDown,
  ChevronUp,
  Bot,
  FileSpreadsheet,
  FileType,
  Table2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SIDEBAR_MIN_WIDTH = 340;
const SIDEBAR_MAX_WIDTH = 700;
const SIDEBAR_DEFAULT_WIDTH = 420;

interface DocCopilotSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  epic: Epic;
  stories: UserStory[];
  documents: EpicDocument[];
  onDocumentAccepted: (doc: EpicDocument) => void;
  width: number;
  onWidthChange: (width: number) => void;
}

type ExportFormat = 'pdf' | 'excel' | 'word' | 'csv';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const formatConfig: Record<string, { color: string; icon: typeof FileText; label: string }> = {
  pdf: {
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    icon: FileText,
    label: 'PDF',
  },
  excel: {
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    icon: FileSpreadsheet,
    label: 'Excel',
  },
  word: {
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: FileType,
    label: 'Word',
  },
  csv: {
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    icon: Table2,
    label: 'CSV',
  },
};

const EXPORT_FORMATS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: 'pdf', label: 'PDF', icon: FileText },
  { format: 'excel', label: 'Excel', icon: FileSpreadsheet },
  { format: 'word', label: 'Word', icon: FileType },
  { format: 'csv', label: 'CSV', icon: Table2 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function buildContext(epic: Epic, stories: UserStory[], documents: EpicDocument[]): CopilotContext {
  return {
    entityType: 'epic',
    entityTitle: epic.title,
    entityDescription: epic.description,
    entityLabel: epic.tracker?.externalKey || '',
    fields: {
      scopeDescription: epic.scopeDescription || '',
      acceptanceCriteria: epic.acceptanceCriteria || '',
      technologicalImprovements: epic.technologicalImprovements || '',
      thirdPartyDependencies: epic.thirdPartyDependencies || '',
      teamsInvolved: epic.teamsInvolved || '',
      impactSabreLevel: epic.impactSabreLevel || '',
      impactedChannels: epic.impactedChannels || '',
      impactedFlows: epic.impactedFlows || '',
      qualitativeBenefits: epic.qualitativeBenefits || '',
      quantitativeBenefits: epic.quantitativeBenefits || '',
      benefitsMeasurement: epic.benefitsMeasurement || '',
      businessPriority: epic.businessPriority || '',
      startDate: epic.startDate || '',
      targetDate: epic.targetDate || '',
      trackerKey: epic.tracker?.externalKey || '',
    },
    items: stories.map((s) => s.title),
    diagramTypes: epic.diagrams?.map((d) => d.type) ?? [],
    existingDocs: documents.map((d) => d.name),
  };
}

// ---------------------------------------------------------------------------
// ExportDropdown (DRY reusable sub-component)
// ---------------------------------------------------------------------------

function ExportDropdown({
  onExport,
  size = 'default',
  className,
}: {
  onExport: (format: ExportFormat) => void;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const buttonSize = size === 'sm' ? 'icon-sm' : 'icon';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={buttonSize}
          className={className}
          aria-label="Exportar documento"
        >
          <Download className={iconSize} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        {EXPORT_FORMATS.map(({ format, label, icon: Icon }) => (
          <DropdownMenuItem
            key={format}
            className="text-xs gap-2"
            onClick={() => onExport(format)}
          >
            <Icon className="h-3 w-3" /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// StreamingIndicator
// ---------------------------------------------------------------------------

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/40 shrink-0">
        <Sparkles className="h-3 w-3 text-indigo-500 animate-pulse" />
      </div>
      <div className="flex items-center gap-1">
        <span
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ onPromptClick }: { onPromptClick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-800 to-cyan-600 shadow-md">
          <Bot className="h-7 w-7 text-white" />
        </div>
        <div className="space-y-2">
          <p className="text-base font-semibold">Copilot de Épica</p>
          <p className="text-sm text-muted-foreground max-w-[300px] leading-relaxed">
            Pregunta sobre historias, arquitectura, QA o genera documentación basada en el contexto completo de la épica.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-[340px]">
        {suggestedPrompts.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onPromptClick(item.prompt)}
            className="rounded-full border border-border/80 bg-background px-3.5 py-2 text-xs font-medium text-foreground/80 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300 dark:hover:border-indigo-800 transition-colors shadow-xs"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserBubble
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssistantBubble
// ---------------------------------------------------------------------------

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-2.5 max-w-[85%]">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/40 shrink-0 mt-0.5">
        <Sparkles className="h-3 w-3 text-indigo-500" />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocPreviewCard
// ---------------------------------------------------------------------------

function DocPreviewCard({
  preview,
  onAccept,
  onReject,
  onExport,
}: {
  preview: CopilotDocPreview;
  onAccept: (sections: EpicDocumentSection[]) => void;
  onReject: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingSections, setEditingSections] = useState<EpicDocumentSection[] | null>(null);
  const isEditing = editingSections !== null;

  const handleStartEdit = useCallback(() => {
    setEditingSections(preview.sections.map((s) => ({ ...s })));
  }, [preview.sections]);

  const handleCancelEdit = useCallback(() => {
    setEditingSections(null);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingSections) {
      onAccept(editingSections);
    }
  }, [editingSections, onAccept]);

  const handleAcceptWithOriginal = useCallback(() => {
    onAccept(preview.sections);
  }, [onAccept, preview.sections]);

  const handleSectionChange = useCallback(
    (idx: number, field: 'title' | 'content', value: string) => {
      setEditingSections((prev) =>
        prev ? prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)) : prev,
      );
    },
    [],
  );

  // -- Accepted state --
  if (preview.status === 'accepted') {
    return (
      <div className="mr-auto max-w-[90%] rounded-xl border border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40">
            <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800 dark:text-green-200 truncate">
              {preview.name}
            </p>
            <p className="text-[11px] text-green-600 dark:text-green-400">Documento guardado</p>
          </div>
          <ExportDropdown
            onExport={onExport}
            size="sm"
            className="h-7 w-7 p-0 text-green-600 dark:text-green-400 hover:text-green-700 hover:bg-green-100 dark:hover:bg-green-900/40"
          />
        </div>
      </div>
    );
  }

  // -- Rejected state --
  if (preview.status === 'rejected') {
    return (
      <div className="mr-auto max-w-[90%] rounded-xl border bg-muted/30 p-4 opacity-60">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground line-through truncate">
              {preview.name}
            </p>
            <p className="text-[11px] text-muted-foreground">Descartado</p>
          </div>
        </div>
      </div>
    );
  }

  // -- Preview / Editing state --
  const sectionsToShow = editingSections ?? preview.sections;
  const visibleSections = expanded ? sectionsToShow : sectionsToShow.slice(0, 3);
  const fmtCfg = formatConfig[preview.format] ?? {
    color: 'bg-muted text-muted-foreground',
    icon: FileText,
    label: preview.format.toUpperCase(),
  };

  return (
    <div className="mr-auto max-w-[90%] rounded-xl border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted shrink-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium truncate flex-1">{preview.name}</p>
        <span
          className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${fmtCfg.color}`}
        >
          {preview.format}
        </span>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {visibleSections.map((section, idx) => {
          return (
            <div key={section.id} className="space-y-1">
              {isEditing && editingSections ? (
                <div className="space-y-1.5 rounded-lg border border-dashed p-2">
                  <input
                    type="text"
                    value={editingSections[idx]?.title ?? section.title}
                    onChange={(e) => handleSectionChange(idx, 'title', e.target.value)}
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs font-medium shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none dark:bg-input/30"
                    aria-label={`Titulo de seccion ${idx + 1}`}
                  />
                  <textarea
                    value={editingSections[idx]?.content ?? section.content}
                    onChange={(e) => handleSectionChange(idx, 'content', e.target.value)}
                    rows={Math.max(
                      2,
                      (editingSections[idx]?.content ?? section.content).split('\n').length,
                    )}
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-y dark:bg-input/30"
                    aria-label={`Contenido de seccion ${idx + 1}`}
                  />
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium text-foreground">{section.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {truncate(section.content, 80)}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Expand toggle */}
      {sectionsToShow.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Mostrar menos secciones' : 'Mostrar mas secciones'}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Ver menos
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Ver mas ({sectionsToShow.length - 3} secciones
              mas)
            </>
          )}
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {isEditing ? (
          <>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={handleSaveEdit}
            >
              <Check className="h-3 w-3" />
              Guardar edicion
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelEdit}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={handleAcceptWithOriginal}
            >
              <Check className="h-3 w-3" />
              Aceptar y guardar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleStartEdit}
            >
              <Pencil className="h-3 w-3" />
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              onClick={onReject}
            >
              <X className="h-3 w-3" />
              Descartar
            </Button>
            <ExportDropdown
              onExport={onExport}
              size="sm"
              className="h-7 w-7 p-0 ml-auto"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function DocCopilotSidebar({
  open,
  onOpenChange,
  epic,
  stories,
  documents,
  onDocumentAccepted,
  width,
  onWidthChange,
}: DocCopilotSidebarProps) {
  // -- Resize drag --
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = dragStartX.current - ev.clientX; // dragging left = wider
        const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, dragStartWidth.current + delta));
        onWidthChange(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, onWidthChange],
  );

  // -- State --
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // -- Refs --
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // -- Escape key to close --
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  // -- Auto-scroll with threshold detection --
  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShouldAutoScroll(distanceFromBottom < 50);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, shouldAutoScroll]);

  // -- Textarea auto-resize --
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [inputValue]);

  // -- Send message --
  const handleSend = useCallback(
    async (text?: string) => {
      const messageText = (text ?? inputValue).trim();
      if (!messageText || isLoading) return;

      const userMsg: CopilotMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: messageText,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInputValue('');
      setIsLoading(true);

      try {
        const ctx = buildContext(epic, stories, documents);
        // Get fresh messages via functional pattern to avoid stale closures
        const currentHistory = await new Promise<CopilotMessage[]>((resolve) => {
          setMessages((prev) => {
            resolve(prev);
            return prev;
          });
        });
        const response = await sendCopilotMessage(messageText, ctx, currentHistory);
        setMessages((prev) => [...prev, response]);
      } catch {
        const errorMsg: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'Lo siento, ocurrio un error al generar la respuesta. Por favor intenta de nuevo.',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        textareaRef.current?.focus();
      }
    },
    [inputValue, isLoading, epic, stories, documents],
  );

  // -- Keyboard: Enter to send, Shift+Enter for newline --
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // -- Accept document (immutable state update) --
  const handleAcceptDoc = useCallback(
    (messageId: string, sections: EpicDocumentSection[]) => {
      let acceptedPreview: CopilotDocPreview | undefined;

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId || !msg.docPreview) return msg;
          const updated = {
            ...msg,
            docPreview: { ...msg.docPreview, sections, status: 'accepted' as const },
          };
          acceptedPreview = updated.docPreview;
          return updated;
        }),
      );

      if (acceptedPreview) {
        onDocumentAccepted({
          id: crypto.randomUUID(),
          name: acceptedPreview.name,
          type: acceptedPreview.format === 'excel' ? 'excel' : 'pdf',
          url: '#',
          uploadedBy: 'Copilot IA',
          uploadedAt: new Date().toISOString(),
          size: '-',
          sections: acceptedPreview.sections,
          generatedBy: 'ai',
          format: acceptedPreview.format,
        });
      }
    },
    [onDocumentAccepted],
  );

  // -- Reject document --
  const handleRejectDoc = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId && msg.docPreview
          ? { ...msg, docPreview: { ...msg.docPreview, status: 'rejected' as const } }
          : msg,
      ),
    );
  }, []);

  // -- Export document --
  const handleExport = useCallback(
    async (preview: CopilotDocPreview, format: ExportFormat) => {
      const doc: EpicDocument = {
        id: preview.id,
        name: preview.name,
        type: preview.format === 'excel' ? 'excel' : 'pdf',
        url: '#',
        uploadedBy: 'Copilot IA',
        uploadedAt: new Date().toISOString(),
        size: '-',
        sections: preview.sections,
        generatedBy: 'ai',
        format: preview.format,
      };
      const exporters = { pdf: exportToPDF, excel: exportToExcel, word: exportToWord, csv: exportToCSV };
      await exporters[format](doc);
    },
    [],
  );

  return (
    <aside
      className={`shrink-0 h-full bg-muted/30 dark:bg-muted/10 flex flex-col transition-[width,border-width] duration-300 ease-in-out overflow-hidden relative ${open ? 'border-l' : 'border-l-0'}`}
      style={{ width: open ? `${width}px` : '0px' }}
      role="complementary"
      aria-label="Copilot de documentación"
      aria-hidden={!open}
    >
      {/* ---- Resize handle ---- */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-50 group hover:bg-primary/30 active:bg-primary/50 transition-colors"
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar panel"
      >
        <div className="absolute left-0 top-0 bottom-0 w-1 opacity-0 group-hover:opacity-100 bg-primary/50 transition-opacity" />
      </div>

      {/* Inner wrapper with min-width to prevent content squish during transition */}
      <div className="flex flex-col h-full" style={{ minWidth: `${SIDEBAR_MIN_WIDTH}px` }}>

      {/* ---- Context pill ---- */}
      <div className="flex-none border-b bg-background/80 px-4 py-2">
        <p className="text-[11px] text-muted-foreground truncate">
          <Sparkles className="inline h-3 w-3 text-indigo-500 mr-1 -mt-0.5" />
          <span className="font-mono text-indigo-500/80">{epic.tracker?.externalKey}</span>
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          {epic.title}
        </p>
      </div>

      {/* ---- Messages ---- */}
      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4"
        role="log"
        aria-live="polite"
      >
        {/* Empty state */}
        {messages.length === 0 && !isLoading && (
          <EmptyState onPromptClick={(prompt) => handleSend(prompt)} />
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            {msg.role === 'user' ? (
              <UserBubble content={msg.content} />
            ) : (
              <div className="space-y-2">
                <AssistantBubble content={msg.content} />

                {msg.docPreview && (
                  <div className="mt-2">
                    <DocPreviewCard
                      preview={msg.docPreview}
                      onAccept={(sections) => handleAcceptDoc(msg.id, sections)}
                      onReject={() => handleRejectDoc(msg.id)}
                      onExport={(format) => handleExport(msg.docPreview!, format)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {isLoading && <StreamingIndicator />}

        {/* Scroll anchor */}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* ---- Input area ---- */}
      <div className="flex-none border-t bg-background p-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe qué documentación necesitas..."
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-indigo-400 focus-visible:ring-indigo-400/30 focus-visible:ring-[3px] outline-none disabled:opacity-50 dark:bg-input/30"
            style={{ maxHeight: '128px' }}
            aria-label="Mensaje para el copilot"
          />
          <Button
            size="icon"
            className="shrink-0 h-10 w-10 rounded-xl bg-indigo-900 hover:bg-indigo-700 text-white"
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || isLoading}
            aria-label="Enviar mensaje"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      </div>{/* close inner wrapper */}
    </aside>
  );
}
