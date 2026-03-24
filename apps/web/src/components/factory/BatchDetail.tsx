'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import { WaveDAG } from '@/components/factory/WaveDAG';
import { AgentCard } from '@/components/factory/AgentCard';
import { AgentStatus, PipelineLayer, WaveStatus } from '@cenzontle/shared';
import type { FactoryAgent, FactoryStory, SprintBatch, Wave } from '@cenzontle/shared';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  ClipboardList,
  DollarSign,
  Eye,
  FlaskConical,
  GitBranch,
  Hammer,
  LayoutList,
  Loader2,
  Package,
  PackageOpen,
  Shield,
  Timer,
  AlertCircle,
  Layers,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIPELINE_LAYERS = [
  { layer: PipelineLayer.Requirements, label: 'Requirements', Icon: ClipboardList },
  { layer: PipelineLayer.Linear, label: 'Linear', Icon: LayoutList },
  { layer: PipelineLayer.Forge, label: 'Forge', Icon: Hammer },
  { layer: PipelineLayer.Staging, label: 'Staging', Icon: Eye },
  { layer: PipelineLayer.ReleaseBoard, label: 'Release Board', Icon: Package },
  { layer: PipelineLayer.QAGate, label: 'QA Gate', Icon: Shield },
];

const LAYER_ORDER: Record<PipelineLayer, number> = {
  [PipelineLayer.Requirements]: 0,
  [PipelineLayer.Linear]: 1,
  [PipelineLayer.Forge]: 2,
  [PipelineLayer.Staging]: 3,
  [PipelineLayer.ReleaseBoard]: 4,
  [PipelineLayer.QAGate]: 5,
};

const PRIORITY_STYLES: Record<string, { text: string; bg: string; border: string }> = {
  critical: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  high: { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  medium: { text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  low: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
};

const WAVE_STATUS_STYLES: Record<string, { text: string; bg: string; border: string }> = {
  [WaveStatus.Completed]: { text: 'text-[#22C55E]', bg: 'bg-[#22C55E]/10', border: 'border-[#22C55E]/30' },
  [WaveStatus.Running]: { text: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/10', border: 'border-[#3B82F6]/30' },
  [WaveStatus.Pending]: { text: 'text-[#6B7280]', bg: 'bg-[#6B7280]/10', border: 'border-[#6B7280]/30' },
  [WaveStatus.Failed]: { text: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10', border: 'border-[#EF4444]/30' },
};

const STORY_STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; bg: string; border: string; Icon: typeof Clock }
> = {
  [AgentStatus.Idle]: { label: 'Pending', color: 'text-[#6B7280]', bg: 'bg-[#6B7280]/10', border: 'border-[#6B7280]/30', Icon: Clock },
  [AgentStatus.Coding]: { label: 'Coding', color: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/10', border: 'border-[#3B82F6]/50', Icon: Loader2 },
  [AgentStatus.Testing]: { label: 'Testing', color: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10', border: 'border-[#F59E0B]/50', Icon: Loader2 },
  [AgentStatus.CreatingPR]: { label: 'Creating PR', color: 'text-[#A855F7]', bg: 'bg-[#A855F7]/10', border: 'border-[#A855F7]/50', Icon: Loader2 },
  [AgentStatus.InReview]: { label: 'In Review', color: 'text-[#D946EF]', bg: 'bg-[#D946EF]/10', border: 'border-[#D946EF]/50', Icon: Clock },
  [AgentStatus.Rejected]: { label: 'Rejected', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10', border: 'border-[#EF4444]/50', Icon: AlertCircle },
  [AgentStatus.Done]: { label: 'Done', color: 'text-[#22C55E]', bg: 'bg-[#22C55E]/10', border: 'border-[#22C55E]/50', Icon: CheckCircle2 },
  [AgentStatus.Error]: { label: 'Error', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10', border: 'border-[#EF4444]/50', Icon: AlertCircle },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function getLayerLabel(layer: PipelineLayer): string {
  const found = PIPELINE_LAYERS.find((l) => l.layer === layer);
  return found?.label ?? layer;
}

// ---------------------------------------------------------------------------
// BatchPipeline: compact horizontal 6-layer indicator
// ---------------------------------------------------------------------------

function BatchPipeline({ currentLayer }: { currentLayer: PipelineLayer }) {
  const currentIdx = LAYER_ORDER[currentLayer];

  return (
    <section aria-label="Batch Pipeline Progress" className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10" aria-hidden="true">
          <Layers className="h-3.5 w-3.5 text-indigo-400" />
        </div>
        <h2 className="text-sm font-semibold text-[#EDEDF0]">Pipeline Progress</h2>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
        {PIPELINE_LAYERS.map((layerDef, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;
          const { Icon } = layerDef;

          return (
            <div key={layerDef.layer} className="flex items-center gap-1 sm:gap-2">
              {/* Node */}
              <div
                className={cn(
                  'flex flex-col items-center gap-1.5 min-w-[56px]',
                )}
                aria-label={`${layerDef.label}: ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
                    isCompleted && 'border-[#22C55E] bg-[#22C55E]/15',
                    isCurrent && 'border-[#3B82F6] bg-[#3B82F6]/15 shadow-[0_0_12px_-2px_rgba(59,130,246,0.4)]',
                    isFuture && 'border-[#2A2A35] bg-[#141419]',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 text-[#22C55E]" aria-hidden="true" />
                  ) : (
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        isCurrent && 'text-[#3B82F6]',
                        isFuture && 'text-[#5A5A6E]',
                      )}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium text-center leading-tight',
                    isCompleted && 'text-[#22C55E]',
                    isCurrent && 'text-[#3B82F6]',
                    isFuture && 'text-[#5A5A6E]',
                  )}
                >
                  {layerDef.label}
                </span>
              </div>

              {/* Connector line */}
              {idx < PIPELINE_LAYERS.length - 1 && (
                <div
                  className={cn(
                    'h-px w-4 sm:w-6 flex-shrink-0 mt-[-18px]',
                    idx < currentIdx ? 'bg-[#22C55E]' : 'bg-[#2A2A35]',
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// WaveList: simplified wave/story display
// ---------------------------------------------------------------------------

interface WaveDisplayProps {
  waves: Wave[];
  stories: FactoryStory[];
  agents: FactoryAgent[];
}

function WaveList({ waves, stories, agents }: WaveDisplayProps) {
  const sortedWaves = useMemo(
    () => [...waves].sort((a, b) => a.number - b.number),
    [waves],
  );

  if (sortedWaves.length === 0) {
    return (
      <section aria-label="Waves" className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10" aria-hidden="true">
            <GitBranch className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <h2 className="text-sm font-semibold text-[#EDEDF0]">Waves</h2>
        </div>
        <p className="text-sm text-[#5A5A6E]">No waves defined for this batch.</p>
      </section>
    );
  }

  return (
    <section aria-label="Wave Execution" className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10" aria-hidden="true">
          <GitBranch className="h-3.5 w-3.5 text-blue-400" />
        </div>
        <h2 className="text-sm font-semibold text-[#EDEDF0]">Waves</h2>
        <span className="text-xs text-[#5A5A6E] ml-1">{sortedWaves.length} total</span>
      </div>

      <div className="space-y-3">
        {sortedWaves.map((wave) => {
          const waveStyle = WAVE_STATUS_STYLES[wave.status] ?? WAVE_STATUS_STYLES[WaveStatus.Pending];
          const waveStories = wave.storyIds
            .map((sid) => stories.find((s) => s.id === sid))
            .filter((s): s is FactoryStory => s !== undefined);

          return (
            <div key={wave.id} className="rounded-lg border border-[#2A2A35] bg-[#0F0F14] p-3">
              {/* Wave header */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border',
                    waveStyle.bg,
                    waveStyle.border,
                    waveStyle.text,
                  )}
                >
                  Wave {wave.number}
                </span>
                <span className={cn('text-[11px] font-medium capitalize', waveStyle.text)}>
                  {wave.status}
                </span>
                <span className="text-[11px] text-[#5A5A6E] ml-auto">
                  {waveStories.length} {waveStories.length === 1 ? 'story' : 'stories'}
                </span>
              </div>

              {/* Stories in wave */}
              {waveStories.length > 0 && (
                <div className="space-y-1.5" role="list" aria-label={`Wave ${wave.number} stories`}>
                  {waveStories.map((story) => {
                    const cfg = STORY_STATUS_CONFIG[story.status];
                    const StatusIcon = cfg.Icon;
                    const agent = story.agentId
                      ? agents.find((a) => a.id === story.agentId)
                      : null;
                    const isActive =
                      story.status === AgentStatus.Coding ||
                      story.status === AgentStatus.Testing ||
                      story.status === AgentStatus.CreatingPR;

                    return (
                      <div
                        key={story.id}
                        role="listitem"
                        aria-label={`${story.jiraKey}: ${story.title}, ${cfg.label}`}
                        className={cn(
                          'flex items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                          cfg.bg,
                          cfg.border,
                        )}
                      >
                        <StatusIcon
                          className={cn(
                            'h-3.5 w-3.5 flex-shrink-0',
                            cfg.color,
                            isActive && 'animate-spin',
                          )}
                          aria-hidden="true"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-[#EDEDF0]">
                              {story.jiraKey}
                            </span>
                            <span className="text-xs text-[#8B8B9A] truncate">{story.title}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {agent && (
                            <span className="flex items-center gap-1 text-[10px] text-[#5A5A6E]">
                              <Bot className="h-3 w-3" aria-hidden="true" />
                              {agent.name}
                            </span>
                          )}
                          <span className={cn('text-[10px] font-medium', cfg.color)}>{cfg.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AgentList: agents assigned to this batch
// ---------------------------------------------------------------------------

interface AgentListProps {
  agents: FactoryAgent[];
}

const AGENT_STATUS_STYLES: Record<AgentStatus, { label: string; color: string; bg: string }> = {
  [AgentStatus.Idle]: { label: 'Idle', color: 'text-[#6B7280]', bg: 'bg-[#6B7280]/10' },
  [AgentStatus.Coding]: { label: 'Coding', color: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/10' },
  [AgentStatus.Testing]: { label: 'Testing', color: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10' },
  [AgentStatus.CreatingPR]: { label: 'Creating PR', color: 'text-[#A855F7]', bg: 'bg-[#A855F7]/10' },
  [AgentStatus.InReview]: { label: 'In Review', color: 'text-[#D946EF]', bg: 'bg-[#D946EF]/10' },
  [AgentStatus.Rejected]: { label: 'Rejected', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10' },
  [AgentStatus.Done]: { label: 'Done', color: 'text-[#22C55E]', bg: 'bg-[#22C55E]/10' },
  [AgentStatus.Error]: { label: 'Error', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10' },
};

function AgentList({ agents }: AgentListProps) {
  const router = useRouter();

  return (
    <section aria-label="Assigned Agents">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10" aria-hidden="true">
          <Bot className="h-3.5 w-3.5 text-purple-400" />
        </div>
        <h2 className="text-sm font-semibold text-[#EDEDF0]">Assigned Agents</h2>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
          {agents.length} active
        </span>
        <span className="text-[10px] text-[#5A5A6E] ml-auto">Click to open terminal</span>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A35] bg-[#141419] p-8 text-center">
          <Bot className="h-8 w-8 text-[#6B7280] mx-auto mb-2" />
          <p className="text-sm text-[#5A5A6E]">No agents currently assigned to this batch.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={() => router.push(`/factory/agents?agent=${agent.id}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MetricsCards: key metrics for the batch
// ---------------------------------------------------------------------------

interface MetricsCardsProps {
  batch: SprintBatch;
  stories: FactoryStory[];
  agents: FactoryAgent[];
  testPassRate: number;
}

function MetricsCards({ batch, stories, agents, testPassRate }: MetricsCardsProps) {
  const doneStories = stories.filter((s) => s.status === AgentStatus.Done).length;
  const totalStories = stories.length;

  const elapsedSeconds = batch.startedAt
    ? Math.floor((Date.now() - new Date(batch.startedAt).getTime()) / 1000)
    : 0;

  const cards = [
    {
      label: 'Stories',
      value: `${doneStories}/${totalStories}`,
      sub: totalStories > 0 ? `${Math.round((doneStories / totalStories) * 100)}%` : '0%',
      Icon: ClipboardList,
      accent: 'text-blue-400',
      accentBg: 'bg-blue-500/10',
    },
    {
      label: 'Agents',
      value: `${agents.length}`,
      sub: `${agents.filter((a) => a.status !== AgentStatus.Idle && a.status !== AgentStatus.Done).length} active`,
      Icon: Bot,
      accent: 'text-purple-400',
      accentBg: 'bg-purple-500/10',
    },
    {
      label: 'Cost',
      value: formatCost(batch.totalCost),
      sub: `${(batch.totalTokens / 1_000_000).toFixed(1)}M tokens`,
      Icon: DollarSign,
      accent: 'text-emerald-400',
      accentBg: 'bg-emerald-500/10',
    },
    {
      label: 'Elapsed',
      value: formatDuration(elapsedSeconds),
      sub: batch.status === 'completed' ? 'finished' : 'running',
      Icon: Timer,
      accent: 'text-amber-400',
      accentBg: 'bg-amber-500/10',
    },
    {
      label: 'Tests',
      value: `${testPassRate}%`,
      sub: 'pass rate',
      Icon: FlaskConical,
      accent: testPassRate >= 90 ? 'text-emerald-400' : testPassRate >= 70 ? 'text-amber-400' : 'text-red-400',
      accentBg: testPassRate >= 90 ? 'bg-emerald-500/10' : testPassRate >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" role="list" aria-label="Batch Metrics">
      {cards.map((card) => (
        <div
          key={card.label}
          role="listitem"
          className="rounded-xl border border-[#2A2A35] bg-[#141419] p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md',
                card.accentBg,
              )}
              aria-hidden="true"
            >
              <card.Icon className={cn('h-3 w-3', card.accent)} />
            </div>
            <span className="text-[11px] font-medium text-[#8B8B9A]">{card.label}</span>
          </div>
          <p className="text-lg font-bold text-[#EDEDF0] leading-tight">{card.value}</p>
          <p className="text-[11px] text-[#5A5A6E] mt-0.5">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BatchDetail: main exported component
// ---------------------------------------------------------------------------

interface BatchDetailProps {
  batchId: string;
}

export function BatchDetail({ batchId }: BatchDetailProps) {
  const { state, computed } = useFactory();

  const batch = useMemo(
    () => state.factory.activeBatches.find((b) => b.id === batchId) ?? null,
    [state.factory.activeBatches, batchId],
  );

  // Get the full batch with waves from currentBatch if it matches, otherwise use activeBatches entry
  const fullBatch = useMemo<SprintBatch | null>(() => {
    if (state.factory.currentBatch?.id === batchId) {
      return state.factory.currentBatch;
    }
    return batch;
  }, [state.factory.currentBatch, batch, batchId]);

  // Collect all story IDs from the batch's waves
  const batchStoryIds = useMemo<Set<string>>(() => {
    if (!fullBatch) return new Set();
    const ids = new Set<string>();
    for (const wave of fullBatch.waves) {
      for (const sid of wave.storyIds) {
        ids.add(sid);
      }
    }
    // Also include stories directly on the batch
    for (const story of fullBatch.stories) {
      ids.add(story.id);
    }
    return ids;
  }, [fullBatch]);

  // Filter stories belonging to this batch
  const batchStories = useMemo<FactoryStory[]>(() => {
    if (batchStoryIds.size === 0) return state.stories;
    return state.stories.filter((s) => batchStoryIds.has(s.id));
  }, [state.stories, batchStoryIds]);

  // Filter agents that are working on stories in this batch
  const batchAgents = useMemo<FactoryAgent[]>(() => {
    const storyIdSet = new Set(batchStories.map((s) => s.id));
    return state.agents.filter((a) => a.storyId !== null && storyIdSet.has(a.storyId));
  }, [state.agents, batchStories]);

  // Compute test pass rate from tests related to batch stories
  const testPassRate = useMemo(() => {
    const storyIdSet = new Set(batchStories.map((s) => s.id));
    const relevantTests = state.tests.filter(
      (t) => t.storyId === null || storyIdSet.has(t.storyId),
    );
    const totalCases = relevantTests.reduce((sum, t) => sum + t.total, 0);
    const passedCases = relevantTests.reduce((sum, t) => sum + t.passed, 0);
    return totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
  }, [state.tests, batchStories]);

  if (!fullBatch) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#141419] border border-[#2A2A35]">
          <PackageOpen className="h-7 w-7 text-[#5A5A6E]" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-[#EDEDF0]">Batch not found</h1>
        <p className="text-sm text-[#8B8B9A]">
          Could not locate batch <span className="font-mono text-[#EDEDF0]">{batchId}</span>.
        </p>
        <Link
          href="/factory"
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#141419] border border-[#2A2A35] px-4 py-2 text-sm text-[#EDEDF0] hover:bg-[#1A1A22] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Factory
        </Link>
      </div>
    );
  }

  const priorityStyle = PRIORITY_STYLES[fullBatch.priority] ?? PRIORITY_STYLES.medium;

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/factory"
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-[#2A2A35] bg-[#141419] hover:bg-[#1A1A22] transition-colors"
            aria-label="Back to Factory"
          >
            <ArrowLeft className="h-4 w-4 text-[#8B8B9A]" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-[#EDEDF0] truncate">{fullBatch.epicTitle}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="font-mono text-xs text-[#8B8B9A]">{fullBatch.jiraKey}</span>
              <span className="text-[#2A2A35]" aria-hidden="true">|</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border',
                  priorityStyle.bg,
                  priorityStyle.border,
                  priorityStyle.text,
                )}
              >
                {fullBatch.priority}
              </span>
              <span className="text-[#2A2A35]" aria-hidden="true">|</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border',
                  'bg-[#3B82F6]/10 border-[#3B82F6]/30 text-[#3B82F6]',
                )}
              >
                {getLayerLabel(fullBatch.currentLayer)}
              </span>
            </div>
          </div>
        </div>

        {/* Branch badge */}
        <div className="flex items-center gap-2 rounded-lg border border-[#2A2A35] bg-[#0F0F14] px-3 py-2 self-start">
          <GitBranch className="h-3.5 w-3.5 text-[#5A5A6E]" aria-hidden="true" />
          <span className="font-mono text-xs text-[#8B8B9A]">{fullBatch.branch}</span>
        </div>
      </header>

      {/* ---- Metrics ---- */}
      <MetricsCards
        batch={fullBatch}
        stories={batchStories}
        agents={batchAgents}
        testPassRate={testPassRate}
      />

      {/* ---- Pipeline ---- */}
      <BatchPipeline currentLayer={fullBatch.currentLayer} />

      {/* ---- Wave DAG ---- */}
      <WaveDAG
        stories={batchStories}
        batchName={fullBatch.epicTitle}
        batchBranch={fullBatch.branch}
        batchWaves={fullBatch.waves.map((w) => ({ number: w.number, status: String(w.status) }))}
      />

      {/* ---- Agents ---- */}
      <AgentList agents={batchAgents} />
    </div>
  );
}
