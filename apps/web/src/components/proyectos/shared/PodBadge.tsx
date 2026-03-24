'use client';

import { cn } from '@/lib/utils';

interface PodBadgeProps {
  name: string;
  color: string;
  className?: string;
}

export function PodBadge({ name, color, className }: PodBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        'bg-muted text-muted-foreground',
        className
      )}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
