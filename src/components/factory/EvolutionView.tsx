'use client';

import { useMemo } from 'react';
import {
  Dna,
  TrendingDown,
  TrendingUp,
  RotateCcw,
  DollarSign,
  FlaskConical,
  History,
  Tag,
  Calendar,
  FileCode,
  Hash,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { PromptVersion, BatchMetrics } from '@/types/factory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

type TrendDirection = 'improving' | 'worsening' | 'neutral';

function trend(current: number, previous: number, lowerIsBetter: boolean): TrendDirection {
  if (Math.abs(current - previous) < 0.001) return 'neutral';
  const decreased = current < previous;
  return (decreased && lowerIsBetter) || (!decreased && !lowerIsBetter)
    ? 'improving'
    : 'worsening';
}

function trendColor(dir: TrendDirection): string {
  if (dir === 'improving') return 'text-emerald-400';
  if (dir === 'worsening') return 'text-red-400';
  return 'text-[#8B8B9A]';
}

function trendBg(dir: TrendDirection): string {
  if (dir === 'improving') return 'bg-emerald-500/10 border-emerald-500/20';
  if (dir === 'worsening') return 'bg-red-500/10 border-red-500/20';
  return 'bg-[#2A2A35]/30 border-[#2A2A35]';
}

function TrendArrow({ direction }: { direction: TrendDirection }) {
  if (direction === 'neutral') return null;
  const Icon = direction === 'improving' ? TrendingDown : TrendingUp;
  return (
    <Icon
      className={cn('h-4 w-4', trendColor(direction))}
      aria-label={direction === 'improving' ? 'Improving' : 'Worsening'}
    />
  );
}

function delta(current: number, previous: number): string {
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)}`;
}

function deltaPct(current: number, previous: number): string {
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${(diff * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CurrentVersionCard({ version }: { version: PromptVersion }) {
  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
          <Tag className="h-4 w-4 text-violet-400" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#EDEDF0]">Current Prompt Version</h3>
          <p className="text-xs text-[#8B8B9A]">Active across all forge agents</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-mono font-semibold text-violet-400">
          {version.version}
        </span>
      </div>
      <div className="rounded-lg bg-[#0A0A0F] border border-[#2A2A35] px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-[#8B8B9A] mb-2">
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{formatDate(version.createdAt)}</span>
        </div>
        <p className="text-sm text-[#EDEDF0] leading-relaxed">{version.changes}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  icon: Icon,
  currentValue,
  previousValue,
  formatter,
  lowerIsBetter,
}: {
  label: string;
  icon: typeof DollarSign;
  currentValue: number;
  previousValue: number;
  formatter: (v: number) => string;
  lowerIsBetter: boolean;
}) {
  const dir = trend(currentValue, previousValue, lowerIsBetter);
  const diff =
    formatter === formatPct
      ? deltaPct(currentValue, previousValue)
      : delta(currentValue, previousValue);

  return (
    <div className={cn('rounded-xl border p-4 transition-colors', 'bg-[#141419]', trendBg(dir))}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-[#8B8B9A]" aria-hidden="true" />
        <span className="text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className={cn('text-2xl font-bold font-mono', trendColor(dir))}>
            {formatter(currentValue)}
          </p>
          <p className="text-xs text-[#8B8B9A] mt-1">
            prev: {formatter(previousValue)}
            <span className={cn('ml-1.5 font-mono', trendColor(dir))}>{diff}</span>
          </p>
        </div>
        <TrendArrow direction={dir} />
      </div>
    </div>
  );
}

function BatchHistoryTable({ batches }: { batches: BatchMetrics[] }) {
  if (batches.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#2A2A35]">
        <History className="h-4 w-4 text-[#8B8B9A]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[#EDEDF0]">Batch History</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table" aria-label="Batch execution history">
          <thead>
            <tr className="border-b border-[#2A2A35] bg-[#0A0A0F]/50">
              <th scope="col" className="text-left px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Batch
              </th>
              <th scope="col" className="text-left px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Prompt
              </th>
              <th scope="col" className="text-center px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Stories
              </th>
              <th scope="col" className="text-left px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Completed
              </th>
              <th scope="col" className="text-right px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Cost
              </th>
              <th scope="col" className="text-right px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Rej. Rate
              </th>
              <th scope="col" className="text-right px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Avg Retries
              </th>
              <th scope="col" className="text-right px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Avg Duration
              </th>
              <th scope="col" className="text-right px-4 py-3 text-xs font-medium text-[#8B8B9A] uppercase tracking-wider">
                Test Pass
              </th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch, idx) => {
              const prev = batches[idx + 1];
              const rejTrend = prev ? trend(batch.rejectionRate, prev.rejectionRate, true) : 'neutral' as TrendDirection;
              const costTrend = prev ? trend(batch.totalCost / batch.stories, prev.totalCost / prev.stories, true) : 'neutral' as TrendDirection;
              const retryTrend = prev ? trend(batch.avgRetries, prev.avgRetries, true) : 'neutral' as TrendDirection;
              const durTrend = prev ? trend(batch.avgDuration, prev.avgDuration, true) : 'neutral' as TrendDirection;
              const testTrend = prev ? trend(batch.testPassRate, prev.testPassRate, false) : 'neutral' as TrendDirection;

              return (
                <tr
                  key={batch.batchId}
                  className={cn(
                    'border-b border-[#2A2A35]/50 transition-colors hover:bg-[#0A0A0F]/40',
                    idx === 0 && 'bg-[#0A0A0F]/20',
                  )}
                >
                  <td className="px-4 py-3">
                    <span className="text-[#EDEDF0] font-medium">{batch.batchName}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5">
                      {batch.promptVersion}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[#EDEDF0] font-mono">{batch.stories}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[#8B8B9A] text-xs">{formatDate(batch.completedAt)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-mono', trendColor(costTrend))}>
                      {formatCost(batch.totalCost)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-mono', trendColor(rejTrend))}>
                      {formatPct(batch.rejectionRate)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-mono', trendColor(retryTrend))}>
                      {batch.avgRetries.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-mono', trendColor(durTrend))}>
                      {batch.avgDuration}m
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-mono', trendColor(testTrend))}>
                      {formatPct(batch.testPassRate)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PromptVersionHistory({ versions }: { versions: PromptVersion[] }) {
  if (versions.length <= 1) return null;

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
      <div className="flex items-center gap-3 mb-4">
        <FileCode className="h-4 w-4 text-[#8B8B9A]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[#EDEDF0]">Prompt Version History</h3>
      </div>

      <div className="space-y-0">
        {versions.map((v, idx) => {
          const prev = versions[idx + 1];
          const isCurrent = idx === 0;
          const rejDir = prev ? trend(v.rejectionRate, prev.rejectionRate, true) : 'neutral' as TrendDirection;
          const retryDir = prev ? trend(v.avgRetries, prev.avgRetries, true) : 'neutral' as TrendDirection;
          const costDir = prev ? trend(v.avgCostPerStory, prev.avgCostPerStory, true) : 'neutral' as TrendDirection;

          return (
            <div key={v.version} className="relative flex gap-4">
              {/* Timeline connector */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'h-3 w-3 rounded-full border-2 mt-1.5 shrink-0',
                    isCurrent
                      ? 'border-violet-400 bg-violet-400'
                      : 'border-[#2A2A35] bg-[#0A0A0F]',
                  )}
                  aria-hidden="true"
                />
                {idx < versions.length - 1 && (
                  <div className="w-px flex-1 bg-[#2A2A35]" aria-hidden="true" />
                )}
              </div>

              {/* Content */}
              <div className={cn('pb-6 flex-1', idx === versions.length - 1 && 'pb-0')}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className={cn(
                      'font-mono text-sm font-semibold',
                      isCurrent ? 'text-violet-400' : 'text-[#EDEDF0]',
                    )}
                  >
                    {v.version}
                  </span>
                  <span className="text-xs text-[#8B8B9A]">{formatDate(v.createdAt)}</span>
                  {isCurrent && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-2 py-0.5">
                      current
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#8B8B9A] leading-relaxed mb-2">{v.changes}</p>

                {/* Metrics row */}
                <div className="flex gap-4 text-xs flex-wrap">
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3 text-[#8B8B9A]" aria-hidden="true" />
                    <span className="text-[#8B8B9A]">Rej:</span>
                    <span className={cn('font-mono font-medium', trendColor(rejDir))}>
                      {formatPct(v.rejectionRate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <RotateCcw className="h-3 w-3 text-[#8B8B9A]" aria-hidden="true" />
                    <span className="text-[#8B8B9A]">Retries:</span>
                    <span className={cn('font-mono font-medium', trendColor(retryDir))}>
                      {v.avgRetries.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3 text-[#8B8B9A]" aria-hidden="true" />
                    <span className="text-[#8B8B9A]">Cost/story:</span>
                    <span className={cn('font-mono font-medium', trendColor(costDir))}>
                      {formatCost(v.avgCostPerStory)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function EvolutionView() {
  const { state } = useFactory();
  const { evolution } = state;

  const currentVersion = useMemo(() => {
    return evolution.previousVersions.find(
      (v) => v.version === evolution.currentPromptVersion,
    );
  }, [evolution]);

  const previousVersion = useMemo(() => {
    const idx = evolution.previousVersions.findIndex(
      (v) => v.version === evolution.currentPromptVersion,
    );
    return idx >= 0 && idx < evolution.previousVersions.length - 1
      ? evolution.previousVersions[idx + 1]
      : null;
  }, [evolution]);

  if (!currentVersion) {
    return (
      <div className="rounded-xl border border-[#2A2A35] bg-[#141419] p-8 text-center">
        <Dna className="h-8 w-8 text-[#8B8B9A] mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-[#8B8B9A]">No evolution data available.</p>
      </div>
    );
  }

  return (
    <section aria-label="Self-Evolution Metrics" className="space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10" aria-hidden="true">
          <Dna className="h-4 w-4 text-violet-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[#EDEDF0]">Self-Evolution</h2>
          <p className="text-xs text-[#8B8B9A]">
            Factory prompt performance over time
          </p>
        </div>
      </div>

      {/* Current version card */}
      <CurrentVersionCard version={currentVersion} />

      {/* Key metrics */}
      {previousVersion && (
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Rejection Rate"
            icon={FlaskConical}
            currentValue={currentVersion.rejectionRate}
            previousValue={previousVersion.rejectionRate}
            formatter={formatPct}
            lowerIsBetter={true}
          />
          <MetricCard
            label="Avg Retries / Story"
            icon={RotateCcw}
            currentValue={currentVersion.avgRetries}
            previousValue={previousVersion.avgRetries}
            formatter={(v) => v.toFixed(1)}
            lowerIsBetter={true}
          />
          <MetricCard
            label="Avg Cost / Story"
            icon={DollarSign}
            currentValue={currentVersion.avgCostPerStory}
            previousValue={previousVersion.avgCostPerStory}
            formatter={formatCost}
            lowerIsBetter={true}
          />
        </div>
      )}

      {/* Batch history table */}
      <BatchHistoryTable batches={evolution.batchHistory} />

      {/* Prompt version timeline */}
      <PromptVersionHistory versions={evolution.previousVersions} />
    </section>
  );
}
