'use client';

import { useRouter } from 'next/navigation';
import { Initiative, InitiativeStatus, StoryStatus } from '@/types/proyectos';
import { useProyectos } from '@/context/ProyectosContext';
import { ProgressBar } from '../shared/ProgressBar';
import { ChevronRight } from 'lucide-react';

const initiativeStatusConfig: Record<InitiativeStatus, { label: string; className: string }> = {
  [InitiativeStatus.Planning]: { label: 'Planning', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  [InitiativeStatus.Active]: { label: 'Active', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  [InitiativeStatus.Completed]: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  [InitiativeStatus.OnHold]: { label: 'On Hold', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
};

interface InitiativeProgressProps {
  initiative: Initiative;
}

export function InitiativeProgress({ initiative }: InitiativeProgressProps) {
  const router = useRouter();
  const { state } = useProyectos();

  const epics = state.epics.filter((e) => initiative.epicIds.includes(e.id));
  const stories = state.stories.filter((s) => epics.some((e) => e.id === s.epicId));
  const doneStories = stories.filter((s) => s.status === StoryStatus.Done);
  const progress = stories.length > 0 ? Math.round((doneStories.length / stories.length) * 100) : 0;
  const statusCfg = initiativeStatusConfig[initiative.status];

  return (
    <div
      className="rounded-xl border bg-card shadow-sm hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => router.push(`/proyectos/iniciativas/${initiative.id}`)}
    >
      <div className="flex items-center gap-4 px-4 py-3 select-none">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm truncate">{initiative.name}</h4>
        </div>

        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium shrink-0 ${statusCfg.className}`}>
          {statusCfg.label}
        </span>

        <div className="w-28 shrink-0 hidden sm:block">
          <ProgressBar progress={progress} size="sm" />
        </div>

        <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-20 text-right">
          {epics.length} épicas
        </span>

        <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-24 text-right">
          {doneStories.length}/{stories.length} historias
        </span>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </div>
  );
}
