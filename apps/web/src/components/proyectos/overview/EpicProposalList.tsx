'use client';

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Trash2, RefreshCw, Sparkles } from 'lucide-react';
import { EpicProposalCard } from './EpicProposalCard';
import { ProposalTtlCountdown } from './ProposalTtlCountdown';
import { getCacheTtl } from '@/lib/api/epic-generation';
import type { ProposedEpic, Pod } from '@cenzontle/shared';

interface EpicProposalListProps {
  initiativeId: string;
  proposals: ProposedEpic[];
  pods: Pod[];
  acceptingId: string | null;
  onAccept: (proposal: ProposedEpic) => void;
  onAcceptAll: () => void;
  onEdit: (proposal: ProposedEpic) => void;
  onRegenerate: (proposal: ProposedEpic) => void;
  onDiscard: (clientId: string) => void;
  onDiscardAll: () => void;
  onRefinePrompt: () => void;
}

export function EpicProposalList({
  initiativeId,
  proposals,
  pods,
  acceptingId,
  onAccept,
  onAcceptAll,
  onEdit,
  onRegenerate,
  onDiscard,
  onDiscardAll,
  onRefinePrompt,
}: EpicProposalListProps) {
  const fetchTtl = useCallback(() => getCacheTtl(initiativeId), [initiativeId]);

  if (proposals.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/[0.02] px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">
            {proposals.length} {proposals.length === 1 ? 'épica propuesta' : 'épicas propuestas'}
          </span>
          <ProposalTtlCountdown fetchTtl={fetchTtl} onExpired={onDiscardAll} />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 text-muted-foreground"
            onClick={onRefinePrompt}
          >
            <RefreshCw className="h-3 w-3" />
            Refinar prompt
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
            onClick={onDiscardAll}
          >
            <Trash2 className="h-3 w-3" />
            Descartar todas
          </Button>
          <Button
            size="sm"
            className="h-6 text-[10px] gap-1"
            onClick={onAcceptAll}
            disabled={!!acceptingId}
          >
            <Check className="h-3 w-3" />
            Aceptar todas
          </Button>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {proposals.map((p) => (
          <EpicProposalCard
            key={p.clientId}
            proposal={p}
            pods={pods}
            onAccept={onAccept}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onDiscard={onDiscard}
            accepting={acceptingId === p.clientId}
          />
        ))}
      </div>
    </div>
  );
}
