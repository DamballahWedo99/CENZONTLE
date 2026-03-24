'use client';

import { cn } from '@/lib/utils';

interface ProgressBarProps {
  progress: number; // 0-100
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ progress, size = 'md', showLabel = true, className }: ProgressBarProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const barColor = clampedProgress === 100
    ? 'bg-green-500'
    : clampedProgress >= 60
    ? 'bg-blue-500'
    : clampedProgress >= 30
    ? 'bg-amber-500'
    : 'bg-red-500';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'flex-1 overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2.5'
        )}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {clampedProgress}%
        </span>
      )}
    </div>
  );
}
