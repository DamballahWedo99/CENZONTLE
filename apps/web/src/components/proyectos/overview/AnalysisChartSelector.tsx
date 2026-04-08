'use client';

import { useCallback, useState } from 'react';
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
  Sparkles,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type VisualizationType,
  type VizCategory,
  VIZ_TYPE_METADATA,
  VIZ_CATEGORIES,
  VISUALIZATION_TYPE_LABELS,
} from '@/lib/economic-analysis-agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisChartSelectorProps {
  /** Selected visualization types — empty array means "auto" */
  selected: VisualizationType[];
  onChange: (value: VisualizationType[]) => void;
}

// ---------------------------------------------------------------------------
// Icon mapping for all chart types
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

// Category order for display
const CATEGORY_ORDER: VizCategory[] = ['comparison', 'trend', 'composition', 'correlation', 'flow'];

// Category accent colors
const CATEGORY_COLORS: Record<VizCategory, { dot: string; text: string; bg: string; border: string }> = {
  comparison: {
    dot: 'bg-indigo-500',
    text: 'text-indigo-700 dark:text-indigo-300',
    bg: 'bg-indigo-50 dark:bg-indigo-950/30',
    border: 'border-indigo-200 dark:border-indigo-800',
  },
  trend: {
    dot: 'bg-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-50 dark:bg-sky-950/30',
    border: 'border-sky-200 dark:border-sky-800',
  },
  composition: {
    dot: 'bg-cyan-500',
    text: 'text-cyan-700 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    border: 'border-cyan-200 dark:border-cyan-800',
  },
  correlation: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
  },
  flow: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalysisChartSelector({ selected, onChange }: AnalysisChartSelectorProps) {
  const isAuto = selected.length === 0;
  const [expandedCategory, setExpandedCategory] = useState<VizCategory | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const toggleAuto = useCallback(() => {
    onChange([]);
    setExpandedCategory(null);
  }, [onChange]);

  const toggleViz = useCallback(
    (vt: VisualizationType) => {
      if (selected.includes(vt)) {
        onChange(selected.filter((v) => v !== vt));
      } else {
        onChange([...selected, vt]);
      }
    },
    [selected, onChange],
  );

  // Group metadata by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: VIZ_CATEGORIES[cat],
    items: VIZ_TYPE_METADATA.filter((m) => m.category === cat),
  }));

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-2">
        {/* Header bar — always visible, acts as toggle */}
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center justify-between w-full group"
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">
              Visualización
            </p>
            {!isAuto && (
              <span className="flex items-center justify-center h-4 min-w-[16px] rounded-full bg-[hsl(328,100%,45%)] text-white text-[9px] font-bold px-1">
                {selected.length}
              </span>
            )}
          </div>
          {panelOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>

        {/* Collapsible panel */}
        {panelOpen && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-150">

          {/* Auto toggle */}
          <div className="flex items-center justify-end">
          <button
            type="button"
            role="switch"
            aria-checked={isAuto}
            aria-label="Modo automático — cada sección usa su gráfica ideal"
            onClick={toggleAuto}
            className="flex items-center gap-2 select-none"
          >
            <span
              className={`flex items-center gap-1 text-[11px] font-semibold transition-colors ${
                isAuto
                  ? 'text-[hsl(328,100%,45%)]'
                  : 'text-muted-foreground'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              Auto
            </span>
            <span
              className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ${
                isAuto
                  ? 'bg-[hsl(328,100%,45%)] border-[hsl(328,100%,40%)]'
                  : 'bg-muted border-border'
              }`}
            >
              <span
                className={`pointer-events-none absolute top-[2px] inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  isAuto ? 'translate-x-[18px]' : 'translate-x-[2px]'
                }`}
              />
            </span>
          </button>
        </div>

        {/* Selection count badge */}
        {!isAuto && (
          <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[10px] border bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800">
            <Check className="h-3 w-3 shrink-0 text-indigo-700 dark:text-indigo-300" />
            <span className="font-medium text-indigo-700 dark:text-indigo-300">
              {selected.length} {selected.length === 1 ? 'visualización seleccionada' : 'visualizaciones seleccionadas'}
            </span>
          </div>
        )}

        {/* Category groups */}
        <div className="space-y-0.5">
          {grouped.map(({ category, label, items }) => {
            const colors = CATEGORY_COLORS[category];
            const isExpanded = expandedCategory === category;
            const selectedInCategory = items.filter((item) => selected.includes(item.type));

            return (
              <div key={category}>
                {/* Category header — clickable to expand */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedCategory(isExpanded ? null : category)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedCategory(isExpanded ? null : category); } }}
                  className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer ${
                    isExpanded
                      ? `${colors.bg}`
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${colors.dot}`} />
                  <span className={`text-[10px] font-semibold uppercase tracking-wider flex-1 ${
                    isExpanded ? colors.text : 'text-muted-foreground'
                  }`}>
                    {label}
                  </span>

                  {/* Compact type pills when collapsed */}
                  {!isExpanded && (
                    <div className="flex items-center gap-0.5">
                      {items.map((item) => {
                        const Icon = VIZ_ICONS[item.type];
                        const isSelected = selected.includes(item.type);
                        return (
                          <Tooltip key={item.type}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleViz(item.type);
                                }}
                                className={`flex items-center justify-center h-6 w-6 rounded transition-all ${
                                  isSelected
                                    ? `${colors.bg} ${colors.border} border shadow-sm`
                                    : isAuto
                                      ? 'opacity-40'
                                      : 'opacity-50 hover:opacity-100 hover:bg-muted'
                                }`}
                              >
                                <Icon className={`h-3 w-3 ${isSelected ? colors.text : 'text-muted-foreground'}`} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px]">
                              <p className="font-semibold text-[11px]">{item.label}</p>
                              <p className="text-[10px] text-muted-foreground">{item.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}

                  {/* Selected count badge for collapsed categories */}
                  {!isExpanded && selectedInCategory.length > 0 && (
                    <span className="flex items-center justify-center h-4 min-w-[16px] rounded-full bg-[hsl(328,100%,45%)] text-white text-[9px] font-bold px-1">
                      {selectedInCategory.length}
                    </span>
                  )}

                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                </div>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="pl-4 pr-1 pb-1 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                    {items.map((item) => {
                      const Icon = VIZ_ICONS[item.type];
                      const isSelected = selected.includes(item.type);

                      return (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => toggleViz(item.type)}
                          className="flex items-center gap-2.5 w-full rounded-md px-2 py-2 text-left transition-all hover:bg-muted/50"
                        >
                          {/* Checkbox */}
                          <span className={`flex items-center justify-center h-4 w-4 rounded border shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-[hsl(328,100%,45%)] border-[hsl(328,100%,40%)]'
                              : 'border-border bg-background'
                          }`}>
                            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                          </span>

                          {/* Icon */}
                          <span className={`flex items-center justify-center h-7 w-7 rounded-md shrink-0 ${
                            isSelected ? `${colors.bg}` : 'bg-muted/60'
                          }`}>
                            <Icon className={`h-3.5 w-3.5 ${isSelected ? colors.text : 'text-muted-foreground'}`} />
                          </span>

                          {/* Label & description */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-[11px] font-semibold leading-tight ${
                              isSelected ? colors.text : 'text-foreground'
                            }`}>
                              {item.label}
                            </p>
                            <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 truncate">
                              {item.description}
                            </p>
                          </div>

                          {/* Info tooltip */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                              >
                                <Info className="h-3 w-3" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[220px] space-y-1">
                              <p className="font-semibold text-[11px]">{item.label}</p>
                              <p className="text-[10px] text-muted-foreground">{item.description}</p>
                              <p className="text-[10px] font-medium text-[hsl(328,100%,45%)]">
                                Ideal para: {item.bestFor}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick access: top 5 as icon strip */}
        <div className="border-t pt-2 mt-1">
          <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mb-1.5 px-0.5">
            Acceso rápido
          </p>
          <div className="flex items-center gap-1">
            {(['bar', 'line', 'area', 'pie', 'radar'] as VisualizationType[]).map((vt) => {
              const Icon = VIZ_ICONS[vt];
              const isSelected = selected.includes(vt);
              const meta = VIZ_TYPE_METADATA.find((m) => m.type === vt)!;
              const colors = CATEGORY_COLORS[meta.category];

              return (
                <Tooltip key={vt}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleViz(vt)}
                      className={`group relative flex flex-col items-center gap-1 rounded-lg border py-1.5 px-1 flex-1 transition-all duration-150 ${
                        isSelected
                          ? `${colors.border} ${colors.bg} shadow-sm`
                          : isAuto
                            ? 'border-transparent bg-muted/20 opacity-50'
                            : 'border-transparent bg-muted/30 opacity-60 hover:opacity-100 hover:bg-muted/50'
                      } cursor-pointer`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${isSelected ? colors.text : 'text-muted-foreground'}`} />
                      <span className={`text-[8px] font-medium leading-tight ${
                        isSelected ? colors.text : 'text-muted-foreground'
                      }`}>
                        {VISUALIZATION_TYPE_LABELS[vt]}
                      </span>
                      {isSelected && (
                        <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(328,100%,45%)] ring-1 ring-background" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[200px]">
                    <p className="font-semibold text-[11px]">{meta.label}</p>
                    <p className="text-[10px] text-muted-foreground">{meta.description}</p>
                    <p className="text-[10px] font-medium text-[hsl(328,100%,45%)]">
                      Ideal para: {meta.bestFor}
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
