'use client';

import { cn } from '@/lib/utils';

interface StoryPointsBadgeProps {
  points: number;
  className?: string;
}

export function StoryPointsBadge({ points, className }: StoryPointsBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary',
        className
      )}
    >
      {points}
    </span>
  );
}
