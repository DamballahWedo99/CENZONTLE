'use client';

import { useState, type ReactNode } from 'react';
import { Check, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';
import { TOOL_ICONS, TOOL_COLORS } from './constants';

/**
 * Renderiza un string con URLs + menciones "Settings → X" como links clickeables.
 * Útil para que los mensajes de error de tools (ej. "configura en Settings → Vault")
 * no obliguen al usuario a navegar manualmente — un click y está en el tab correcto.
 */
const SETTINGS_LINK_MAP: Record<string, string> = {
  'Settings → Vault': '/factory/settings?section=vault',
  'Settings → Código': '/factory/settings?section=codigo',
  'Settings → Codigo': '/factory/settings?section=codigo',
  'Settings → Repository': '/factory/settings?section=repository',
};

function renderWithLinks(text: string): ReactNode[] {
  // Build a combined regex for URLs and settings mentions. Order matters:
  // try URLs first (more specific), then settings phrases.
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  const settingsPattern = new RegExp(
    Object.keys(SETTINGS_LINK_MAP)
      .map((k) => k.replace(/→/g, '[→]'))
      .join('|'),
    'g',
  );
  const combined = new RegExp(`(${urlPattern.source})|(${settingsPattern.source})`, 'g');

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const matched = match[0];
    const href = matched.startsWith('http')
      ? matched
      : SETTINGS_LINK_MAP[matched];
    parts.push(
      <a
        key={key++}
        href={href}
        target={matched.startsWith('http') ? '_blank' : undefined}
        rel={matched.startsWith('http') ? 'noopener noreferrer' : undefined}
        className="text-primary underline underline-offset-2 hover:text-primary/80"
        onClick={(e) => e.stopPropagation()}
      >
        {matched}
      </a>,
    );
    lastIndex = match.index + matched.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

interface ToolCallCardProps {
  tool: string;
  label: string;
  status: 'active' | 'done' | 'error';
  argsPreview?: string;
  summary?: string;
  resultPreview?: string;
  durationMs?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusIndicator({ status }: { status: 'active' | 'done' | 'error' }) {
  switch (status) {
    case 'done':
      return <Check className="h-3 w-3 text-green-500 shrink-0" />;
    case 'active':
      return <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />;
    case 'error':
      return <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />;
  }
}

export function ToolCallCard({ tool, label, status, argsPreview, summary, resultPreview, durationMs }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[tool] ?? TOOL_ICONS['loading_context'];
  const borderColor = TOOL_COLORS[tool] ?? 'border-l-muted-foreground';
  const hasDetail = !!(argsPreview || resultPreview);

  return (
    <div className={`animate-[agent-slide-in_200ms_ease-out] rounded-lg border border-border/40 bg-card/50 p-3 border-l-2 ${borderColor}`}>
      {/* Row 1: icon + label + summary + status + duration */}
      <div
        className={`flex items-center gap-2 ${hasDetail && status === 'done' ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetail && status === 'done' && setExpanded((e) => !e)}
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className={`text-xs font-medium ${status === 'active' ? 'text-foreground' : 'text-muted-foreground'}`}>
          {label}
        </span>

        {/* Summary inline (e.g. "5 resultados") */}
        {status === 'done' && summary && (
          <span className="text-[11px] text-muted-foreground/60">
            — {summary}
          </span>
        )}

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {status === 'done' && durationMs != null && durationMs > 50 && (
            <span className="text-[10px] bg-muted/60 text-muted-foreground rounded-full px-1.5 py-0.5 tabular-nums">
              {formatDuration(durationMs)}
            </span>
          )}
          <StatusIndicator status={status} />
          {hasDetail && status === 'done' && (
            <ChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </div>

      {/* Expanded detail section */}
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-border/30 pt-2">
          {/* Args */}
          {argsPreview && (
            <div>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">Argumentos</span>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                {argsPreview}
              </div>
            </div>
          )}

          {/* Result preview */}
          {resultPreview && (
            <div>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">Resultado</span>
              <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed bg-muted/20 rounded px-2 py-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                {renderWithLinks(resultPreview)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
