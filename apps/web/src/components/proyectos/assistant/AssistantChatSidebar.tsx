'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';
import type { Components } from 'react-markdown';
import type { AssistantEntityType, AssistantProposal } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useAssistantChat,
  type AssistantMessage,
  type AssistantSegment,
  type TrackedProposal,
} from '@/hooks/useAssistantChat';
import { ProposalCard } from './ProposalCard';

/**
 * Component overrides para el markdown de los mensajes del asistente.
 * Declarados a nivel de MÓDULO (no inline) para identidad estable — Streamdown
 * memoiza shallowly el prop `components`; recrearlo en cada SSE delta forzaría
 * un re-parse del markdown entero por token, anulando su optimización de
 * streaming (mismo patrón que ThinkingBlock).
 *
 * Estilo: mensajes de chat normales (a diferencia del thinking, que es
 * "agent-whispers" italic/muted) — párrafos con aire, listas con bullets
 * reales, headings discretos, code/links legibles. Tamaño text-sm.
 */
const CHAT_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-6 space-y-1 my-1.5 marker:text-muted-foreground/50">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 space-y-1 my-1.5 marker:text-muted-foreground/50">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
  h1: ({ children }) => <h4 className="font-semibold text-sm mt-2 mb-1 first:mt-0">{children}</h4>,
  h2: ({ children }) => <h4 className="font-semibold text-sm mt-2 mb-1 first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="font-semibold text-[13px] mt-1.5 mb-0.5 first:mt-0">{children}</h5>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="font-mono text-[12px] bg-muted px-1 py-0.5 rounded">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="font-mono text-[12px] bg-muted p-2.5 rounded-md my-2 overflow-x-auto">{children}</pre>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline underline-offset-2 hover:opacity-80" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  hr: () => <hr className="my-2.5 border-border/60" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 my-1.5 text-muted-foreground">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
};

interface AssistantChatSidebarProps {
  entityType: AssistantEntityType;
  entityId: string;
  /** Título de la entidad — se muestra en el header del panel. */
  entityTitle: string;
  open: boolean;
  onClose: () => void;
  /**
   * Aplica una propuesta usando la API de update de la página (PATCH del
   * recurso + dispatch al context). Throw → la tarjeta vuelve a `pending`.
   */
  onApplyProposal: (proposal: AssistantProposal) => Promise<void>;
}

/**
 * Panel lateral de chat con el asistente editorial. Se mantiene MONTADO
 * aunque esté cerrado (visibilidad por CSS) para preservar la transcripción
 * al alternar el toggle — la sesión backend sigue viva por TTL.
 */
export function AssistantChatSidebar({
  entityType,
  entityId,
  entityTitle,
  open,
  onClose,
  onApplyProposal,
}: AssistantChatSidebarProps) {
  const {
    messages,
    proposals,
    isStreaming,
    isHydrating,
    error,
    sendMessage,
    stop,
    reset,
    markProposal,
  } = useAssistantChat(entityType, entityId);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Sticky-bottom: autoscrollear SOLO si el usuario ya estaba pegado al fondo.
   * Si subió a leer mientras el agente streamea, NO lo regresamos.
   */
  const pinnedToBottomRef = useRef(true);
  /**
   * Distingue scroll del USUARIO vs scroll PROGRAMÁTICO. El autoscroll de cada
   * delta también dispara `onScroll`; sin este gate, ese evento recalcularía
   * `pinned=true` y le pelearía al usuario que intenta subir durante el
   * streaming (cada token lo bajaba de vuelta). Solo wheel/touch marcan
   * interacción real, y solo durante esa ventana el `onScroll` re-evalúa el pin.
   */
  const userInteractingRef = useRef(false);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markUserInteracting = useCallback(() => {
    userInteractingRef.current = true;
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      userInteractingRef.current = false;
    }, 250);
  }, []);

  const handleScroll = useCallback(() => {
    // Ignorar scrolls programáticos (autoscroll): solo el usuario decide el pin.
    if (!userInteractingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  // Autoscroll al fondo mientras llegan eventos (solo si está pinned).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // Auto-resize del textarea: crece con el contenido (incluido el wrapping de
  // líneas largas, que `\n`-counting no detecta) hasta el cap de `max-h` del
  // className; a partir de ahí scrollea internamente.
  //  - Vacío → limpiamos el height inline para que mande el `rows={1}` natural
  //    (1 línea). Sin esto, una medición hecha con el sidebar cerrado (w-0, sin
  //    layout) dejaba una altura espuria por defecto.
  //  - Con contenido → height = scrollHeight (reset a 'auto' primero para que
  //    también ENCOJA al borrar).
  //  - Depende de `open` para re-medir cuando el panel pasa de oculto a visible
  //    (recién ahí el textarea tiene ancho real y el wrapping es correcto).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input, open]);

  // Cleanup del timer de interacción al desmontar.
  useEffect(() => {
    return () => {
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    };
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    // Enviar un mensaje re-ancla al fondo (el usuario quiere ver la respuesta).
    pinnedToBottomRef.current = true;
    void sendMessage(text);
  }, [input, isStreaming, sendMessage]);

  const handleApply = useCallback(
    async (tracked: TrackedProposal) => {
      markProposal(tracked.proposal.id, 'applying');
      try {
        await onApplyProposal(tracked.proposal);
        markProposal(tracked.proposal.id, 'applied');
        toast.success('Propuesta aplicada');
      } catch (err) {
        markProposal(tracked.proposal.id, 'pending');
        toast.error(err instanceof Error ? err.message : 'Error al aplicar la propuesta');
      }
    },
    [markProposal, onApplyProposal],
  );

  const handleReject = useCallback(
    (tracked: TrackedProposal) => {
      markProposal(tracked.proposal.id, 'rejected');
    },
    [markProposal],
  );

  return (
    <aside
      className={`shrink-0 border-l border-border bg-background flex flex-col h-full min-h-0 transition-[width] duration-200 ${
        open ? 'w-[26rem]' : 'w-0 overflow-hidden border-l-0'
      }`}
      aria-hidden={!open}
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight">Asistente</div>
          <div className="text-xs text-muted-foreground truncate">{entityTitle}</div>
        </div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={reset}
                disabled={isStreaming || messages.length === 0}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Nueva conversación</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cerrar asistente</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Transcripción */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={markUserInteracting}
        onTouchMove={markUserInteracting}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && !isHydrating && (
          <div className="text-center text-sm text-muted-foreground mt-10 px-4 space-y-2">
            <Sparkles className="h-6 w-6 mx-auto opacity-40" />
            <p>
              Pídeme cambios sobre este documento: afinar criterios de aceptación, reescribir el
              objetivo, agregar edge cases…
            </p>
            <p className="text-xs opacity-70">
              Te propondré la edición como diff y tú decides si se aplica.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            proposals={proposals}
            onApply={handleApply}
            onReject={handleReject}
          />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Pensando…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-ring">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="¿Qué quieres cambiar?"
            rows={1}
            maxLength={4000}
            disabled={isStreaming}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 max-h-[140px] overflow-y-auto"
          />
          {isStreaming ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={stop}
              className="text-muted-foreground hover:text-destructive shrink-0"
              aria-label="Detener"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0"
              aria-label="Enviar"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Render de mensajes
// ─────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: AssistantMessage;
  proposals: Record<string, TrackedProposal>;
  onApply: (tracked: TrackedProposal) => void;
  onReject: (tracked: TrackedProposal) => void;
}

function MessageBubble({ message, proposals, onApply, onReject }: MessageBubbleProps) {
  if (message.role === 'user') {
    const text = message.segments
      .map((s) => (s.kind === 'text' ? s.content : ''))
      .join('');
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.segments.map((segment, i) => (
        <SegmentView
          key={i}
          segment={segment}
          proposals={proposals}
          onApply={onApply}
          onReject={onReject}
        />
      ))}
    </div>
  );
}

interface SegmentViewProps {
  segment: AssistantSegment;
  proposals: Record<string, TrackedProposal>;
  onApply: (tracked: TrackedProposal) => void;
  onReject: (tracked: TrackedProposal) => void;
}

function SegmentView({ segment, proposals, onApply, onReject }: SegmentViewProps) {
  switch (segment.kind) {
    case 'text':
      // Streamdown renderiza el markdown del agente de forma estética y tolera
      // markdown PARCIAL durante el streaming (parseIncompleteMarkdown) — sin
      // esto el usuario veía `**bold**`, `- listas` y `## headings` en crudo.
      return (
        <div className="text-sm break-words">
          <Streamdown parseIncompleteMarkdown components={CHAT_MARKDOWN_COMPONENTS}>
            {segment.content}
          </Streamdown>
        </div>
      );
    case 'thinking':
      return <ThinkingBlock content={segment.content} />;
    case 'tool':
      return (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
          <Wrench className="h-3 w-3" />
          <span>{segment.label}</span>
          {segment.done ? (
            <>
              {segment.summary && <span className="opacity-70">· {segment.summary}</span>}
              <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
            </>
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </div>
      );
    case 'proposal': {
      const tracked = proposals[segment.proposalId];
      if (!tracked) return null;
      return (
        <ProposalCard
          tracked={tracked}
          onApply={() => onApply(tracked)}
          onReject={() => onReject(tracked)}
        />
      );
    }
  }
}

function ThinkingBlock({ content }: { content: string }) {
  const [openBlock, setOpenBlock] = useState(false);
  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpenBlock((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {openBlock ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" />
        Razonamiento
      </button>
      {openBlock && (
        <div className="px-3 pb-2 text-xs text-muted-foreground break-words max-h-40 overflow-y-auto">
          <Streamdown parseIncompleteMarkdown components={CHAT_MARKDOWN_COMPONENTS}>
            {content}
          </Streamdown>
        </div>
      )}
    </div>
  );
}
