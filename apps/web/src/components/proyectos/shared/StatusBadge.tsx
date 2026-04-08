'use client';

import { cn } from '@/lib/utils';
import { EpicStatus, StoryStatus } from '@cenzontle/shared';

const storyStatusConfig: Record<StoryStatus, { label: string; className: string }> = {
  [StoryStatus.Backlog]: { label: 'Backlog', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  [StoryStatus.ToDo]: { label: 'To Do', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  [StoryStatus.InProgress]: { label: 'In Progress', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  [StoryStatus.InReview]: { label: 'In Review', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300' },
  [StoryStatus.QA]: { label: 'QA', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  [StoryStatus.Done]: { label: 'Done', className: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  [StoryStatus.Blocked]: { label: 'Blocked', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
};

const epicStatusConfig: Record<EpicStatus, { label: string; className: string }> = {
  [EpicStatus.Draft]: { label: 'Draft', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  [EpicStatus.InProgress]: { label: 'In Progress', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  [EpicStatus.Done]: { label: 'Done', className: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  [EpicStatus.Blocked]: { label: 'Blocked', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
};

interface StatusBadgeProps {
  status: StoryStatus | EpicStatus;
  type?: 'story' | 'epic';
  className?: string;
}

export function StatusBadge({ status, type = 'story', className }: StatusBadgeProps) {
  const config = type === 'epic'
    ? epicStatusConfig[status as EpicStatus]
    : storyStatusConfig[status as StoryStatus];

  if (!config) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
