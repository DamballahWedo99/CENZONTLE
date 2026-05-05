'use client';

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Trash2, Sparkles } from 'lucide-react';
import { StoryProposalCard } from './StoryProposalCard';
import { ProposalTtlCountdown } from '../overview/ProposalTtlCountdown';
import { getStoryCacheTtl } from '@/lib/api/story-generation';
import type { ProposedStory, Pod } from '@cenzontle/shared';

interface StoryProposalListProps {
  epicId: string;
  proposals: ProposedStory[];
  pods: Pod[];
  acceptingId: string | null;
  onAccept: (proposal: ProposedStory) => void;
  onAcceptAll: () => void;
  onDiscard: (clientId: string) => void;
  onDiscardAll: () => void;
}

export function StoryProposalList({
  epicId,
  proposals,
  pods,
  acceptingId,
  onAccept,
  onAcceptAll,
  onDiscard,
  onDiscardAll,
}: StoryProposalListProps) {
  const fetchTtl = useCallback(() => getStoryCacheTtl(epicId), [epicId]);

  if (proposals.length === 0) return null;

  const totalPoints = proposals.reduce((sum, p) => sum + p.storyPoints, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/[0.02] px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">
            {proposals.length} {proposals.length === 1 ? 'historia propuesta' : 'historias propuestas'}
          </span>
          <span className="text-[11px] text-muted-foreground">
            · {totalPoints} SP totales
          </span>
          <ProposalTtlCountdown fetchTtl={fetchTtl} onExpired={onDiscardAll} />
        </div>
        <div className="flex items-center gap-1.5">
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

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {proposals.map((p) => (
          <StoryProposalCard
            key={p.clientId}
            proposal={p}
            pods={pods}
            // Pasamos el batch completo para que el card pueda resolver
            // títulos de las historias en su `blockedBy`.
            batchProposals={proposals}
            onAccept={onAccept}
            onDiscard={onDiscard}
            accepting={acceptingId === p.clientId}
          />
        ))}
      </div>
    </div>
  );
}
