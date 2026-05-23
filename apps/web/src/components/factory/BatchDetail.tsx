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
import { AgentDetailDrawer } from '@/components/factory/AgentDetailDrawer';
import { StagingGateApprovalDialog } from '@/components/factory/StagingGateApprovalDialog';
import { RoundCheckbox } from '@/components/ui/round-checkbox';
import { BatchPreviewButton } from '@/components/factory/BatchPreviewButton';
import { AgentStatus, GateDecision, PipelineLayer, WaveStatus } from '@cenzontle/shared';
import type { Epic, Initiative, FactoryAgent, FactoryStory, HumanGate, SprintBatch, Wave } from '@cenzontle/shared';
import type {
  BatchDetailResponse,
  BatchStoryDetail,
  RunDrawerDetail,
} from '@/lib/api/factory';
import { retryStory } from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  ClipboardList,
  DollarSign,
  Eye,
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
  AlertTriangle,
  RotateCw,
  MinusCircle,
  SquareTerminal,
  ListChecks,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mappers: BatchDetailResponse (backend real) → shapes que la UI espera
// ---------------------------------------------------------------------------
//
// La UI fue diseñada contra `SprintBatch + FactoryStory[] + FactoryAgent[] +
// HumanGate[]` (mocks del FactoryContext). Para reusar el componente con datos
// REALES del endpoint `/factory/queue/:batchId/detail`, mapeamos el response
// del backend a esos shapes — la UI queda 100% igual, solo cambia la fuente.
//
// Cosas que el backend NO modela todavía (mapeamos a placeholders sensatos):
//   - HumanGate persistido → derivamos 1 gate sintético desde `awaitingHumanGate`
//   - Test pass rate → 0 (no tenemos tests trackeados en DB)
//   - Initiative info → no aplica (el SprintBatch no la requiere directamente)

function mapBatchDetailToSprintBatch(data: BatchDetailResponse): SprintBatch {
  const stories: FactoryStory[] = data.stories.map((s) => ({
    id: s.id,
    tracker: { provider: 'linear' as const, externalId: '', externalKey: '', externalUrl: '' },
    title: s.title,
    description: '',
    waveNumber: s.waveNumber,
    dependsOn: s.blockedByIds,
    agentId: s.latestRun?.id ?? null,
    prNumber: s.latestRun?.prNumber ?? null,
    status: mapStoryStatusToAgentStatus(s.status, s.latestRun?.status),
    storyPoints: s.storyPoints,
    startedAt: s.latestRun?.startedAt ?? null,
    completedAt: s.latestRun?.completedAt ?? null,
    retryCount: 0,
    maxRetries: 3,
    tokens: 0,
    cost: 0,
  }));

  // Waves: agrupar stories por waveNumber. Cada Wave necesita: number, name,
  // status, storyIds. El status del wave deriva del status de sus stories.
  const wavesMap = new Map<number, FactoryStory[]>();
  for (const s of stories) {
    const arr = wavesMap.get(s.waveNumber) ?? [];
    arr.push(s);
    wavesMap.set(s.waveNumber, arr);
  }
  const waves: Wave[] = Array.from(wavesMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([num, ss]) => {
      const allDone = ss.every((s) => s.status === AgentStatus.Done);
      const anyActive = ss.some(
        (s) =>
          s.status === AgentStatus.Coding ||
          s.status === AgentStatus.Testing ||
          s.status === AgentStatus.CreatingPR,
      );
      const status: WaveStatus = allDone
        ? WaveStatus.Completed
        : anyActive
          ? WaveStatus.Running
          : WaveStatus.Pending;
      return {
        id: `wave-${data.batchId}-${num}`,
        number: num,
        status,
        storyIds: ss.map((s) => s.id),
        startedAt: null,
        completedAt: null,
      };
    });

  // branch name: si el backend confirmó forgeBranch, usamos ése (=branch
  // real en GitHub). Si es null (sandbox real o branch aún sin crear),
  // mostramos el nombre derivado por convención SOLO para display textual —
  // pero `branchUrl` queda null para que el frontend NO renderice un link
  // que apunta a un 404.
  const branchName =
    data.forgeBranch ?? `forge/sprint-batch-${data.batchId.slice(0, 8)}`;
  // URL clickeable solo si tenemos repo configurado Y la branch existe en
  // remote (ambos confirmados por el backend). Si falta cualquiera, el
  // frontend muestra el name sin link (con tooltip explicativo).
  const branchUrl =
    data.repoUrl && data.forgeBranch
      ? `${data.repoUrl}/tree/${data.forgeBranch}`
      : null;

  return {
    id: data.batchId,
    name: data.epicTitle,
    epicId: data.epicId,
    epicTitle: data.epicTitle,
    tracker: { provider: 'linear' as const, externalId: '', externalKey: '', externalUrl: '' },
    stories,
    waves,
    branch: branchName,
    branchUrl,
    status: data.storiesDone === data.storiesCount && data.storiesCount > 0 ? 'completed' : 'in-progress',
    // Pipeline layer derivado del backend: si el Tech Lead ya aprobó el
    // staging gate (`stagingApprovedAt` persistido), el batch ha avanzado
    // a Staged. Sin este derive, después de aprobar el modal el badge del
    // pipeline seguía en Forge hasta refresh manual.
    currentLayer: data.stagingApprovedAt
      ? PipelineLayer.Staging
      : PipelineLayer.Forge,
    agentCount: data.storiesInProgress,
    priority: data.priority,
    startedAt: data.runStartedAt ?? data.enqueuedAt,
    // Deriva completedAt — congela el reloj del card "Elapsed" cuando el
    // Forge terminó. Sin esto, el card sigue tickeando con Date.now() aunque
    // el batch haya terminado hace horas. El backend NO setea este campo en
    // BatchDetailResponse, así que el frontend lo deriva.
    //
    // El Forge "terminó" cuando todas las stories están en estado terminal —
    // eso es `awaitingHumanGate`, que INCLUYE las stories `blocked`. Antes la
    // condición era `storiesDone === storiesCount` (solo done), así que un
    // batch con una story bloqueada dejaba el reloj corriendo para siempre
    // (bug 2026-05-20).
    completedAt: (() => {
      if (!data.awaitingHumanGate) {
        return null; // el Forge aún está procesando stories
      }
      // Forge terminó — el cierre del batch es el max completedAt de los runs.
      // Incluye los runs `failed` de stories blocked (que también lo tienen).
      const completedTimestamps = stories
        .map((s) => s.completedAt)
        .filter((t): t is string => t !== null)
        .map((t) => new Date(t).getTime());
      if (completedTimestamps.length === 0) return null;
      return new Date(Math.max(...completedTimestamps)).toISOString();
    })(),
    totalCost: data.totalCostUsd,
    totalTokens: data.totalTokens,
    totalTokensNew: data.totalTokensNew,
    totalTokensCached: data.totalTokensCached,
  };
}

function mapStoryStatusToAgentStatus(
  storyStatus: string,
  runStatus: string | undefined,
): AgentStatus {
  if (storyStatus === 'done') return AgentStatus.Done;
  if (storyStatus === 'blocked') return AgentStatus.Error;
  if (storyStatus === 'in_review') return AgentStatus.InReview;
  if (storyStatus === 'qa') return AgentStatus.Testing;
  if (runStatus === 'running' || runStatus === 'claimed') return AgentStatus.Coding;
  if (runStatus === 'failed') return AgentStatus.Error;
  return AgentStatus.Idle;
}

function mapBatchDetailToAgents(data: BatchDetailResponse): FactoryAgent[] {
  // Un FactoryAgent sintético por cada story que tenga un latestRun activo.
  // Esto es lo que la AgentCard / AgentList esperan para renderear.
  return data.stories
    .filter((s) => s.latestRun !== null)
    .map((s) => {
      const run = s.latestRun!;
      // Duration: si el run ya terminó, completedAt - startedAt es fijo. Si
      // sigue corriendo, calculamos contra Date.now() (la card no tiene timer
      // tick propio así que muestra snapshot al render, no live).
      // startedAt puede ser null durante la ventana claim→running (el tipo
      // ahora lo refleja honesto). Si lo es, durationSeconds = 0 — el card
      // mostrará "0s" temporalmente hasta que el worker reporte el inicio
      // real (≤30s, intervalo del progress endpoint).
      const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
      const endedMs = run.completedAt
        ? new Date(run.completedAt).getTime()
        : Date.now();
      const durationSeconds =
        startedMs === 0 ? 0 : Math.max(0, Math.floor((endedMs - startedMs) / 1000));
      return {
        id: run.id,
        name: s.title,
        storyId: s.id,
        storyKey: `${s.id.slice(0, 8)}`,
        status: mapStoryStatusToAgentStatus(s.status, run.status),
        worktree: run.branch,
        tmuxSession: `cenzontle-${run.id.slice(0, 8)}`,
        // Fallback a string vacío si el backend aún no setea startedAt; el
        // FactoryAgent type lo declara como string (no nullable). Cuando el
        // run transicione a running, el próximo poll trae el ISO real.
        startedAt: run.startedAt ?? '',
        // Métricas reales del backend (antes hardcoded a 0). Default a 0/null
        // para clientes legacy o runs sin datos persistidos (pre-feature).
        duration: durationSeconds,
        tokens: run.tokensNew ?? 0,
        cost: run.costUsd ?? 0,
        lastOutput: [],
        currentFile: null,
        linesWritten: 0,
        testsRun: 0,
        testsPassed: 0,
        filesModified: run.filesModified ?? null,
      };
    });
}

function mapBatchDetailToGates(data: BatchDetailResponse): HumanGate[] {
  // Emitimos un gate sintético cuando el batch llegó al estado de approval
  // (todas las stories done o ya aprobado). El `decision` se deriva de
  // `stagingApprovedAt` del backend — esa es la fuente de verdad ahora
  // que el approval se persiste. Antes el gate siempre venía `Pending`
  // y la card "Awaiting Approval" no desaparecía tras aprobar.
  if (!data.awaitingHumanGate && !data.stagingApprovedAt) return [];
  const approved = Boolean(data.stagingApprovedAt);
  return [
    {
      id: `gate-staging-${data.batchId}`,
      batchId: data.batchId,
      type: 'staging',
      decision: approved ? GateDecision.Approved : GateDecision.Pending,
      reviewer: approved ? data.stagingApprovedByName ?? null : null,
      notes: null,
      qaReport: null,
      requestedAt: data.runStartedAt ?? data.enqueuedAt,
      decidedAt: data.stagingApprovedAt ?? null,
    },
  ];
}

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
  [AgentStatus.CreatingPR]: { label: 'Creating PR', color: 'text-[#06B6D4]', bg: 'bg-[#06B6D4]/10', border: 'border-[#06B6D4]/50', Icon: Loader2 },
  [AgentStatus.InReview]: { label: 'In Review', color: 'text-[#0891B2]', bg: 'bg-[#0891B2]/10', border: 'border-[#0891B2]/50', Icon: Clock },
  [AgentStatus.Rejected]: { label: 'Rejected', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10', border: 'border-[#EF4444]/50', Icon: AlertCircle },
  [AgentStatus.Done]: { label: 'Done', color: 'text-[#22C55E]', bg: 'bg-[#22C55E]/10', border: 'border-[#22C55E]/50', Icon: CheckCircle2 },
  [AgentStatus.Error]: { label: 'Error', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10', border: 'border-[#EF4444]/50', Icon: AlertCircle },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formatea conteo de tokens con sufijo K/M para legibilidad. Antes mostrábamos
 * solo "X.YM tokens" lo cual daba "0.0M" para cualquier valor <100K — la mayoría
 * de runs caen entre 10K-900K tokens y se veían como cero. Ahora:
 *   < 1K        → "0 tokens" / "12 tokens" / "523 tokens"
 *   1K - 999K   → "12.3K tokens" (1 decimal)
 *   >= 1M       → "1.5M tokens" (1 decimal)
 */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tokens`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K tokens`;
  return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  // Formato compuesto con SEGUNDOS visibles — antes mostraba solo "2m" para
  // un batch de 2m 35s, perdiendo 35s de información. El operador ahora ve
  // el reloj subir Xm 1s → Xm 2s → ... cada segundo (vía timer tick).
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
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

/**
 * Arma un `RunDrawerDetail` (datos reales del run para el AgentDetailDrawer)
 * desde un `BatchStoryDetail`. Retorna null si la story no tiene run — el
 * drawer cae a mock mode, que es lo correcto para una story sin ejecutar.
 */
function buildRunDrawerDetail(
  story: BatchStoryDetail,
  epicId: string,
  epicTitle: string,
  allStories: BatchStoryDetail[],
): RunDrawerDetail | null {
  const run = story.latestRun;
  if (!run) return null;
  const criteria = run.criteria ?? [];
  // Guard contra timestamps malformados: `new Date('bad').getTime()` → NaN,
  // que ES `number` y se colaría como durationMs → la UI mostraría "NaN".
  const completedMs = run.completedAt
    ? new Date(run.completedAt).getTime()
    : NaN;
  const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : NaN;
  const durationMs =
    Number.isFinite(completedMs) && Number.isFinite(startedMs)
      ? completedMs - startedMs
      : null;
  return {
    branch: run.branch,
    epicId,
    epicTitle,
    // El batch detail no expone tracker keys — el drawer los oculta si null.
    epicTrackerKey: null,
    storyTitle: story.title,
    storyPoints: story.storyPoints,
    storyTrackerKey: null,
    dependsOn: story.blockedByIds.map((id) => ({
      key: null,
      title: allStories.find((s) => s.id === id)?.title ?? id,
    })),
    durationMs,
    tokensNew: run.tokensNew ?? 0,
    costUsd: run.costUsd ?? 0,
    filesModified: run.filesModified ?? null,
    attempts: run.attempts ?? 0,
    dodPassed: criteria.filter((c) => c.status === 'passed').length,
    dodTotal: criteria.length,
  };
}

interface AgentListProps {
  agents: FactoryAgent[];
  stories: FactoryStory[];
  batch: SprintBatch | null;
  /** Datos reales del run por storyId — alimentan el AgentDetailDrawer en
   *  modo run. El padre lo arma desde `realBatchData`; un agente cuya story
   *  no tiene run no está en el mapa y el drawer cae a mock mode. */
  runDetailByStory: Map<string, RunDrawerDetail>;
}

const AGENT_STATUS_STYLES: Record<AgentStatus, { label: string; color: string; bg: string }> = {
  [AgentStatus.Idle]: { label: 'Idle', color: 'text-[#6B7280]', bg: 'bg-[#6B7280]/10' },
  [AgentStatus.Coding]: { label: 'Coding', color: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/10' },
  [AgentStatus.Testing]: { label: 'Testing', color: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10' },
  [AgentStatus.CreatingPR]: { label: 'Creating PR', color: 'text-[#06B6D4]', bg: 'bg-[#06B6D4]/10' },
  [AgentStatus.InReview]: { label: 'In Review', color: 'text-[#0891B2]', bg: 'bg-[#0891B2]/10' },
  [AgentStatus.Rejected]: { label: 'Rejected', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10' },
  [AgentStatus.Done]: { label: 'Done', color: 'text-[#22C55E]', bg: 'bg-[#22C55E]/10' },
  [AgentStatus.Error]: { label: 'Error', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10' },
};

function AgentList({
  agents,
  stories,
  batch,
  runDetailByStory,
}: AgentListProps) {
  // Agent seleccionado por el botón info ⓘ. Null = drawer cerrado. Se cierra
  // con la X del drawer, click en overlay o Escape (manejado por el componente).
  const [infoAgent, setInfoAgent] = useState<FactoryAgent | null>(null);

  // El badge dice "N active" SOLO cuando hay agents trabajando realmente
  // (Coding/Testing/CreatingPR). Si todos terminaron, mostramos "N done"; si
  // hay mix, "N total". Antes decía "N active" hardcoded incluso cuando todos
  // habían finalizado — confundía al operador que veía "3 active" pero ningún
  // worker corriendo.
  const activeCount = agents.filter(
    (a) =>
      a.status === AgentStatus.Coding ||
      a.status === AgentStatus.Testing ||
      a.status === AgentStatus.CreatingPR,
  ).length;
  const allDone = agents.length > 0 && agents.every((a) => a.status === AgentStatus.Done);
  const badgeLabel =
    activeCount > 0
      ? `${activeCount} active`
      : allDone
        ? `${agents.length} done`
        : `${agents.length} total`;

  return (
    <section aria-label="Assigned Agents">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10" aria-hidden="true">
          <Bot className="h-3.5 w-3.5 text-cyan-400" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Assigned Agents</h2>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {badgeLabel}
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
              onClick={() =>
                window.open(
                  `/factory/agents/${agent.id}/terminal`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
              onInfoClick={() => setInfoAgent(agent)}
            />
          ))}
        </div>
      )}

      {/* Drawer con info detallada del agente — disparado por el botón ⓘ del card.
          Story se resuelve via storyId del agent (mapping 1:1 en el current model). */}
      {infoAgent && (
        <AgentDetailDrawer
          agent={infoAgent}
          story={stories.find((s) => s.id === infoAgent.storyId) ?? null}
          batch={batch}
          open={infoAgent !== null}
          onClose={() => setInfoAgent(null)}
          runDetail={
            infoAgent.storyId
              ? (runDetailByStory.get(infoAgent.storyId) ?? null)
              : null
          }
        />
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
}

function MetricsCards({ batch, stories, agents }: MetricsCardsProps) {
  const doneStories = stories.filter((s) => s.status === AgentStatus.Done).length;
  const totalStories = stories.length;

  // Tick state que fuerza re-render cada 1s MIENTRAS el batch está corriendo
  // (completedAt === null). Sin esto, Date.now() se evalúa una sola vez en el
  // primer render y el card queda congelado en "0m" — el operador piensa que
  // está atascado y aborta innecesariamente. Cuando el batch termina, el
  // interval se limpia y el cálculo queda fijo en completedAt.
  const [, setLiveTick] = useState(0);
  useEffect(() => {
    if (batch.completedAt) return; // batch terminado → no tickear
    const intervalId = setInterval(() => setLiveTick((n) => n + 1), 1000);
    return () => clearInterval(intervalId);
  }, [batch.completedAt]);

  // Elapsed: si el batch ya terminó (completedAt set), congelar el cálculo en
  // ese timestamp. Mientras corre, usamos Date.now() y el tick anterior fuerza
  // que se re-evalúe cada segundo. Antes usábamos Date.now() siempre, lo que
  // hacía que un batch de 2 minutos terminado hace 11h mostrara "11h 34m"
  // creciendo monotónicamente con el reloj.
  const endMs = batch.completedAt
    ? new Date(batch.completedAt).getTime()
    : Date.now();
  const elapsedSeconds = batch.startedAt
    ? Math.max(0, Math.floor((endMs - new Date(batch.startedAt).getTime()) / 1000))
    : 0;

  // Token sub-text del card Cost. Si el backend mandó el split (totalTokensNew
  // + totalTokensCached), mostramos ambos en una sola línea con el cached en
  // color tenue para indicar que es secundario. Si no (cliente legacy o
  // sin data), fallback al total único como antes.
  const costSub: React.ReactNode =
    batch.totalTokensNew !== undefined && batch.totalTokensCached !== undefined ? (
      <>
        <span>{formatTokens(batch.totalTokensNew)} new</span>
        <span className="text-muted-foreground/50">
          {' + '}
          {formatTokens(batch.totalTokensCached)} cached
        </span>
      </>
    ) : (
      formatTokens(batch.totalTokens)
    );

  const cards: Array<{
    label: string;
    value: string;
    sub: React.ReactNode;
    Icon: typeof ClipboardList;
    accent: string;
    accentBg: string;
  }> = [
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
      accent: 'text-cyan-400',
      accentBg: 'bg-cyan-500/10',
    },
    {
      label: 'Cost',
      value: formatCost(batch.totalCost),
      sub: costSub,
      Icon: DollarSign,
      accent: 'text-emerald-400',
      accentBg: 'bg-emerald-500/10',
    },
    {
      label: 'Elapsed',
      value: formatDuration(elapsedSeconds),
      // El subtexto sigue al reloj: si completedAt está set (reloj congelado),
      // el Forge terminó → "finished"; si no, sigue corriendo. Antes usaba
      // `batch.status === 'completed'`, que decía "running" para un batch
      // terminado con stories blocked (bug 2026-05-20).
      sub: batch.completedAt ? 'finished' : 'running',
      Icon: Timer,
      accent: 'text-amber-400',
      accentBg: 'bg-amber-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="list" aria-label="Batch Metrics">
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
  [GateDecision.Pending]: { label: 'Awaiting Approval', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', Icon: ShieldAlert },
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

/**
 * Botón "Reintentar" para una story con deuda técnica. Re-encola la story en
 * el Forge (POST .../stories/:id/retry → story.status='backlog'): el worker la
 * re-claim en el próximo poll y re-ejecuta el flujo COMPLETO (re-implementación
 * + DoD). Como consume tokens reales de la API, la acción se gatea con un
 * ConfirmDialog explícito — consistente con que el retry es "una acción humana
 * explícita" (ver completeRun en agent-run.service.ts).
 *
 * Estado `queued`: tras un retry exitoso el card sigue mostrando el run viejo
 * (el filtro de IncompleteStoriesAlert mira latestRun, no story.status) hasta
 * que el worker produzca un run nuevo. Mientras tanto el botón muestra "En
 * cola" deshabilitado — feedback honesto de "ya la reintentaste". El callsite
 * le pasa `key={run.id}`, así que un run nuevo remonta el componente y re-arma
 * el botón con estado fresco — sin necesidad de un effect que resetee state.
 */
function RetryStoryButton({
  batchId,
  story,
  onRetried,
}: {
  batchId: string;
  story: BatchStoryDetail;
  onRetried?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [queued, setQueued] = useState(false);

  const handleConfirm = async () => {
    try {
      const res = await retryStory(batchId, story.id);
      setQueued(true);
      toast.success('Story re-encolada en el Forge', {
        description: `"${res.storyTitle}" volvió a la cola. El worker la re-claimará en el próximo poll y re-ejecutará la implementación + el DoD.`,
      });
      onRetried?.();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Error inesperado al reintentar la story.';
      toast.error('No se pudo reintentar la story', { description: msg });
      // Re-throw: ConfirmDialog deja el modal abierto on-throw para que el
      // operador pueda cancelar o reintentar el click.
      throw err;
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={queued}
        className={cn(
          'inline-flex items-center gap-1 text-[10px] shrink-0',
          queued
            ? 'text-muted-foreground/50 cursor-default'
            : 'text-amber-400 hover:text-amber-300 hover:underline',
        )}
        title={
          queued
            ? 'Story re-encolada — esperando a que el worker la re-claim'
            : `Re-encola "${story.title}" en el Forge — el worker la re-ejecuta desde cero (implementación + DoD). Consume tokens.`
        }
      >
        {queued ? (
          <>
            <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
            En cola
          </>
        ) : (
          <>
            <RotateCw className="h-2.5 w-2.5" aria-hidden="true" />
            Reintentar
          </>
        )}
      </button>
      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={`Reintentar "${story.title}"`}
        description="El worker re-claimará esta story y re-ejecutará el flujo completo del Forge: el agente la re-implementa desde la branch base y vuelve a correr el DoD. Consume tokens reales de la API. Si la story ya generó un PR, el re-run produce un run y commits nuevos. Hazlo después de corregir la causa raíz del fallo — por ejemplo, vincular un secreto externo faltante en /factory/settings."
        confirmText="Reintentar story"
        onConfirm={handleConfirm}
      />
    </>
  );
}

/**
 * Checklist DoD de un run — cada criterio del verifier con su veredicto
 * (✓ cumplido / − saltado / ✗ no cumplido) + el motivo en los no-pasados.
 * Data objetiva: viene de los verdicts del verifier, no de un auto-reporte
 * del agente. Compartida por IncompleteStoriesAlert (fallos duros de
 * ejecución) y ForgeReviewAlert (warns del DoD en stories completadas).
 */
function DodChecklist({
  criteria,
}: {
  criteria: NonNullable<BatchStoryDetail['latestRun']>['criteria'];
}) {
  if (!criteria || criteria.length === 0) return null;
  const passed = criteria.filter((c) => c.status === 'passed').length;
  return (
    <div className="mt-1.5">
      <p className="text-[10px] font-medium text-muted-foreground/80 mb-1">
        Checklist DoD ·{' '}
        <span className="tabular-nums">
          {passed}/{criteria.length}
        </span>{' '}
        cumplidos
      </p>
      <ul className="space-y-1">
        {criteria.map((c, idx) => {
          const statusText =
            c.status === 'passed'
              ? 'cumplido'
              : c.status === 'skipped'
                ? 'saltado'
                : 'no cumplido';
          return (
            <li
              // c.id puede colisionar a 'unknown' si un verdict tiene id
              // malformado — idx como tie-breaker evita el key collision.
              key={`${c.id}-${idx}`}
              aria-label={`${c.label}: ${statusText}`}
              className="flex items-start gap-1.5 text-[10px] leading-snug"
            >
              {c.status === 'passed' ? (
                <CheckCircle2
                  className="h-3 w-3 text-green-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              ) : c.status === 'skipped' ? (
                <MinusCircle
                  className="h-3 w-3 text-muted-foreground/40 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <XCircle
                  className="h-3 w-3 text-red-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <span
                  className={cn(
                    'font-medium',
                    c.status === 'passed' && 'text-muted-foreground',
                    c.status === 'failed' && 'text-foreground',
                    c.status === 'skipped' && 'text-muted-foreground/60',
                  )}
                >
                  {c.label}
                </span>
                {c.status === 'skipped' && (
                  <span className="text-muted-foreground/40 ml-1">(saltado)</span>
                )}
                {c.status !== 'passed' && c.reason && (
                  <span
                    className="text-muted-foreground/70 ml-1 break-words"
                    title={c.reason}
                  >
                    — {c.reason}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Renderiza la lista de stories cuyo run FALLÓ — Claude crasheó / se quedó
 * sin tokens, o falló el clone del repo o el push del PR. Esas historias
 * quedan en estado 'blocked': NO se completaron y NO entran al merge a DEV.
 * Se monta DENTRO del PendingGateCard del staging gate para que el TechLead,
 * antes de aprobar, vea qué historias quedaron fuera.
 *
 * Importante (2026-05-21): el verificador del DoD es NO BLOQUEANTE. Una
 * historia con criterios técnicos sin cumplir NO aparece acá — su run
 * termina 'completed' (warn, no error) y la historia llega a 'done'. Acá
 * solo caen FALLOS DUROS de ejecución, no deuda técnica.
 *
 * Diseño visual:
 *  - Card amber (warning) — a nivel batch, una historia fallida es un
 *    "decidir antes de aprobar", no un sistema caído.
 *  - Por story: título + chip de estado + attempts + checklist DoD del run
 *    (si alcanzó a correr el verifier) + acciones para reintentar / abrir
 *    el terminal del run.
 *  - Si NO hay stories fallidas, el componente devuelve null (sprint limpio
 *    se ve sin ruido).
 */
function IncompleteStoriesAlert({
  stories,
  batchId,
  onStoryRetried,
}: {
  stories: BatchStoryDetail[];
  /** Batch (= enqueuedBatchId del epic) — necesario para el endpoint de retry. */
  batchId: string;
  /** Callback tras un retry exitoso — el padre dispara el refetch del batch. */
  onStoryRetried?: () => void;
}) {
  if (stories.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wide">
          {stories.length} {stories.length === 1 ? 'story' : 'stories'} sin completar
        </span>
      </div>
      <p className="text-xs text-amber-200/80 leading-relaxed mb-3">
        El run de estas stories <strong>terminó con error</strong> — Claude crasheó o se
        quedó sin tokens, o falló el clone del repo o el push del PR. <strong>No se
        completaron y no entran al merge a DEV.</strong> Reintenta cada una tras corregir
        la causa raíz, o aprueba el batch asumiendo la brecha.
      </p>

      <ul className="space-y-2.5">
        {stories.map((story) => {
          // Defensive: callsite filtra latestRun!=null pero el componente
          // acepta BatchStoryDetail[] genérico, así que callers futuros o
          // tests podrían pasar stories sin run. Saltamos en lugar de
          // crashear con non-null assertion (qa-reviewer 2026-05-19).
          if (!story.latestRun) return null;
          const run = story.latestRun;
          const isRegression = run.doomLoopKind === 'regression';
          const isStagnation = run.doomLoopKind === 'stagnation';

          return (
            <li
              key={story.id}
              className="rounded border border-amber-500/30 bg-card/50 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-foreground truncate">
                      {story.title}
                    </span>

                    {isRegression && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[9px] font-semibold uppercase text-red-300"
                        title="El agente rompió criterios DoD que antes pasaban — daño activo, abortó sin completar reintentos"
                      >
                        Regresión
                      </span>
                    )}
                    {isStagnation && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-300"
                        title="El agente quedó atorado en los mismos criterios fallidos sin avanzar entre attempts"
                      >
                        Estancamiento
                      </span>
                    )}
                    {!isRegression && !isStagnation && run.status === 'failed' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-[9px] font-semibold uppercase text-red-300">
                        Failed
                      </span>
                    )}

                    {typeof run.attempts === 'number' && run.attempts > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-card border border-border px-2 py-0.5 text-[9px] font-medium text-muted-foreground"
                        title={`El worker ejecutó ${run.attempts} attempt${run.attempts === 1 ? '' : 's'} del DoD enforcement loop antes de abortar`}
                      >
                        <RotateCw className="h-2.5 w-2.5" aria-hidden="true" />
                        {run.attempts} {run.attempts === 1 ? 'attempt' : 'attempts'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Acciones de la story: abrir Claude Code para trabajar la
                    deuda + reintentar (re-encola la story en el Forge). */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Abre la página del run en una tab nueva — su área de
                      terminal embebe un Claude Code NUEVO sobre la branch del
                      run (el ttyd del worker ya se cerró al terminar). Ahí el
                      operador trabaja la deuda técnica de esta story. Mismo
                      patrón window.open que el AgentCard del batch — tab nueva
                      para que el `window.close()` del terminal funcione. */}
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `/factory/agents/${run.id}/terminal`,
                        '_blank',
                        'noopener,noreferrer',
                      )
                    }
                    className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 hover:underline shrink-0"
                    title={`Abre Claude Code sobre ${run.branch} para trabajar la deuda de esta story`}
                  >
                    <SquareTerminal className="h-2.5 w-2.5" aria-hidden="true" />
                    Abrir Claude Code
                  </button>
                  {/* Reintenta la story — re-encola en el Forge tras corregir
                      la causa raíz del fallo. Confirmación explícita: gasta
                      tokens. */}
                  <RetryStoryButton
                    key={run.id}
                    batchId={batchId}
                    story={story}
                    onRetried={onStoryRetried}
                  />
                </div>
              </div>

              {/* Checklist DoD COMPLETA — todos los criterios con su
                  veredicto (✓ cumplido / ✗ no cumplido / − saltado). El
                  TechLead ve qué pasó y qué no, no solo los fallos. La data
                  viene de los verdicts del verifier (objetiva), no de un
                  auto-reporte del agente. */}
              {run.criteria && run.criteria.length > 0 ? (
                <DodChecklist criteria={run.criteria} />
              ) : (
                run.errorMessage && (
                  <p className="text-[10px] text-muted-foreground/70 leading-snug mt-1 break-words">
                    {run.errorMessage}
                  </p>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Secciones de la solución técnica (`definicion-tecnica.md`). El verifier
 * prefija el label de cada verdict `technical-design` con su sección
 * (`Checklist:`, `Contrato:`, …); agrupamos los criterios sin cumplir por
 * ese prefijo para que el TechLead vea de qué parte del diseño fue el fallo.
 */
const TL_CRITERION_GROUPS: ReadonlyArray<{ prefix: string; name: string }> = [
  { prefix: 'Checklist:', name: 'Checklist técnico' },
  { prefix: 'Contrato:', name: 'Contrato' },
  { prefix: 'Validación:', name: 'Validación' },
  { prefix: 'Errores:', name: 'Manejo de errores' },
];
/** Catch-all para los criterios del DoD sin prefijo de sección técnica. */
const GENERAL_CRITERION_GROUP = 'Criterios generales del DoD';

interface FailedCriterion {
  id: string;
  /** Label sin el prefijo de sección — el wrapper del grupo ya lo nombra. */
  label: string;
  /** Lo que el verifier detectó: por qué el criterio no se cumplió. */
  reason: string;
}
interface CriterionGroupData {
  name: string;
  items: FailedCriterion[];
}

/**
 * Filtra los criterios `failed` y los reparte por su sección de la solución
 * técnica. Orden fijo (las 4 secciones del TL, luego el general); devuelve
 * sólo los grupos con al menos un fallo.
 */
function groupFailedCriteria(
  criteria: NonNullable<BatchStoryDetail['latestRun']>['criteria'],
): CriterionGroupData[] {
  const failed = (criteria ?? []).filter((c) => c.status === 'failed');
  const result: CriterionGroupData[] = [
    ...TL_CRITERION_GROUPS.map((g) => ({
      name: g.name,
      items: [] as FailedCriterion[],
    })),
    { name: GENERAL_CRITERION_GROUP, items: [] as FailedCriterion[] },
  ];
  for (const c of failed) {
    const def = TL_CRITERION_GROUPS.find((d) => c.label.startsWith(d.prefix));
    // Strip del prefijo de sección — el wrapper del grupo ya lo nombra. Si el
    // label era SÓLO el prefijo (vault malformado → descripción vacía), el
    // strip deja '': caemos al label crudo para no renderar una fila vacía.
    const stripped = def
      ? c.label.slice(def.prefix.length).trim()
      : c.label;
    const label = stripped || c.label;
    const target = result.find(
      (g) => g.name === (def ? def.name : GENERAL_CRITERION_GROUP),
    );
    if (target) target.items.push({ id: c.id, label, reason: c.reason });
  }
  return result.filter((g) => g.items.length > 0);
}

/**
 * Wrapper colapsable de una sección de criterios sin cumplir. El TechLead
 * despliega/colapsa cada grupo por separado. Default abierto: el objetivo
 * del panel es que los fallos se vean de inmediato.
 */
function CriterionGroup({ group }: { group: CriterionGroupData }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded border border-amber-500/25 bg-amber-500/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown
            className="h-3 w-3 shrink-0 text-amber-400"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="h-3 w-3 shrink-0 text-amber-400"
            aria-hidden="true"
          />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          {group.name}
        </span>
        <span className="ml-auto inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-amber-300">
          {group.items.length}
        </span>
      </button>
      {open && (
        <ul className="space-y-2 px-2 pb-2">
          {group.items.map((item, idx) => (
            <li key={`${item.id}-${idx}`} className="flex items-start gap-1.5">
              <XCircle
                className="h-3 w-3 shrink-0 text-red-400 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[10px] font-medium leading-snug text-foreground break-words">
                  {item.label}
                </p>
                {item.reason && (
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/80 break-words">
                    <span className="font-medium text-amber-300/90">
                      Detectado:{' '}
                    </span>
                    {item.reason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Stories que el Forge COMPLETÓ e integró, pero cuyo verificador técnico
 * (el "TL review" — el verifier Sonnet sobre `definicion-tecnica.md`) marcó
 * criterios del DoD que el agente no cumplió por sí mismo.
 *
 * 2026-05-21 — el verificador del DoD es NO BLOQUEANTE: un criterio sin
 * cumplir es un WARN, no un error. La story igual completa, abre PR y entra
 * al merge consolidado. Este panel lista SOLO los criterios sin cumplir,
 * agrupados por su sección de la solución técnica en wrappers colapsables,
 * con el detalle de lo que el verifier detectó. Es informativo: NO bloquea
 * la aprobación (a diferencia de los fallos duros).
 */
function ForgeReviewAlert({ stories }: { stories: BatchStoryDetail[] }) {
  if (stories.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wide">
          Revisión técnica del Forge · {stories.length}{' '}
          {stories.length === 1 ? 'story con pendientes' : 'stories con pendientes'}
        </span>
      </div>
      <p className="text-xs text-amber-200/80 leading-relaxed mb-3">
        El Forge <strong>completó e integró</strong> estas stories, pero su
        verificador técnico marcó criterios del DoD que{' '}
        <strong>no pudo cumplir por sí mismo</strong>. El merge a DEV no se
        bloquea — abajo, sólo los criterios sin cumplir, agrupados por su
        sección de la solución técnica.
      </p>

      <ul className="space-y-2.5">
        {stories.map((story) => {
          // Defensive: el callsite filtra latestRun!=null, pero el componente
          // acepta BatchStoryDetail[] genérico — saltamos en vez de crashear.
          if (!story.latestRun) return null;
          const run = story.latestRun;
          const groups = groupFailedCriteria(run.criteria);
          // El filtro `warnStories` garantiza ≥1 criterio failed; si aun así
          // no quedan grupos (data corrupta), saltamos — sin card vacía.
          if (groups.length === 0) return null;
          const failedCount = groups.reduce((n, g) => n + g.items.length, 0);

          return (
            <li
              key={story.id}
              className="rounded border border-amber-500/30 bg-card/50 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    {story.title}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {failedCount}{' '}
                    {failedCount === 1
                      ? 'criterio sin cumplir'
                      : 'criterios sin cumplir'}
                  </p>
                </div>
                {/* Abre Claude Code sobre la branch del run para inspeccionar
                    o completar manualmente lo que el Forge dejó pendiente. */}
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `/factory/agents/${run.id}/terminal`,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                  className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 hover:underline shrink-0"
                  title={`Abre Claude Code sobre ${run.branch} para inspeccionar esta story`}
                >
                  <SquareTerminal className="h-2.5 w-2.5" aria-hidden="true" />
                  Abrir Claude Code
                </button>
              </div>
              <div className="space-y-1.5">
                {groups.map((g) => (
                  <CriterionGroup key={g.name} group={g} />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PendingGateCard({
  gate,
  batchBranch,
  onDecision,
  incompleteStories = [],
  warnStories = [],
  batchId,
  onStoryRetried,
}: {
  gate: HumanGate;
  batchBranch: string;
  onDecision: (gateId: string, decision: GateDecision, notes: string) => void;
  /** Stories cuyo run terminó en fallo DURO (Claude crasheó / sin tokens, o
   *  falló el clone del repo o el push del PR). Quedan 'blocked', NO entran
   *  al merge consolidado a DEV. El TechLead las ve antes de aprobar. */
  incompleteStories?: BatchStoryDetail[];
  /** Stories que COMPLETARON y entran al merge, pero el verificador del DoD
   *  (no bloqueante) marcó criterios técnicos sin cumplir. Informativo. */
  warnStories?: BatchStoryDetail[];
  /** Batch — propagado a IncompleteStoriesAlert para el endpoint de retry. */
  batchId: string;
  /** Callback tras un retry exitoso de una story con deuda. */
  onStoryRetried?: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  // Staging gate dispara dialog de step-up auth con password — solo TechLead
  // puede aprobar. Release gate (futuro) puede tener su propio flow.
  const [stagingDialogOpen, setStagingDialogOpen] = useState(false);
  // Confirmación explícita de deuda: cuando el batch lleva stories con deuda
  // técnica a DEV, el TechLead debe reconocerlo ANTES de poder aprobar. Sin
  // esto, "Approve & Merge" queda deshabilitado.
  const [acceptedIncomplete, setAcceptedIncomplete] = useState(false);
  const hasIncompleteStories = incompleteStories.length > 0;
  const approveBlocked = hasIncompleteStories && !acceptedIncomplete;
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

      {/* Stories con fallo duro — Claude crasheó / sin tokens / clone / push.
          Listadas ANTES del card de decisión para que el TechLead las vea. */}
      <IncompleteStoriesAlert
        stories={incompleteStories}
        batchId={batchId}
        onStoryRetried={onStoryRetried}
      />

      {/* Revisión técnica del Forge — stories COMPLETADAS cuyo verificador
          DoD marcó criterios sin cumplir. Informativo, NO bloquea el gate. */}
      <ForgeReviewAlert stories={warnStories} />

      {/* Card único de decisión: el PR consolidado, el reconocimiento de
          deuda (si aplica), las notas y los botones — todo en un solo
          contenedor para que la acción del gate se lea como una unidad. */}
      <div className="rounded-lg border border-border bg-card p-4">
        {/* Consolidated PR */}
        <div className="flex items-center gap-2 mb-1.5">
          <GitBranch className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-[11px] font-medium text-muted-foreground">
            Consolidated PR
          </span>
        </div>
        <p className="font-mono text-xs text-foreground">{batchBranch} → DEV</p>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground/70">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Requested {formatGateTimestamp(gate.requestedAt)}
        </div>

        {/* Divisor: separa el contexto del PR de la zona de decisión sin
            partirlos en dos cards. */}
        <div className="my-3 border-t border-border" />

        {/* Confirmación obligatoria de deuda. Solo aparece si el batch lleva
            stories con fallo duro — el TechLead debe reconocer que esa deuda
            va a DEV antes de que "Approve & Merge" se habilite. */}
        {hasIncompleteStories && (
          <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 mb-3 cursor-pointer">
            {/* RoundCheckbox redondo. `[&_svg]:hidden` oculta el checkmark —
                marcado = círculo azul sólido. El estado se lee por el fill. */}
            <RoundCheckbox
              checked={acceptedIncomplete}
              onCheckedChange={(v) => setAcceptedIncomplete(v === true)}
              className="mt-0.5 [&_svg]:hidden"
              aria-label="Acepto mergear a DEV con stories que llevan deuda técnica"
            />
            <span className="text-xs text-amber-200/90 leading-relaxed">
              Acepto mergear a DEV{' '}
              <strong>
                {incompleteStories.length}{' '}
                {incompleteStories.length === 1 ? 'story' : 'stories'} con deuda
                técnica
              </strong>
              . Los criterios DoD pendientes se resolverán en la etapa de
              staging.
            </span>
          </label>
        )}

        {/* Review Notes */}
        <label className="block mb-3">
          <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Review Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Review notes — describe business intent concerns, UX issues, or strategic misalignment..."
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 resize-none"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            disabled={approveBlocked}
            title={
              approveBlocked
                ? 'Marca la casilla de confirmación para aprobar el merge con deuda técnica'
                : undefined
            }
            onClick={() => {
              // Defensa: el disabled ya previene el click, pero guard explícito
              // por si el atributo se evade (DevTools, etc.).
              if (approveBlocked) return;
              // Staging gate: requiere step-up auth con password + role TechLead.
              // Abrimos el dialog en vez de dispatchar directo. El onApproved
              // callback del dialog (más abajo) dispara onDecision para que el
              // state local mueva el batch a Staged.
              if (gate.type === 'staging') {
                setStagingDialogOpen(true);
                return;
              }
              // Release gate u otros: dispatch directo por ahora (no implementado).
              onDecision(gate.id, GateDecision.Approved, notes);
            }}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
              approveBlocked
                ? 'bg-muted border-border text-muted-foreground/50 cursor-not-allowed'
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25',
            )}
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

      {/* Dialog de step-up auth para staging gate. Solo se renderea cuando
          gate.type === 'staging' y el user clickeó Approve. El backend valida
          password + role TechLead + mergea PR a DEV. El callback onApproved
          dispara onDecision para que el state local mueva el batch a Staged. */}
      {gate.type === 'staging' && (
        <StagingGateApprovalDialog
          open={stagingDialogOpen}
          onOpenChange={setStagingDialogOpen}
          batchId={gate.batchId}
          initialNotes={notes}
          onApproved={() => {
            // Dispatch local — el reducer cambia currentLayer a Staging y
            // mueve el batch a la columna Staged del Pipeline Board. El
            // próximo poll de listQueue verá `stagingApprovedAt` persistido
            // en DB y confirmará el state.
            onDecision(gate.id, GateDecision.Approved, notes);
          }}
        />
      )}
    </div>
  );
}

function ApprovalSection({
  gates,
  batchBranch,
  onDecision,
  incompleteStories = [],
  warnStories = [],
  batchId,
  onStoryRetried,
}: {
  gates: HumanGate[];
  batchBranch: string;
  onDecision: (gateId: string, decision: GateDecision, notes: string) => void;
  /** Stories con fallo duro — propagado a PendingGateCard. */
  incompleteStories?: BatchStoryDetail[];
  /** Stories completadas con warns del DoD — propagado a PendingGateCard. */
  warnStories?: BatchStoryDetail[];
  /** Batch — propagado hasta el botón de retry de cada story con deuda. */
  batchId: string;
  /** Callback tras un retry exitoso — dispara el refetch del batch. */
  onStoryRetried?: () => void;
}) {
  if (gates.length === 0) return null;

  const pendingGates = gates.filter((g) => g.decision === GateDecision.Pending);
  const resolvedGates = gates.filter((g) => g.decision !== GateDecision.Pending);

  return (
    <section aria-label="Human Gate Approvals" className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10" aria-hidden="true">
          <ShieldAlert className="h-3.5 w-3.5 text-cyan-400" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Human Gate Approvals</h2>
        {pendingGates.length > 0 && (
          <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 animate-pulse">
            Pending
          </span>
        )}
      </div>

      <div className="space-y-3">
        {pendingGates.map((gate) => (
          <PendingGateCard
            key={gate.id}
            gate={gate}
            batchBranch={batchBranch}
            onDecision={onDecision}
            incompleteStories={incompleteStories}
            warnStories={warnStories}
            batchId={batchId}
            onStoryRetried={onStoryRetried}
          />
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
              {batch.branchUrl ? (
                <a
                  href={batch.branchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                >
                  {batch.branch}
                </a>
              ) : (
                <span
                  className="font-mono text-[11px] text-muted-foreground/70"
                  title="La branch aún no existe en remote — se creará cuando el repo del Forge esté disponible o el primer agente pushee."
                >
                  {batch.branch}
                </span>
              )}
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
                {epic.markdown && epic.markdown.trim().length > 0 && (
                  <div>
                    <span className="text-[10px] text-muted-foreground/60 uppercase block mb-1">Definición</span>
                    <p className="text-xs text-foreground/90 leading-relaxed line-clamp-6 whitespace-pre-line">{epic.markdown}</p>
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
  /**
   * Si está set, sobrescribe los datos del state mock con datos REALES
   * del backend (endpoint `/factory/queue/:batchId/detail`). El layout y
   * el styling del componente se preservan 100% — solo cambia la fuente
   * de datos. Cuando NO se pasa, el componente sigue funcionando con los
   * mocks de FactoryContext (compatibilidad con callers legacy).
   */
  realBatchData?: BatchDetailResponse;
  /**
   * Callback que dispara un re-fetch del batch detail. Lo invocamos tras
   * acciones que cambian state persistido en backend (ej. staging gate
   * approval) para que el UI refleje el nuevo estado al instante sin
   * esperar al siguiente polling tick. Si no se provee, el caller depende
   * del polling para refrescar.
   */
  onRefetchRequested?: () => void;
}

export function BatchDetail({ batchId, realBatchData, onRefetchRequested }: BatchDetailProps) {
  const { state, dispatch, computed } = useFactory();
  // Use mock data directly — factory pages are outside ProyectosProvider
  const proyectosEpics = mockEpics;
  const proyectosInitiatives = mockInitiatives;

  const handleGateDecision = useCallback((gateId: string, decision: GateDecision, notes: string) => {
    // Para el flow REAL (realBatchData), el backend ya persistió el approval
    // y el state debe venir del próximo fetch. Disparamos el refetch ahora
    // para que el cambio se vea inmediato — sin esperar 5s del polling.
    if (realBatchData) {
      onRefetchRequested?.();
      return;
    }
    // Legacy mock flow: actualizamos el state local porque no hay backend.
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
  }, [realBatchData, onRefetchRequested, state.gates, state.factory, dispatch]);

  // Cuando `realBatchData` está set, derivamos batch + stories + agents +
  // gates desde el response REAL del backend. Sino, fallback al state mock
  // de FactoryContext (compatibilidad con uso legacy).
  const batch = useMemo<SprintBatch | null>(() => {
    if (realBatchData) {
      return mapBatchDetailToSprintBatch(realBatchData);
    }
    return state.factory.activeBatches.find((b) => b.id === batchId) ?? null;
  }, [realBatchData, state.factory.activeBatches, batchId]);

  // Get the full batch with waves from currentBatch if it matches, otherwise use activeBatches entry
  const fullBatch = useMemo<SprintBatch | null>(() => {
    if (realBatchData) return batch; // real data ya viene completo
    if (state.factory.currentBatch?.id === batchId) {
      return state.factory.currentBatch;
    }
    return batch;
  }, [realBatchData, state.factory.currentBatch, batch, batchId]);

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
    if (realBatchData) {
      // Stories ya vienen embebidas en el SprintBatch sintético
      return fullBatch?.stories ?? [];
    }
    if (batchStoryIds.size === 0) return state.stories;
    return state.stories.filter((s) => batchStoryIds.has(s.id));
  }, [realBatchData, fullBatch, state.stories, batchStoryIds]);

  // Filter agents that are working on stories in this batch
  const batchAgents = useMemo<FactoryAgent[]>(() => {
    if (realBatchData) {
      // Derivamos agents sintéticos desde latestRun de cada story
      return mapBatchDetailToAgents(realBatchData);
    }
    const storyIdSet = new Set(batchStories.map((s) => s.id));
    return state.agents.filter((a) => a.storyId !== null && storyIdSet.has(a.storyId));
  }, [realBatchData, state.agents, batchStories]);

  // RunDrawerDetail por storyId — datos reales del run para el
  // AgentDetailDrawer que abre AgentList. Vacío en mock mode (sin
  // realBatchData) → el drawer cae a mock mode, consistente con el batch.
  const runDetailByStory = useMemo<Map<string, RunDrawerDetail>>(() => {
    const map = new Map<string, RunDrawerDetail>();
    if (!realBatchData) return map;
    for (const s of realBatchData.stories) {
      const detail = buildRunDrawerDetail(
        s,
        realBatchData.epicId,
        realBatchData.epicTitle,
        realBatchData.stories,
      );
      if (detail) map.set(s.id, detail);
    }
    return map;
  }, [realBatchData]);

  // Filter human gates belonging to this batch.
  // Release gate only shows after staging gate is approved (sequential approval flow).
  const batchGates = useMemo<HumanGate[]>(() => {
    if (realBatchData) {
      return mapBatchDetailToGates(realBatchData);
    }
    const all = state.gates.filter((g) => g.batchId === batchId);
    const stagingGate = all.find((g) => g.type === 'staging');
    const stagingApproved = stagingGate?.decision === GateDecision.Approved;
    return all.filter((g) => {
      if (g.type === 'release' && !stagingApproved) return false;
      return true;
    });
  }, [realBatchData, state.gates, batchId]);

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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Izquierda: identidad (back + título) + estado del pipeline.
              Los pills viven acá —no flotando a la derecha— para que el estado
              quede junto a la identidad de la épica y llenen el header en vez
              de dejar un vacío central. */}
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/factory"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted transition-colors"
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
            {/* Divisor sutil identidad │ estado — solo cuando el header es fila. */}
            <div className="hidden h-9 w-px shrink-0 bg-border/70 lg:block" aria-hidden="true" />
            <PipelinePills currentLayer={fullBatch.currentLayer} />
          </div>

          {/* Derecha: acciones — botón de preview + indicador de branch.
              Spawnea local dev server (clone + pnpm dev / npx serve) y abre la
              URL en otra tab. Disabled cuando no hay branch aún (pre-push). */}
          <div className="flex shrink-0 items-center gap-2.5">
            <BatchPreviewButton
              batchId={fullBatch.id}
              disabled={!fullBatch.branchUrl}
            />
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
              {fullBatch.branchUrl ? (
                <a
                  href={fullBatch.branchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                >
                  {fullBatch.branch}
                </a>
              ) : (
                <span
                  className="font-mono text-xs text-muted-foreground/70"
                  title="La branch aún no existe en GitHub — se creará al recibir el primer push del Forge o cuando el repo se active."
                >
                  {fullBatch.branch}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ---- Metrics ---- */}
      <MetricsCards
        batch={fullBatch}
        stories={batchStories}
        agents={batchAgents}
      />

      {/* ---- Pipeline ---- */}

      {/* ---- Human Gate Approvals ---- */}
      {/* incompleteStories: filtramos las stories del raw backend data cuyo
          latestRun terminó en failed o con criterios DoD pendientes. Estas
          NO van al merge consolidado a DEV — el TechLead las ve dentro del
          PendingGateCard para tomar decisión informada. */}
      <ApprovalSection
        gates={batchGates}
        batchBranch={fullBatch.branch}
        onDecision={handleGateDecision}
        batchId={batchId}
        onStoryRetried={onRefetchRequested}
        incompleteStories={
          realBatchData?.stories.filter((s) => {
            if (s.latestRun == null) return false;
            // Excluir 'completed' explícitamente: un run con forceCompletion
            // puede tener criterios failed pero su PR YA entra al consolidated.
            // Decir al TechLead "no entra al merge" para un completed sería
            // engañoso (qa-reviewer 2026-05-19, Finding #6).
            if (s.latestRun.status === 'completed') return false;
            return (
              s.latestRun.status === 'failed' ||
              (s.latestRun.criteria?.some((c) => c.status === 'failed') ?? false)
            );
          }) ?? []
        }
        warnStories={
          // Stories que COMPLETARON y llegaron a 'done' (entran al merge
          // consolidado) pero cuyo verificador del DoD —no bloqueante— marcó
          // criterios técnicos sin cumplir. El gate `s.status === 'done'`
          // descarta el caso raro "run completed pero story atascada" (la
          // creación del PR falló): esa no integró, no debe decir que sí.
          // Disjunto de incompleteStories: aquél exige run status != 'completed'.
          realBatchData?.stories.filter(
            (s) =>
              s.latestRun != null &&
              s.latestRun.status === 'completed' &&
              s.status === 'done' &&
              (s.latestRun.criteria?.some((c) => c.status === 'failed') ??
                false),
          ) ?? []
        }
      />

      {/* ---- Wave DAG ---- */}
      <WaveDAG
        stories={batchStories}
        batchName={fullBatch.epicTitle}
        batchBranch={fullBatch.branch}
        batchWaves={fullBatch.waves.map((w) => ({ number: w.number, status: String(w.status) }))}
      />

      {/* ---- Agents ---- */}
      <AgentList
        agents={batchAgents}
        stories={batchStories}
        batch={fullBatch}
        runDetailByStory={runDetailByStory}
      />

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
