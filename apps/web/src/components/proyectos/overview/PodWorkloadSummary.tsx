'use client';

import { useProyectos } from '@/context/ProyectosContext';
import { StoryStatus } from '@cenzontle/shared';

const statusColors: Record<StoryStatus, string> = {
  [StoryStatus.Done]: 'bg-green-500',
  [StoryStatus.InProgress]: 'bg-blue-500',
  [StoryStatus.InReview]: 'bg-fuchsia-500',
  [StoryStatus.QA]: 'bg-amber-500',
  [StoryStatus.ToDo]: 'bg-slate-400',
  [StoryStatus.Backlog]: 'bg-gray-300 dark:bg-gray-600',
  [StoryStatus.Blocked]: 'bg-red-500',
};

const statusLabels: Record<StoryStatus, string> = {
  [StoryStatus.Done]: 'Done',
  [StoryStatus.InProgress]: 'In Progress',
  [StoryStatus.InReview]: 'In Review',
  [StoryStatus.QA]: 'QA',
  [StoryStatus.ToDo]: 'To Do',
  [StoryStatus.Backlog]: 'Backlog',
  [StoryStatus.Blocked]: 'Blocked',
};

export function PodWorkloadSummary() {
  const { state } = useProyectos();

  const podData = state.pods.map((pod) => {
    const stories = state.stories.filter((s) => s.podId === pod.id);
    const byStatus = Object.values(StoryStatus).map((status) => ({
      status,
      count: stories.filter((s) => s.status === status).length,
    }));
    return { pod, total: stories.length, byStatus };
  });

  return (
    <div className="space-y-3">
      {podData.map(({ pod, total, byStatus }) => (
        <div key={pod.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: pod.color }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">{pod.name}</span>
            </div>
            <span className="text-xs text-muted-foreground">{total} historias</span>
          </div>
          <div
            className="flex h-3 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Distribucion de historias de ${pod.name}: ${byStatus.filter((s) => s.count > 0).map((s) => `${statusLabels[s.status]} ${s.count}`).join(', ')}`}
          >
            {total > 0 && byStatus
              .filter((s) => s.count > 0)
              .map((s) => (
                <div
                  key={s.status}
                  className={`${statusColors[s.status]} transition-all`}
                  style={{ width: `${(s.count / total) * 100}%` }}
                  title={`${statusLabels[s.status]}: ${s.count}`}
                />
              ))}
          </div>
          <div className="flex gap-3 mt-2 flex-wrap">
            {byStatus
              .filter((s) => s.count > 0)
              .map((s) => (
                <span key={s.status} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${statusColors[s.status]}`} aria-hidden="true" />
                  {statusLabels[s.status]} {s.count}
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
