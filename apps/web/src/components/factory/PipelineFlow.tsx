'use client';

import {
  ClipboardList,
  LayoutList,
  Hammer,
  Eye,
  Package,
  Shield,
  Check,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import { LayerStatus, PipelineLayer } from '@cenzontle/shared';
import type { PipelineLayerState } from '@cenzontle/shared';

// ---------------------------------------------------------------------------
// Layer icon mapping
// ---------------------------------------------------------------------------
const LAYER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ClipboardList,
  LayoutList,
  Hammer,
  Eye,
  Package,
  Shield,
};

// ---------------------------------------------------------------------------
// Status style configuration
// ---------------------------------------------------------------------------
interface StatusStyle {
  borderColor: string;
  dotColor: string;
  textColor: string;
  label: string;
  opacity: string;
  glow: boolean;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  [LayerStatus.Idle]: {
    borderColor: 'border-border',
    dotColor: 'bg-[#6B7280]',
    textColor: 'text-[#6B7280]',
    label: 'Idle',
    opacity: 'opacity-50',
    glow: false,
  },
  [LayerStatus.Active]: {
    borderColor: 'border-[#3B82F6]',
    dotColor: 'bg-[#3B82F6]',
    textColor: 'text-[#3B82F6]',
    label: 'Active',
    opacity: 'opacity-100',
    glow: true,
  },
  [LayerStatus.Waiting]: {
    borderColor: 'border-[#6B7280]',
    dotColor: 'bg-[#6B7280]',
    textColor: 'text-[#6B7280]',
    label: 'Waiting',
    opacity: 'opacity-70',
    glow: false,
  },
  [LayerStatus.Completed]: {
    borderColor: 'border-[#22C55E]',
    dotColor: 'bg-[#22C55E]',
    textColor: 'text-[#22C55E]',
    label: 'Completed',
    opacity: 'opacity-100',
    glow: false,
  },
  [LayerStatus.Failed]: {
    borderColor: 'border-[#EF4444]',
    dotColor: 'bg-[#EF4444]',
    textColor: 'text-[#EF4444]',
    label: 'Failed',
    opacity: 'opacity-100',
    glow: false,
  },
};

function getStatusStyle(status: LayerStatus): StatusStyle {
  return STATUS_STYLES[status] ?? STATUS_STYLES[LayerStatus.Idle];
}

// ---------------------------------------------------------------------------
// ConnectorArrow -- the line between pipeline layer cards
// ---------------------------------------------------------------------------
function ConnectorArrow({ completed }: { completed: boolean }) {
  return (
    <div
      className="flex items-center justify-center shrink-0 w-8 md:w-10"
      aria-hidden="true"
    >
      <div className="flex items-center w-full">
        <div
          className={cn(
            'flex-1 h-px',
            completed ? 'bg-[#22C55E]' : 'bg-[#2A2A35]',
          )}
        />
        <ArrowRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 -ml-0.5',
            completed ? 'text-[#22C55E]' : 'text-[#2A2A35]',
          )}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LayerCard -- individual pipeline stage card
// ---------------------------------------------------------------------------
interface LayerCardProps {
  layer: PipelineLayerState;
}

function LayerCard({ layer }: LayerCardProps) {
  const style = getStatusStyle(layer.status);
  const IconComponent = LAYER_ICONS[layer.icon];
  const isCompleted = layer.status === LayerStatus.Completed;
  const isActive = layer.status === LayerStatus.Active;

  const itemLabel = layer.itemCount === 1 ? 'story' : 'stories';

  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-lg border p-3 md:p-4',
        'bg-card transition-all duration-300 min-w-[120px] md:min-w-[140px]',
        style.borderColor,
        style.opacity,
        isActive && 'shadow-[0_0_20px_-4px_rgba(59,130,246,0.3)]',
      )}
      role="listitem"
      aria-label={`${layer.label}: ${style.label}, ${layer.itemCount} ${itemLabel}`}
    >
      {/* Active pulse ring */}
      {isActive && (
        <span
          className="absolute inset-0 rounded-lg border border-[#3B82F6] animate-pulse pointer-events-none"
          aria-hidden="true"
        />
      )}

      {/* Icon with optional check overlay */}
      <div className="relative">
        {IconComponent && (
          <IconComponent
            className={cn(
              'h-5 w-5 md:h-6 md:w-6',
              isCompleted ? 'text-[#22C55E]' : isActive ? 'text-[#3B82F6]' : 'text-[#6B7280]',
            )}
          />
        )}
        {isCompleted && (
          <span
            className="absolute -top-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#22C55E]"
            aria-hidden="true"
          >
            <Check className="h-2 w-2 text-background" strokeWidth={3} />
          </span>
        )}
      </div>

      {/* Layer name */}
      <span
        className={cn(
          'text-xs font-medium text-center leading-tight',
          isCompleted ? 'text-foreground' : isActive ? 'text-foreground' : 'text-[#6B7280]',
        )}
      >
        {layer.label}
      </span>

      {/* Status badge */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn('h-1.5 w-1.5 rounded-full shrink-0', style.dotColor)}
          aria-hidden="true"
        />
        <span className={cn('text-[10px] leading-none', style.textColor)}>
          {style.label}
        </span>
      </div>

      {/* Item count */}
      {layer.itemCount > 0 && (
        <span className="text-[10px] text-[#6B7280] leading-none">
          {layer.itemCount} {itemLabel}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineFlow
// ---------------------------------------------------------------------------
export function PipelineFlow() {
  const { state } = useFactory();
  const { pipeline } = state;

  return (
    <section aria-label="Pipeline flow visualization">
      <div className="mb-3 px-1">
        <h2 className="text-sm font-semibold text-foreground">Pipeline</h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          6-layer flow from requirements to release
        </p>
      </div>

      <div
        className={cn(
          'flex items-center overflow-x-auto pb-2',
          'scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[#2A2A35]',
        )}
        role="list"
        aria-label="Pipeline layers"
      >
        {pipeline.map((layer, index) => {
          const isLast = index === pipeline.length - 1;
          const isConnectorCompleted = layer.status === LayerStatus.Completed;

          return (
            <div key={layer.layer} className="flex items-center shrink-0">
              <LayerCard layer={layer} />
              {!isLast && <ConnectorArrow completed={isConnectorCompleted} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
