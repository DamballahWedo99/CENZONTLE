'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import type { AssistantProposalTarget } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { computeLineDiff, collapseContext, type DiffRenderItem } from '@/lib/line-diff';
import type { TrackedProposal } from '@/hooks/useAssistantChat';

const TARGET_LABELS: Record<AssistantProposalTarget, string> = {
  initiative_description: 'Descripción',
  epic_markdown: 'Definición',
  story_po: 'Producto',
  story_technical: 'Técnica',
  story_qa: 'QA',
};

interface ProposalCardProps {
  tracked: TrackedProposal;
  onApply: () => void;
  onReject: () => void;
}

/**
 * Tarjeta de propuesta del asistente: resumen + diff de líneas con contexto
 * colapsado + acciones Aplicar/Descartar. El diff se computa client-side
 * contra el snapshot `oldContent` que resolvió el backend.
 */
export function ProposalCard({ tracked, onApply, onReject }: ProposalCardProps) {
  const { proposal, status } = tracked;
  const [diffOpen, setDiffOpen] = useState(true);

  const diffItems = useMemo<DiffRenderItem[]>(
    () => collapseContext(computeLineDiff(proposal.oldContent, proposal.newContent)),
    [proposal.oldContent, proposal.newContent],
  );

  const { addedCount, removedCount } = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const item of diffItems) {
      if (item.kind === 'added') added++;
      if (item.kind === 'removed') removed++;
    }
    return { addedCount: added, removedCount: removed };
  }, [diffItems]);

  const isResolved = status === 'applied' || status === 'rejected';

  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground overflow-hidden ${
        status === 'applied'
          ? 'border-green-600/40'
          : status === 'rejected'
            ? 'border-border opacity-60'
            : 'border-border'
      }`}
    >
      <div className="px-3 py-2 border-b border-border/60 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] shrink-0">
              {TARGET_LABELS[proposal.target]}
            </Badge>
            <span className="text-sm font-medium truncate">{proposal.title}</span>
          </div>
          {proposal.summary && (
            <p className="text-xs text-muted-foreground mt-1">{proposal.summary}</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDiffOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        {diffOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-green-600 dark:text-green-500 font-mono">+{addedCount}</span>
        <span className="text-red-600 dark:text-red-500 font-mono">−{removedCount}</span>
        <span>líneas</span>
      </button>

      {diffOpen && (
        <div className="max-h-64 overflow-y-auto border-t border-border/60 font-mono text-[11px] leading-relaxed">
          {diffItems.map((item, i) =>
            item.kind === 'gap' ? (
              <div
                key={i}
                className="px-3 py-0.5 text-center text-muted-foreground/60 bg-muted/30 select-none"
              >
                ··· {item.hiddenCount} línea{item.hiddenCount === 1 ? '' : 's'} sin cambios ···
              </div>
            ) : (
              <div
                key={i}
                className={`px-3 whitespace-pre-wrap break-words ${
                  item.kind === 'added'
                    ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                    : item.kind === 'removed'
                      ? 'bg-red-500/10 text-red-700 dark:text-red-400 line-through decoration-red-400/40'
                      : 'text-muted-foreground'
                }`}
              >
                {item.kind === 'added' ? '+ ' : item.kind === 'removed' ? '− ' : '  '}
                {item.text || ' '}
              </div>
            ),
          )}
        </div>
      )}

      <div className="px-3 py-2 border-t border-border/60 flex items-center gap-2">
        {status === 'applied' ? (
          <span className="text-xs font-medium text-green-600 dark:text-green-500 inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Aplicada
          </span>
        ) : status === 'rejected' ? (
          <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Descartada
          </span>
        ) : (
          <>
            <Button
              size="sm"
              onClick={onApply}
              disabled={status === 'applying' || isResolved}
              className="h-7 text-xs"
            >
              {status === 'applying' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Aplicar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onReject}
              disabled={status === 'applying'}
              className="h-7 text-xs text-muted-foreground"
            >
              Descartar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
