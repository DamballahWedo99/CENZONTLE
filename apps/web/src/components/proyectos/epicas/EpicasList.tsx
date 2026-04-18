'use client';

import { useRouter } from 'next/navigation';
import { useProyectos } from '@/context/ProyectosContext';
import { StatusBadge } from '../shared/StatusBadge';
import { PriorityIndicator } from '../shared/PriorityIndicator';
import { PodBadge } from '../shared/PodBadge';
import { ProgressBar } from '../shared/ProgressBar';
import { DownloadMenu } from '../shared/DownloadMenu';
import { ChevronRight } from 'lucide-react';

const gridCols = 'grid-cols-[60px_1fr_260px_100px_80px_200px_120px_60px_28px]';

export function EpicasList() {
  const { epicsWithRelations } = useProyectos();
  const router = useRouter();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between pb-2">
        <span className="text-xs text-muted-foreground">
          {epicsWithRelations.length} {epicsWithRelations.length === 1 ? 'épica' : 'épicas'}
        </span>
        <DownloadMenu
          entity={{ kind: 'epics-list', epics: epicsWithRelations }}
          variant="button"
        />
      </div>
      {/* Header row */}
      <div className={`grid ${gridCols} gap-2 items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b`}>
        <div>Key</div>
        <div>Título</div>
        <div>Iniciativa</div>
        <div>Status</div>
        <div>Prioridad</div>
        <div>PODs</div>
        <div>Progreso</div>
        <div className="text-right">Historias</div>
        <div></div>
      </div>

      {/* Epic list */}
      <div className="space-y-1">
        {epicsWithRelations.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            No se encontraron épicas con los filtros actuales
          </div>
        ) : (
          epicsWithRelations.map((epic) => (
            <div
              key={epic.id}
              className="rounded-lg border transition-colors hover:bg-muted/30"
            >
              <div
                className={`grid ${gridCols} gap-2 items-center px-4 py-3 text-sm cursor-pointer`}
                onClick={() => router.push(`/proyectos/epicas/${epic.id}`)}
              >
                <div className="flex items-center gap-1.5">
                  {epic.tracker?.externalKey ? (
                    <span className="font-mono text-xs text-muted-foreground">{epic.tracker.externalKey}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">{'\u2014'}</span>
                  )}
                </div>
                <span className="truncate font-medium">{epic.title}</span>
                <span
                  className="text-xs text-muted-foreground truncate hover:text-blue-400 transition-colors cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); router.push(`/proyectos/iniciativas/${epic.initiative.id}`); }}
                >
                  {epic.initiative.name}
                </span>
                <div>
                  <StatusBadge status={epic.status} type="epic" />
                </div>
                <div>
                  <PriorityIndicator priority={epic.priority} showLabel={false} />
                </div>
                <div className="flex gap-1 overflow-hidden">
                  {epic.pods.slice(0, 2).map((pod) => (
                    <PodBadge key={pod.id} name={pod.name} color={pod.color} />
                  ))}
                  {epic.pods.length > 2 && (
                    <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      +{epic.pods.length - 2}
                    </span>
                  )}
                </div>
                <div>
                  <ProgressBar progress={epic.progress} size="sm" />
                </div>
                <span className="text-right text-sm">{epic.stories.length}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
