'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { FactoryStory } from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  GitBranch,
  RotateCcw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_ID_PREFIX = 'wave-node-';

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; bg: string; border: string; icon: typeof Clock | null; pulse: boolean }
> = {
  [AgentStatus.Idle]: {
    label: 'Pending',
    color: 'text-[#6B7280]',
    bg: 'bg-[#6B7280]/10',
    border: 'border-[#6B7280]/30',
    icon: Clock,
    pulse: false,
  },
  [AgentStatus.Coding]: {
    label: 'Coding',
    color: 'text-[#3B82F6]',
    bg: 'bg-[#3B82F6]/10',
    border: 'border-[#3B82F6]/50',
    icon: Loader2,
    pulse: true,
  },
  [AgentStatus.Testing]: {
    label: 'Testing',
    color: 'text-[#F59E0B]',
    bg: 'bg-[#F59E0B]/10',
    border: 'border-[#F59E0B]/50',
    icon: Loader2,
    pulse: true,
  },
  [AgentStatus.CreatingPR]: {
    label: 'Creating PR',
    color: 'text-[#06B6D4]',
    bg: 'bg-[#06B6D4]/10',
    border: 'border-[#06B6D4]/50',
    icon: Loader2,
    pulse: true,
  },
  [AgentStatus.InReview]: {
    label: 'In Review',
    color: 'text-[#0891B2]',
    bg: 'bg-[#0891B2]/10',
    border: 'border-[#0891B2]/50',
    icon: Clock,
    pulse: false,
  },
  [AgentStatus.Rejected]: {
    label: 'Rejected',
    color: 'text-[#EF4444]',
    bg: 'bg-[#EF4444]/10',
    border: 'border-[#EF4444]/50',
    icon: AlertCircle,
    pulse: false,
  },
  [AgentStatus.Done]: {
    label: 'Done',
    color: 'text-[#22C55E]',
    bg: 'bg-[#22C55E]/10',
    border: 'border-[#22C55E]/50',
    icon: CheckCircle2,
    pulse: false,
  },
  [AgentStatus.Error]: {
    label: 'Error',
    color: 'text-[#EF4444]',
    bg: 'bg-[#EF4444]/10',
    border: 'border-[#EF4444]/50',
    icon: AlertCircle,
    pulse: false,
  },
};

const WAVE_STATUS_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  running: { color: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/15', border: 'border-[#3B82F6]/30' },
  completed: { color: 'text-[#22C55E]', bg: 'bg-[#22C55E]/15', border: 'border-[#22C55E]/30' },
  pending: { color: 'text-[#6B7280]', bg: 'bg-[#6B7280]/15', border: 'border-[#6B7280]/30' },
  failed: { color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/15', border: 'border-[#EF4444]/30' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WaveGroup {
  number: number;
  status: string;
  stories: FactoryStory[];
}

interface DependencyEdge {
  fromId: string;
  toId: string;
}

// ---------------------------------------------------------------------------
// SVG Dependency Lines
// ---------------------------------------------------------------------------

function DependencyArrows({
  edges,
  containerRef,
}: {
  edges: DependencyEdge[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [paths, setPaths] = useState<{ d: string; active: boolean }[]>([]);

  const computePaths = useCallback(() => {
    const container = containerRef.current;
    if (!container || edges.length === 0) {
      setPaths([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const newPaths: { d: string; active: boolean }[] = [];

    for (const edge of edges) {
      const fromEl = container.querySelector(`[data-story-id="${edge.fromId}"]`);
      const toEl = container.querySelector(`[data-story-id="${edge.toId}"]`);
      if (!fromEl || !toEl) continue;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      const x1 = fromRect.right - containerRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
      const x2 = toRect.left - containerRect.left;
      const y2 = toRect.top + toRect.height / 2 - containerRect.top;

      // Control points tangenciales al nodo (estilo Sankey / dagre-d3): la
      // curva SALE horizontal del borde derecho del origen y ENTRA horizontal
      // al borde izquierdo del destino. Esto evita el giro abrupto que
      // producían los control points en (midX, y1) y (midX, y2) — donde la
      // tangente en cada extremo apuntaba hacia el centro en lugar de hacia
      // afuera del nodo.
      //
      // Offset = dx/2 con piso de 40px: para curvas horizontales puras
      // (y1 === y2) es matemáticamente una línea recta; para curvas con dy
      // produce una S suave. El piso de 40px evita curvas degeneradas cuando
      // los nodos están muy cerca horizontalmente.
      const dx = x2 - x1;
      const cpOffset = Math.max(Math.abs(dx) * 0.5, 40);
      const cp1X = x1 + cpOffset;
      const cp2X = x2 - cpOffset;

      // Check if target story is active
      const targetNode = container.querySelector(`[data-story-id="${edge.toId}"]`);
      const isActive = targetNode?.getAttribute('data-active') === 'true';

      newPaths.push({
        d: `M ${x1} ${y1} C ${cp1X} ${y1}, ${cp2X} ${y2}, ${x2} ${y2}`,
        active: isActive,
      });
    }

    setPaths(newPaths);
  }, [edges, containerRef]);

  useEffect(() => {
    computePaths();
    const observer = new ResizeObserver(computePaths);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [computePaths, containerRef]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      aria-hidden="true"
      style={{ zIndex: 1 }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#3B3B4F" />
        </marker>
        <marker
          id="arrowhead-active"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#3B82F6" />
        </marker>
      </defs>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.active ? '#3B82F6' : '#3B3B4F'}
          strokeWidth={p.active ? 1.5 : 1}
          strokeDasharray={p.active ? 'none' : '4 3'}
          markerEnd={p.active ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
          className={cn(p.active && 'opacity-80')}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Story Node
// ---------------------------------------------------------------------------

function StoryNode({ story }: { story: FactoryStory }) {
  const cfg = STATUS_CONFIG[story.status];
  const StatusIcon = cfg.icon;
  const isActive =
    story.status === AgentStatus.Coding ||
    story.status === AgentStatus.Testing ||
    story.status === AgentStatus.CreatingPR;

  return (
    <div
      data-story-id={story.id}
      data-active={isActive}
      className={cn(
        'relative rounded-lg border px-3 py-2.5 transition-all',
        cfg.bg,
        cfg.border,
        isActive && 'shadow-[0_0_12px_-3px_rgba(59,130,246,0.2)]',
      )}
      role="listitem"
      aria-label={`${story.title}, status ${cfg.label}`}
    >
      {/* Pulse ring for active stories */}
      {isActive && (
        <div
          className="absolute -inset-px rounded-lg border animate-ping opacity-20"
          style={{ borderColor: cfg.border.replace('border-', '').replace('/50', '') }}
          aria-hidden="true"
        />
      )}

      {/* Title + status en la misma fila (flex-1 al title para truncado correcto) */}
      <div className="flex items-center justify-between gap-2 relative z-10">
        <p className="text-muted-foreground text-xs truncate flex-1 min-w-0">{story.title}</p>
        <span className={cn('text-[11px] font-medium flex items-center gap-1 shrink-0', cfg.color)}>
          {StatusIcon && (
            <StatusIcon
              className={cn('h-3 w-3', isActive && 'animate-spin')}
              aria-hidden="true"
            />
          )}
          {cfg.label}
        </span>
      </div>

      {/* Retry indicator — solo se renderiza cuando hubo retries (info útil para diagnosis) */}
      {story.retryCount > 0 && (
        <div className="mt-1.5 relative z-10">
          <span className="flex items-center gap-0.5 text-[10px] text-amber-400 font-medium">
            <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
            {story.retryCount}/{story.maxRetries}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wave Column
// ---------------------------------------------------------------------------

function WaveColumn({ wave }: { wave: WaveGroup }) {
  const statusKey = wave.status;
  const wcfg = WAVE_STATUS_CONFIG[statusKey] ?? WAVE_STATUS_CONFIG.pending;

  return (
    <div className="flex flex-col min-w-[220px] max-w-[240px]" role="list" aria-label={`Wave ${wave.number}`}>
      {/* Wave header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border',
            wcfg.bg,
            wcfg.border,
            wcfg.color,
          )}
        >
          Wave {wave.number}
        </span>
        <span className="text-muted-foreground/70 text-xs">
          {wave.stories.length} {wave.stories.length === 1 ? 'story' : 'stories'}
        </span>
      </div>

      {/* Story cards */}
      <div className="space-y-2">
        {wave.stories.map((story) => (
          <StoryNode
            key={story.id}
            story={story}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

// Referencia estable para el default — evita recalcular los useMemo que
// dependen de `stories` en cada render cuando no se pasa la prop.
const EMPTY_STORIES: FactoryStory[] = [];

interface WaveDAGProps {
  /** Stories a renderizar (batch detail). Sin prop, el DAG queda vacío. */
  stories?: FactoryStory[];
  /** Batch name to display in header */
  batchName?: string;
  /** Batch branch to display in header */
  batchBranch?: string;
  /** Override waves (for batch detail). Falls back to state.factory.currentBatch.waves */
  batchWaves?: { number: number; status: string }[];
}

export function WaveDAG({ stories: propStories, batchName, batchBranch, batchWaves: propWaves }: WaveDAGProps = {}) {
  const { state } = useFactory();
  // `state.stories` se retiró del contexto (slice mock siempre vacío) — el
  // fallback honesto es un DAG vacío.
  const stories = propStories ?? EMPTY_STORIES;
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = batchName ?? state.factory.currentBatch?.name;
  const displayBranch = batchBranch ?? state.factory.currentBatch?.branch;

  // Group stories into waves
  const waves = useMemo<WaveGroup[]>(() => {
    const waveMap = new Map<number, FactoryStory[]>();
    stories.forEach((story) => {
      const existing = waveMap.get(story.waveNumber) ?? [];
      existing.push(story);
      waveMap.set(story.waveNumber, existing);
    });

    const batchWaveData = propWaves ?? state.factory.currentBatch?.waves?.map((w) => ({ number: w.number, status: String(w.status) })) ?? [];

    return Array.from(waveMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([number, waveStories]) => {
        const bw = batchWaveData.find((w) => w.number === number);
        return {
          number,
          status: bw ? bw.status : 'pending',
          stories: waveStories,
        };
      });
  }, [stories, propWaves, state.factory.currentBatch]);

  // Compute dependency edges
  const edges = useMemo<DependencyEdge[]>(() => {
    const result: DependencyEdge[] = [];
    for (const story of stories) {
      for (const depId of story.dependsOn) {
        result.push({ fromId: depId, toId: story.id });
      }
    }
    return result;
  }, [stories]);

  if (waves.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No active batch to visualize.</p>
      </div>
    );
  }

  return (
    <section aria-label="Wave Execution DAG" className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10" aria-hidden="true">
          <GitBranch className="h-4 w-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Wave Execution DAG</h2>
          {displayName && (
            <p className="text-xs text-muted-foreground">
              {displayName}
              {displayBranch && (
                <>
                  <span className="mx-1.5 text-border">|</span>
                  <span className="font-mono">{displayBranch}</span>
                </>
              )}
            </p>
          )}
        </div>
        {/* Legend */}
        <div className="ml-auto hidden md:flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1 text-[#22C55E]">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" /> Done
          </span>
          <span className="flex items-center gap-1 text-[#3B82F6]">
            <span className="h-2 w-2 rounded-full bg-[#3B82F6] animate-pulse" /> Active
          </span>
          <span className="flex items-center gap-1 text-[#6B7280]">
            <span className="h-2 w-2 rounded-full bg-[#6B7280]" /> Pending
          </span>
        </div>
      </div>

      {/* DAG container — dotted background inspired by Supabase */}
      <div
        className="rounded-xl border border-border bg-card p-5 overflow-x-auto"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.15) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        <div
          ref={containerRef}
          className="relative flex gap-16 min-w-max pb-2"
        >
          {/* SVG dependency arrows */}
          <DependencyArrows edges={edges} containerRef={containerRef} />

          {waves.map((wave) => (
            <div key={wave.number} className="flex items-start gap-0 relative z-10">
              <WaveColumn wave={wave} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
