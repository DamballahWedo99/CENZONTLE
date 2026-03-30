'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import { mockEpics } from '@/data/mock/proyectos/epics';
import { mockInitiatives } from '@/data/mock/proyectos/initiatives';
import { WaveDAG } from '@/components/factory/WaveDAG';
import { AgentCard } from '@/components/factory/AgentCard';
import { AgentStatus, GateDecision, PipelineLayer, WaveStatus } from '@cenzontle/shared';
import type { Epic, Initiative, FactoryAgent, FactoryStory, HumanGate, SprintBatch, Wave } from '@cenzontle/shared';
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
  ShieldAlert,
  CheckCircle,
  XCircle,
  Pause,
  User,
  Info,
  X,
  Bookmark,
  Target,
  Calendar,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIPELINE_LAYERS = [
  { layer: PipelineLayer.Forge, label: 'Forge', Icon: Hammer },
  { layer: PipelineLayer.Staging, label: 'Staged', Icon: Eye },
  { layer: PipelineLayer.QAGate, label: 'QA Testing', Icon: Shield },
  { layer: PipelineLayer.ReleaseBoard, label: 'Released', Icon: Package },
];

const LAYER_ORDER: Record<PipelineLayer, number> = {
  [PipelineLayer.Requirements]: -1,
  [PipelineLayer.Linear]: -1,
  [PipelineLayer.Forge]: 0,
  [PipelineLayer.Staging]: 1,
  [PipelineLayer.QAGate]: 2,
  [PipelineLayer.ReleaseBoard]: 3,
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
// PipelinePills: inline pill-style pipeline progress in header
// ---------------------------------------------------------------------------

function PipelinePills({ currentLayer }: { currentLayer: PipelineLayer }) {
  const currentIdx = LAYER_ORDER[currentLayer];

  return (
    <div className="flex items-center gap-1 overflow-x-auto" role="list" aria-label="Pipeline progress">
      {PIPELINE_LAYERS.map((layerDef, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;

        return (
          <div
            key={layerDef.layer}
            role="listitem"
            aria-label={`${layerDef.label}: ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}
            className={cn(
              'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
              isCompleted && 'text-[#22C55E]',
              isCurrent && 'text-[#3B82F6] bg-[#3B82F6]/10',
              !isCompleted && !isCurrent && 'text-muted-foreground/50',
            )}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  isCurrent && 'bg-[#3B82F6] shadow-[0_0_6px_rgba(59,130,246,0.5)]',
                  !isCurrent && 'bg-muted-foreground/30',
                )}
                aria-hidden="true"
              />
            )}
            {layerDef.label}
            {isCurrent && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[#3B82F6]" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
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
      <section aria-label="Waves" className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10" aria-hidden="true">
            <GitBranch className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Waves</h2>
        </div>
        <p className="text-sm text-muted-foreground/70">No waves defined for this batch.</p>
      </section>
    );
  }

  return (
    <section aria-label="Wave Execution" className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10" aria-hidden="true">
          <GitBranch className="h-3.5 w-3.5 text-blue-400" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Waves</h2>
        <span className="text-xs text-muted-foreground/70 ml-1">{sortedWaves.length} total</span>
      </div>

      <div className="space-y-3">
        {sortedWaves.map((wave) => {
          const waveStyle = WAVE_STATUS_STYLES[wave.status] ?? WAVE_STATUS_STYLES[WaveStatus.Pending];
          const waveStories = wave.storyIds
            .map((sid) => stories.find((s) => s.id === sid))
            .filter((s): s is FactoryStory => s !== undefined);

          return (
            <div key={wave.id} className="rounded-lg border border-border bg-card p-3">
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
                <span className="text-[11px] text-muted-foreground/70 ml-auto">
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
                        aria-label={`${story.tracker.externalKey}: ${story.title}, ${cfg.label}`}
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
                            <span className="font-mono text-xs font-semibold text-foreground">
                              {story.tracker.externalKey}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">{story.title}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {agent && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
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
        <h2 className="text-sm font-semibold text-foreground">Assigned Agents</h2>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
          {agents.length} active
        </span>
        <span className="text-[10px] text-muted-foreground/70 ml-auto">Click to open terminal</span>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Bot className="h-8 w-8 text-[#6B7280] mx-auto mb-2" />
          <p className="text-sm text-muted-foreground/70">No agents currently assigned to this batch.</p>
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
          className="rounded-xl border border-border bg-card p-4"
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
            <span className="text-[11px] font-medium text-muted-foreground">{card.label}</span>
          </div>
          <p className="text-lg font-bold text-foreground leading-tight">{card.value}</p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalSection: human gate approval cards for the batch
// ---------------------------------------------------------------------------

const GATE_DECISION_CONFIG: Record<GateDecision, { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle }> = {
  [GateDecision.Pending]: { label: 'Awaiting Approval', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/30', Icon: ShieldAlert },
  [GateDecision.Approved]: { label: 'Approved', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', Icon: CheckCircle },
  [GateDecision.Rejected]: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', Icon: XCircle },
  [GateDecision.Deferred]: { label: 'Deferred', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', Icon: Pause },
};

function formatGateTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function PendingGateCard({ gate, batchBranch, onDecision }: { gate: HumanGate; batchBranch: string; onDecision: (gateId: string, decision: GateDecision, notes: string) => void }) {
  const [notes, setNotes] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const cfg = GATE_DECISION_CONFIG[gate.decision];
  const GateIcon = cfg.Icon;

  return (
    <div className={cn('rounded-lg border p-4', cfg.border, cfg.bg)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GateIcon className={cn('h-4 w-4 animate-pulse', cfg.color)} aria-hidden="true" />
          <span className={cn('text-sm font-semibold', cfg.color)}>{cfg.label}</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground border border-border">
          {gate.type === 'staging' ? 'Staging Gate' : 'Release Gate'}
        </span>
      </div>

      {/* Consolidated PR info */}
      <div className="rounded-md border border-border bg-card px-3 py-2.5 mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <GitBranch className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-[11px] font-medium text-muted-foreground">Consolidated PR</span>
        </div>
        <p className="font-mono text-xs text-foreground mb-2">{batchBranch} → DEV</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Review the consolidated PR for business intent. This is not about bugs or code quality — agents already handled that. Focus on: business logic correctness, UX alignment, and strategic fit.
        </p>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground/70 mb-3">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Requested {formatGateTimestamp(gate.requestedAt)}
        </span>
      </div>

      {/* Review form */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Review Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Review notes — describe business intent concerns, UX issues, or strategic misalignment..."
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500/50 resize-none"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onDecision(gate.id, GateDecision.Approved, notes)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors"
          >
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            Approve & Merge to DEV
          </button>
          <button
            onClick={() => {
              if (!notes.trim()) {
                alert('Please provide notes explaining why changes are needed.');
                return;
              }
              onDecision(gate.id, GateDecision.Rejected, notes);
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-500/15 border border-red-500/30 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/25 transition-colors"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Request Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalSection({ gates, batchBranch, onDecision }: { gates: HumanGate[]; batchBranch: string; onDecision: (gateId: string, decision: GateDecision, notes: string) => void }) {
  if (gates.length === 0) return null;

  const pendingGates = gates.filter((g) => g.decision === GateDecision.Pending);
  const resolvedGates = gates.filter((g) => g.decision !== GateDecision.Pending);

  return (
    <section aria-label="Human Gate Approvals" className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-pink-500/10" aria-hidden="true">
          <ShieldAlert className="h-3.5 w-3.5 text-pink-400" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Human Gate Approvals</h2>
        {pendingGates.length > 0 && (
          <span className="rounded-full bg-pink-500/15 border border-pink-500/30 px-2 py-0.5 text-[10px] font-semibold text-pink-400 animate-pulse">
            Pending
          </span>
        )}
      </div>

      <div className="space-y-3">
        {pendingGates.map((gate) => (
          <PendingGateCard key={gate.id} gate={gate} batchBranch={batchBranch} onDecision={onDecision} />
        ))}

        {resolvedGates.map((gate) => {
          const cfg = GATE_DECISION_CONFIG[gate.decision];
          const GateIcon = cfg.Icon;
          return (
            <div
              key={gate.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GateIcon className={cn('h-4 w-4', cfg.color)} aria-hidden="true" />
                  <span className={cn('text-sm font-medium', cfg.color)}>{cfg.label}</span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground/70 border border-border">
                  {gate.type === 'staging' ? 'Staging Gate' : 'Release Gate'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground/70">
                {gate.reviewer && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" aria-hidden="true" />
                    {gate.reviewer}
                  </span>
                )}
                {gate.decidedAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {formatGateTimestamp(gate.decidedAt)}
                  </span>
                )}
              </div>
              {gate.notes && (
                <p className="text-xs text-muted-foreground mt-2">{gate.notes}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// BatchDetail: main exported component
// ---------------------------------------------------------------------------
// EpicInfoDrawer: side panel with epic details related to the batch
// ---------------------------------------------------------------------------

function EpicInfoDrawer({ batch, epic, initiative, open, onClose }: {
  batch: SprintBatch;
  epic: Epic | null;
  initiative: Initiative | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const epicName = epic?.title ?? batch.epicTitle;
  const storiesTotal = batch.stories.length;
  const storiesDone = batch.stories.filter((s) => s.status === AgentStatus.Done).length;
  const totalSP = batch.stories.reduce((s, st) => s + st.storyPoints, 0);
  const totalCost = batch.stories.reduce((s, st) => s + st.cost, 0);
  const startDate = batch.startedAt ? new Date(batch.startedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col bg-card border-l border-border shadow-2xl cursor-default',
          'transform transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={`Epic details: ${epicName}`}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Bookmark className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground truncate">Epic Details</h2>
              </div>
              <div className="mt-1">
                {epic ? (
                  <Link
                    href={`/proyectos/epicas/${epic.id}`}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors truncate block"
                  >
                    {epicName}
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground truncate">{epicName}</p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Identity */}
          <div className="rounded-lg border border-border bg-[#0d1117] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground/60">Tracker Key</span>
              <span className="font-mono text-xs text-foreground/90">{batch.tracker.externalKey}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground/60">Provider</span>
              <span className="text-xs text-foreground/90 capitalize">{batch.tracker.provider}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground/60">Branch</span>
              <a
                href={`https://github.com/DamballahWedo99/CENZONTLE/tree/${batch.branch}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-blue-400 hover:text-blue-300 hover:underline transition-colors"
              >
                {batch.branch}
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                <Calendar className="h-3 w-3" />
                Started
              </span>
              <span className="text-xs text-foreground/90">{startDate}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground/60">Initiative</span>
              <span className="text-xs text-foreground/90 text-right max-w-[60%] truncate">{initiative?.name ?? '—'}</span>
            </div>
          </div>

          {/* Epic details (from proyectos data) */}
          {epic && (
            <div>
              <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Epic Info
              </h3>
              <div className="rounded-lg border border-border bg-[#0d1117] p-4 space-y-3">
                {epic.description && (
                  <div>
                    <span className="text-[10px] text-muted-foreground/60 uppercase block mb-1">Description</span>
                    <p className="text-xs text-foreground/90 leading-relaxed">{epic.description}</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60">Status</span>
                  <span className="text-xs text-foreground/90 capitalize">{epic.status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60">Priority</span>
                  <span className="text-xs text-foreground/90 capitalize">{epic.priority}</span>
                </div>
                {epic.targetDate && (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                      <Target className="h-3 w-3" />
                      Target Date
                    </span>
                    <span className="text-xs text-foreground/90">
                      {new Date(epic.targetDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                )}
                {epic.teamsInvolved && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground/60">Teams</span>
                    <span className="text-xs text-foreground/90 text-right max-w-[60%] truncate">{epic.teamsInvolved}</span>
                  </div>
                )}
                {epic.scopeDescription && (
                  <div>
                    <span className="text-[10px] text-muted-foreground/60 uppercase block mb-1">Scope</span>
                    <p className="text-xs text-foreground/90 leading-relaxed">{epic.scopeDescription}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metrics */}
          <div>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Metrics
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/70 uppercase">Stories</span>
                <p className="text-base font-semibold text-foreground">{storiesDone}/{storiesTotal}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/70 uppercase">Story Points</span>
                <p className="text-base font-semibold text-foreground">{totalSP}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/70 uppercase">Agents</span>
                <p className="text-base font-semibold text-foreground">{batch.agentCount}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/70 uppercase">Cost</span>
                <p className="text-base font-semibold text-foreground">${totalCost.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Stories list */}
          <div>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Stories
            </h3>
            <div className="rounded-lg border border-border divide-y divide-border">
              {batch.stories.length > 0 ? batch.stories.map((story) => (
                <div key={story.id} className="grid grid-cols-[56px_1fr_40px] items-center gap-2 px-3 py-2">
                  <span className="font-mono text-[10px] text-muted-foreground/70 truncate">{story.tracker.externalKey}</span>
                  <span className="text-xs text-foreground truncate">{story.title}</span>
                  <span className="text-[10px] text-muted-foreground text-right shrink-0">{story.storyPoints}pt</span>
                </div>
              )) : (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground/50">No stories loaded</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

interface BatchDetailProps {
  batchId: string;
}

export function BatchDetail({ batchId }: BatchDetailProps) {
  const { state, dispatch, computed } = useFactory();
  // Use mock data directly — factory pages are outside ProyectosProvider
  const proyectosEpics = mockEpics;
  const proyectosInitiatives = mockInitiatives;

  const handleGateDecision = useCallback((gateId: string, decision: GateDecision, notes: string) => {
    const gate = state.gates.find((g) => g.id === gateId);
    if (!gate) return;
    dispatch({
      type: 'UPDATE_GATE',
      payload: {
        ...gate,
        decision,
        notes: notes || null,
        reviewer: 'Director General',
        decidedAt: new Date().toISOString(),
      },
    });
    // When staging gate is approved, advance pipeline to Staged
    if (gate.type === 'staging' && decision === GateDecision.Approved) {
      dispatch({
        type: 'UPDATE_FACTORY',
        payload: {
          ...state.factory,
          currentBatch: state.factory.currentBatch && state.factory.currentBatch.id === gate.batchId
            ? { ...state.factory.currentBatch, currentLayer: PipelineLayer.Staging }
            : state.factory.currentBatch,
          activeBatches: state.factory.activeBatches.map((b) =>
            b.id === gate.batchId ? { ...b, currentLayer: PipelineLayer.Staging } : b
          ),
        },
      });
    }
  }, [state.gates, state.factory, dispatch]);

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

  // Filter human gates belonging to this batch.
  // Release gate only shows after staging gate is approved (sequential approval flow).
  const batchGates = useMemo<HumanGate[]>(() => {
    const all = state.gates.filter((g) => g.batchId === batchId);
    const stagingGate = all.find((g) => g.type === 'staging');
    const stagingApproved = stagingGate?.decision === GateDecision.Approved;
    return all.filter((g) => {
      if (g.type === 'release' && !stagingApproved) return false;
      return true;
    });
  }, [state.gates, batchId]);

  if (!fullBatch) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-card border border-border">
          <PackageOpen className="h-7 w-7 text-muted-foreground/70" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Batch not found</h1>
        <p className="text-sm text-muted-foreground">
          Could not locate batch <span className="font-mono text-foreground">{batchId}</span>.
        </p>
        <Link
          href="/factory"
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Factory
        </Link>
      </div>
    );
  }

  const priorityStyle = PRIORITY_STYLES[fullBatch.priority] ?? PRIORITY_STYLES.medium;
  const [epicDrawerOpen, setEpicDrawerOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: back + title */}
          <div className="flex items-start gap-3">
            <Link
              href="/factory"
              className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted transition-colors"
              aria-label="Back to Factory"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold text-foreground truncate">{fullBatch.epicTitle}</h1>
                <button
                  onClick={() => setEpicDrawerOpen(true)}
                  className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  title="Epic details"
                >
                  <Info className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="font-mono text-xs text-muted-foreground">{fullBatch.tracker.externalKey}</span>
                <span className="text-border" aria-hidden="true">|</span>
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
              </div>
            </div>
          </div>

          {/* Right: pipeline pills + branch badge */}
          <div className="flex items-center gap-4 shrink-0">
            <PipelinePills currentLayer={fullBatch.currentLayer} />
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
              <a href={`https://github.com/DamballahWedo99/CENZONTLE/tree/${fullBatch.branch}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors">{fullBatch.branch}</a>
            </div>
          </div>
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

      {/* ---- Human Gate Approvals ---- */}
      <ApprovalSection gates={batchGates} batchBranch={fullBatch.branch} onDecision={handleGateDecision} />

      {/* ---- Wave DAG ---- */}
      <WaveDAG
        stories={batchStories}
        batchName={fullBatch.epicTitle}
        batchBranch={fullBatch.branch}
        batchWaves={fullBatch.waves.map((w) => ({ number: w.number, status: String(w.status) }))}
      />

      {/* ---- Agents ---- */}
      <AgentList agents={batchAgents} />

      {/* ---- Epic Info Drawer ---- */}
      <EpicInfoDrawer
        batch={fullBatch}
        epic={proyectosEpics.find(e => e.id === fullBatch.epicId) ?? null}
        initiative={(() => {
          const ep = proyectosEpics.find(e => e.id === fullBatch.epicId);
          return ep ? proyectosInitiatives.find(i => i.id === ep.initiativeId) ?? null : null;
        })()}
        open={epicDrawerOpen}
        onClose={() => setEpicDrawerOpen(false)}
      />
    </div>
  );
}
