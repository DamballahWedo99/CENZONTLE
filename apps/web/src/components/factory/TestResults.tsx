'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { TestSuite, TestResult } from '@cenzontle/shared';
import { TestCategory } from '@cenzontle/shared';
import {
  FlaskConical,
  Layers,
  Monitor,
  Gauge,
  Clock,
  ShieldCheck,
} from 'lucide-react';

// -- Constants ---------------------------------------------------------------

const categoryMeta: Record<
  TestCategory,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  unit: { label: 'Unit Tests', icon: FlaskConical },
  integration: { label: 'Integration Tests', icon: Layers },
  e2e: { label: 'E2E Tests', icon: Monitor },
  performance: { label: 'Performance Tests', icon: Gauge },
};

const resultConfig: Record<
  TestResult,
  { label: string; dot: string; textClass: string }
> = {
  pending: {
    label: 'Pending',
    dot: 'bg-[#8B8B9A]',
    textClass: 'text-muted-foreground',
  },
  running: {
    label: 'Running',
    dot: 'bg-blue-400 animate-pulse',
    textClass: 'text-blue-400',
  },
  passed: {
    label: 'Passed',
    dot: 'bg-emerald-400',
    textClass: 'text-emerald-400',
  },
  failed: {
    label: 'Failed',
    dot: 'bg-red-400',
    textClass: 'text-red-400',
  },
  skipped: {
    label: 'Skipped',
    dot: 'bg-[#8B8B9A]',
    textClass: 'text-muted-foreground italic',
  },
};

// -- Derived data helpers ----------------------------------------------------

interface CategorySummary {
  category: TestCategory;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

function buildSummaries(tests: TestSuite[]): CategorySummary[] {
  const categories: TestCategory[] = [TestCategory.Unit, TestCategory.Integration, TestCategory.E2E, TestCategory.Performance];
  return categories.map((cat) => {
    const suites = tests.filter((t) => t.category === cat);
    const total = suites.reduce((s, t) => s + t.total, 0);
    const passed = suites.reduce((s, t) => s + t.passed, 0);
    const failed = suites.reduce((s, t) => s + t.failed, 0);
    const passRate = total > 0 ? (passed / total) * 100 : 0;
    return { category: cat, total, passed, failed, passRate };
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remainder = s % 60;
  return `${m}m ${remainder.toFixed(0)}s`;
}

// -- Sub-components ----------------------------------------------------------

function SummaryCard({ summary }: { summary: CategorySummary }) {
  const meta = categoryMeta[summary.category];
  const Icon = meta.icon;
  const rateColor =
    summary.passRate >= 90
      ? 'text-emerald-400'
      : summary.passRate >= 70
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">
            {summary.passed}
            <span className="text-sm text-muted-foreground font-normal">/{summary.total}</span>
          </div>
          {summary.failed > 0 && (
            <span className="text-[11px] text-red-400 tabular-nums">
              {summary.failed} failed
            </span>
          )}
        </div>
        <span className={cn('text-lg font-semibold tabular-nums', rateColor)}>
          {summary.total > 0 ? `${summary.passRate.toFixed(0)}%` : '--'}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-[#2A2A35] overflow-hidden" role="progressbar" aria-valuenow={summary.passRate} aria-valuemin={0} aria-valuemax={100} aria-label={`${meta.label} pass rate`}>
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            summary.passRate >= 90
              ? 'bg-emerald-500'
              : summary.passRate >= 70
                ? 'bg-amber-500'
                : 'bg-red-500',
          )}
          style={{ width: `${Math.min(summary.passRate, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ResultBadge({ result }: { result: TestResult }) {
  const cfg = resultConfig[result];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', cfg.textClass)}>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function SuiteRow({ suite }: { suite: TestSuite }) {
  const meta = categoryMeta[suite.category];
  return (
    <tr className="border-b border-border hover:bg-muted transition-colors">
      {/* Category */}
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <meta.icon className="h-3 w-3" />
          {meta.label}
        </span>
      </td>

      {/* Name */}
      <td className="px-3 py-2.5 text-sm text-foreground max-w-[280px] truncate">
        {suite.name}
      </td>

      {/* Result */}
      <td className="px-3 py-2.5">
        <ResultBadge result={suite.result} />
      </td>

      {/* Passed / Total */}
      <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground text-center">
        <span className="text-emerald-400">{suite.passed}</span>
        <span className="mx-0.5">/</span>
        <span>{suite.total}</span>
      </td>

      {/* Duration */}
      <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground text-right">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(suite.duration)}
        </span>
      </td>

      {/* Coverage */}
      <td className="px-3 py-2.5 text-xs tabular-nums text-right">
        {suite.coverage != null ? (
          <span
            className={cn(
              suite.coverage >= 80
                ? 'text-emerald-400'
                : suite.coverage >= 60
                  ? 'text-amber-400'
                  : 'text-red-400',
            )}
          >
            {suite.coverage.toFixed(0)}%
          </span>
        ) : (
          <span className="text-muted-foreground/50">--</span>
        )}
      </td>
    </tr>
  );
}

// -- Main Component ----------------------------------------------------------

export function TestResults() {
  const { state } = useFactory();
  const tests = state.tests;

  const summaries = useMemo(() => buildSummaries(tests), [tests]);

  const sorted = useMemo(
    () =>
      [...tests].sort((a, b) => {
        const order: Record<TestResult, number> = {
          failed: 0,
          running: 1,
          pending: 2,
          passed: 3,
          skipped: 4,
        };
        return order[a.result] - order[b.result];
      }),
    [tests],
  );

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {summaries.map((s) => (
          <SummaryCard key={s.category} summary={s} />
        ))}
      </div>

      {/* Test suite table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Test Suites</h2>
          <span className="inline-flex items-center justify-center rounded-full bg-[#2A2A35] px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            {tests.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left" role="grid" aria-label="Test suite results">
            <thead>
              <tr className="border-b border-border bg-background">
                <th scope="col" className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Category
                </th>
                <th scope="col" className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Suite
                </th>
                <th scope="col" className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Result
                </th>
                <th scope="col" className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-center">
                  Passed
                </th>
                <th scope="col" className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                  Duration
                </th>
                <th scope="col" className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No test results available.
                  </td>
                </tr>
              ) : (
                sorted.map((suite) => <SuiteRow key={suite.id} suite={suite} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
