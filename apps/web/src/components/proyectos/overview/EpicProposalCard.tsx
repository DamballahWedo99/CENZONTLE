'use client';

import { Button } from '@/components/ui/button';
import { Sparkles, Check, Pencil, RefreshCw, X } from 'lucide-react';
import type { ProposedEpic, Priority } from '@cenzontle/shared';
import type { Pod } from '@cenzontle/shared';

const priorityColors: Record<Priority, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/40',
  high: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/40',
  medium: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/40',
  low: 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700/40',
};

const priorityLabels: Record<Priority, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

interface EpicProposalCardProps {
  proposal: ProposedEpic;
  pods: Pod[];
  onAccept: (proposal: ProposedEpic) => void;
  onEdit: (proposal: ProposedEpic) => void;
  onRegenerate: (proposal: ProposedEpic) => void;
  onDiscard: (clientId: string) => void;
  accepting?: boolean;
}

export function EpicProposalCard({
  proposal,
  pods,
  onAccept,
  onEdit,
  onRegenerate,
  onDiscard,
  accepting,
}: EpicProposalCardProps) {
  const assignedPods = pods.filter((p) => proposal.podIds.includes(p.id));

  return (
    <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/[0.02] p-4 space-y-3 transition-colors hover:border-primary/30">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="h-2.5 w-2.5" />
              IA
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${priorityColors[proposal.priority]}`}>
              {priorityLabels[proposal.priority]}
            </span>
          </div>
          <h4 className="text-sm font-medium mt-1.5">{proposal.title}</h4>
        </div>
      </div>

      {/* Description (truncated) */}
      <p className="text-xs text-muted-foreground line-clamp-2">{proposal.description}</p>

      {/* Pods */}
      {assignedPods.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {assignedPods.map((pod) => (
            <span
              key={pod.id}
              className="text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ borderColor: `${pod.color}40`, color: pod.color, backgroundColor: `${pod.color}10` }}
            >
              {pod.name}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => onAccept(proposal)}
          disabled={accepting}
        >
          <Check className="h-3 w-3" />
          Aceptar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => onEdit(proposal)}
        >
          <Pencil className="h-3 w-3" />
          Editar
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => onRegenerate(proposal)}
          title="Regenerar"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDiscard(proposal.clientId)}
          title="Descartar"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
