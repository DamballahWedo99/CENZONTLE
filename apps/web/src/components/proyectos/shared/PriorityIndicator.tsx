'use client';

import { cn } from '@/lib/utils';
import { Priority } from '@cenzontle/shared';
import { AlertTriangle, ArrowUp, ArrowRight, ArrowDown } from 'lucide-react';

const priorityConfig: Record<Priority, { label: string; icon: React.ElementType; className: string }> = {
  [Priority.Critical]: { label: 'Critical', icon: AlertTriangle, className: 'text-red-600 dark:text-red-400' },
  [Priority.High]: { label: 'High', icon: ArrowUp, className: 'text-orange-600 dark:text-orange-400' },
  [Priority.Medium]: { label: 'Medium', icon: ArrowRight, className: 'text-yellow-600 dark:text-yellow-400' },
  [Priority.Low]: { label: 'Low', icon: ArrowDown, className: 'text-blue-600 dark:text-blue-400' },
};

interface PriorityIndicatorProps {
  priority: Priority;
  showLabel?: boolean;
  className?: string;
}

export function PriorityIndicator({ priority, showLabel = true, className }: PriorityIndicatorProps) {
  const config = priorityConfig[priority];
  const Icon = config.icon;

  return (
    <span className={cn('inline-flex items-center gap-1', config.className, className)}>
      <Icon className="h-3.5 w-3.5" />
      {showLabel && <span className="text-xs font-medium">{config.label}</span>}
    </span>
  );
}
