'use client';

import { useCallback } from 'react';
import {
  BarChart3,
  LineChart,
  AreaChart,
  PieChart,
  Radar,
  ScatterChart,
  Grid3x3,
  Flame,
  Gauge,
  GitBranch,
  Filter,
  TreePine,
  Check,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { type VisualizationType, VISUALIZATION_TYPE_LABELS } from '@/lib/economic-analysis-agent';

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const VIZ_ICONS: Record<VisualizationType, typeof BarChart3> = {
  bar: BarChart3,
  line: LineChart,
  area: AreaChart,
  pie: PieChart,
  radar: Radar,
  scatter: ScatterChart,
  treemap: TreePine,
  heatmap: Grid3x3,
  gauge: Gauge,
  waterfall: Flame,
  sankey: GitBranch,
  funnel: Filter,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChartTypeSwitcherProps {
  currentViz: VisualizationType;
  defaultViz: VisualizationType;
  supportedVizTypes: VisualizationType[];
  isOverridden: boolean;
  onSelect: (vizType: VisualizationType | 'auto') => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChartTypeSwitcher({
  currentViz,
  defaultViz,
  supportedVizTypes,
  isOverridden,
  onSelect,
}: ChartTypeSwitcherProps) {
  const CurrentIcon = VIZ_ICONS[currentViz];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
            isOverridden
              ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          aria-haspopup="listbox"
          aria-label={`Tipo de grafica: ${VISUALIZATION_TYPE_LABELS[currentViz]}. Activar para cambiar.`}
        >
          <CurrentIcon className="h-3 w-3" />
          <span>{VISUALIZATION_TYPE_LABELS[currentViz]}</span>
          {isOverridden && (
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(328,100%,45%)]" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        className="w-52 p-2"
      >
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-2">
          Tipo de grafica
        </p>

        <div role="listbox" className="space-y-0.5">
          {supportedVizTypes.map((vt) => {
            const Icon = VIZ_ICONS[vt];
            const isActive = currentViz === vt;
            const isDefault = vt === defaultViz;

            return (
              <button
                key={vt}
                role="option"
                aria-selected={isActive}
                onClick={() => onSelect(vt === defaultViz ? 'auto' : vt)}
                className={`flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 text-left font-medium">
                  {VISUALIZATION_TYPE_LABELS[vt]}
                </span>
                {isDefault && (
                  <span className="flex items-center gap-0.5 rounded-full bg-[hsl(328,100%,45%)]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[hsl(328,100%,45%)]">
                    <Sparkles className="h-2 w-2" />
                    Auto
                  </span>
                )}
                {isActive && (
                  <Check className="h-3 w-3 text-indigo-600 dark:text-indigo-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {isOverridden && (
          <>
            <div className="border-t my-1.5" />
            <button
              onClick={() => onSelect('auto')}
              className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Restablecer a Auto</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
