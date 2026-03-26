'use client';

import { useState, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Pause,
  User,
  FileText,
  Activity,
  BarChart3,
  Server,
  Bug,
  Zap,
  MemoryStick,
  Gauge,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useFactory } from '@/context/FactoryContext';
import type { HumanGate, QAReport, TestSuite, LogAnalysis } from '@cenzontle/shared';
import { GateDecision } from '@cenzontle/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCENT_PINK = '#EC4899';

const DECISION_CONFIG: Record<
  GateDecision,
  { label: string; color: string; bg: string; border: string; icon: typeof CheckCircle2 }
> = {
  [GateDecision.Pending]: {
    label: 'Pending',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/30',
    icon: Clock,
  },
  [GateDecision.Approved]: {
    label: 'Approved',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: CheckCircle2,
  },
  [GateDecision.Rejected]: {
    label: 'Rejected',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: XCircle,
  },
  [GateDecision.Deferred]: {
    label: 'Deferred',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: Pause,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function testRatio(suite: TestSuite): string {
  return `${suite.passed}/${suite.total}`;
}

function testColor(suite: TestSuite): string {
  if (suite.failed === 0) return 'text-emerald-400';
  if (suite.failed <= 2) return 'text-amber-400';
  return 'text-red-400';
}

function anomalyColor(score: number): string {
  if (score <= 20) return 'text-emerald-400';
  if (score <= 50) return 'text-amber-400';
  return 'text-red-400';
}

function confidenceColor(score: number): string {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-400';
  return 'text-red-400';
}

function confidenceBg(score: number): string {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 70) return 'bg-amber-500';
  return 'bg-red-500';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DecisionBadge({ decision }: { decision: GateDecision }) {
  const cfg = DECISION_CONFIG[decision];
  const Icon = cfg.icon;
  const isPending = decision === GateDecision.Pending;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border',
        cfg.bg,
        cfg.border,
        cfg.color,
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5', isPending && 'animate-pulse')}
        aria-hidden="true"
      />
      {cfg.label}
    </span>
  );
}

function TestSuiteSummary({
  label,
  icon: Icon,
  suite,
}: {
  label: string;
  icon: typeof BarChart3;
  suite: TestSuite;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className={cn('text-sm font-mono font-medium', testColor(suite))}>
        {testRatio(suite)}
        <span className="text-muted-foreground font-normal ml-1">passed</span>
      </span>
    </div>
  );
}

function LogAnalysisSummary({ analysis }: { analysis: LogAnalysis }) {
  const metrics = [
    { label: 'HTTP Errors', value: analysis.httpErrors, icon: Server, threshold: 5 },
    { label: 'Latency Spikes', value: analysis.latencySpikes, icon: Zap, threshold: 3 },
    { label: 'Memory Leaks', value: analysis.memoryLeaks, icon: MemoryStick, threshold: 1 },
    { label: 'Unexpected Errors', value: analysis.unexpectedErrors, icon: Bug, threshold: 5 },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Log Analysis
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((m) => {
          const MetricIcon = m.icon;
          const isWarning = m.value > 0;
          const isCritical = m.value >= m.threshold;
          return (
            <div
              key={m.label}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm border bg-background border-border"
            >
              <MetricIcon
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  isCritical
                    ? 'text-red-400'
                    : isWarning
                      ? 'text-amber-400'
                      : 'text-emerald-400',
                )}
                aria-hidden="true"
              />
              <span className="text-muted-foreground truncate">{m.label}</span>
              <span
                className={cn(
                  'ml-auto font-mono font-medium',
                  isCritical
                    ? 'text-red-400'
                    : isWarning
                      ? 'text-amber-400'
                      : 'text-emerald-400',
                )}
              >
                {m.value}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">Anomaly Score</span>
        <span className={cn('text-sm font-mono font-medium', anomalyColor(analysis.anomalyScore))}>
          {analysis.anomalyScore}/100
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{analysis.summary}</p>
    </div>
  );
}

function QAReportSection({ report }: { report: QAReport }) {
  const isRollout = report.recommendation === 'rollout';

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3">
        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">QA Report</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Recommendation */}
        <div
          className={cn(
            'rounded-lg border px-4 py-3',
            isRollout
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-red-500/5 border-red-500/20',
          )}
        >
          <p className="text-xs text-muted-foreground mb-1">Recommendation</p>
          <span
            className={cn(
              'text-sm font-semibold uppercase tracking-wide',
              isRollout ? 'text-emerald-400' : 'text-red-400',
            )}
          >
            {report.recommendation}
          </span>
        </div>

        {/* Confidence */}
        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">Confidence</p>
          <div className="flex items-baseline gap-1">
            <span
              className={cn(
                'text-lg font-bold font-mono',
                confidenceColor(report.confidence),
              )}
            >
              {report.confidence}%
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 rounded-full bg-[#2A2A35] overflow-hidden"
            role="progressbar"
            aria-valuenow={report.confidence}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Confidence: ${report.confidence} percent`}
          >
            <div
              className={cn('h-full rounded-full transition-all duration-500', confidenceBg(report.confidence))}
              style={{ width: `${report.confidence}%` }}
            />
          </div>
        </div>
      </div>

      {/* Test Results */}
      <div className="rounded-lg border border-border bg-background px-4 py-3 space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Test Summary
        </h4>
        <TestSuiteSummary label="E2E" icon={Activity} suite={report.e2eResults} />
        <div className="border-t border-border" />
        <TestSuiteSummary label="Integration" icon={BarChart3} suite={report.integrationResults} />
        <div className="border-t border-border" />
        <TestSuiteSummary label="Performance" icon={Gauge} suite={report.performanceResults} />
      </div>

      {/* Log Analysis */}
      <div className="rounded-lg border border-border bg-background px-4 py-3">
        <LogAnalysisSummary analysis={report.logAnalysis} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gate Card
// ---------------------------------------------------------------------------

function GateCard({ gate }: { gate: HumanGate }) {
  const { dispatch } = useFactory();
  const [confirmAction, setConfirmAction] = useState<GateDecision | null>(null);
  const [notes, setNotes] = useState('');

  const config = DECISION_CONFIG[gate.decision];
  const isPending = gate.decision === GateDecision.Pending;
  const isStagingGate = gate.type === 'staging';
  const GateIcon = isStagingGate ? ShieldAlert : ShieldCheck;

  const handleDecision = useCallback(
    (decision: GateDecision) => {
      dispatch({
        type: 'UPDATE_GATE',
        payload: {
          ...gate,
          decision,
          reviewer: 'Current User',
          notes: notes.trim() || null,
          decidedAt: new Date().toISOString(),
        },
      });
      setConfirmAction(null);
      setNotes('');
    },
    [dispatch, gate, notes],
  );

  return (
    <div
      className={cn(
        'rounded-xl border p-5 transition-all duration-300',
        'bg-card',
        isPending
          ? 'border-pink-500/40 shadow-[0_0_20px_-5px_rgba(236,72,153,0.15)]'
          : config.border,
      )}
      role="region"
      aria-label={`${isStagingGate ? 'Staging' : 'Release'} gate: ${config.label}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg',
              isPending ? 'bg-pink-500/10' : config.bg,
            )}
          >
            <GateIcon
              className={cn(
                'h-5 w-5',
                isPending ? 'text-pink-400 animate-pulse' : config.color,
              )}
              aria-hidden="true"
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {isStagingGate ? 'Staging Gate' : 'Release Gate'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Requested {formatTimestamp(gate.requestedAt)}
            </p>
          </div>
        </div>
        <DecisionBadge decision={gate.decision} />
      </div>

      {/* Decided state */}
      {!isPending && gate.reviewer && (
        <div className="rounded-lg border border-border bg-background p-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-foreground font-medium">{gate.reviewer}</span>
            {gate.decidedAt && (
              <span className="text-muted-foreground text-xs ml-auto">
                {formatTimestamp(gate.decidedAt)}
              </span>
            )}
          </div>
          {gate.notes && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{gate.notes}</p>
          )}
        </div>
      )}

      {/* Pending actions */}
      {isPending && (
        <div className="space-y-3">
          {confirmAction !== null ? (
            <div
              className={cn(
                'rounded-lg border p-4 space-y-3',
                'bg-background',
                DECISION_CONFIG[confirmAction].border,
              )}
            >
              <p className="text-sm text-foreground">
                Confirm{' '}
                <span className={cn('font-semibold', DECISION_CONFIG[confirmAction].color)}>
                  {DECISION_CONFIG[confirmAction].label}
                </span>{' '}
                for the {isStagingGate ? 'Staging' : 'Release'} gate?
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes (optional)..."
                className={cn(
                  'w-full rounded-md border bg-card border-border px-3 py-2',
                  'text-sm text-foreground placeholder:text-muted-foreground/50',
                  'focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500/50',
                  'resize-none',
                )}
                rows={2}
                aria-label="Decision notes"
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmAction(null);
                    setNotes('');
                  }}
                  className="text-muted-foreground hover:text-foreground hover:bg-[#2A2A35]/50"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleDecision(confirmAction)}
                  className={cn(
                    'font-medium',
                    confirmAction === GateDecision.Approved &&
                      'bg-emerald-600 hover:bg-emerald-700 text-white',
                    confirmAction === GateDecision.Rejected &&
                      'bg-red-600 hover:bg-red-700 text-white',
                    confirmAction === GateDecision.Deferred &&
                      'bg-amber-600 hover:bg-amber-700 text-white',
                  )}
                >
                  Confirm {DECISION_CONFIG[confirmAction].label}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setConfirmAction(GateDecision.Approved)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex-1"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Approve
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmAction(GateDecision.Rejected)}
                className="bg-red-600 hover:bg-red-700 text-white font-medium flex-1"
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Reject
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmAction(GateDecision.Deferred)}
                className="bg-amber-600 hover:bg-amber-700 text-white font-medium"
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                Defer
              </Button>
            </div>
          )}
        </div>
      )}

      {/* QA Report (release gate only) */}
      {gate.qaReport && <QAReportSection report={gate.qaReport} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function HumanGates() {
  const { state } = useFactory();
  const { gates } = state;

  const stagingGate = gates.find((g) => g.type === 'staging');
  const releaseGate = gates.find((g) => g.type === 'release');

  if (!stagingGate && !releaseGate) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No human gates are active for the current batch.</p>
      </div>
    );
  }

  const pendingCount = gates.filter((g) => g.decision === GateDecision.Pending).length;

  return (
    <section aria-label="Human Approval Gates" className="space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/10"
          aria-hidden="true"
        >
          <AlertTriangle className="h-4 w-4 text-pink-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Human Approval Gates</h2>
          <p className="text-xs text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} gate${pendingCount > 1 ? 's' : ''} awaiting human decision`
              : 'All gates resolved'}
          </p>
        </div>
        {pendingCount > 0 && (
          <span
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white animate-pulse"
            style={{ backgroundColor: ACCENT_PINK }}
            aria-label={`${pendingCount} pending`}
          >
            {pendingCount}
          </span>
        )}
      </div>

      {/* Gate cards */}
      <div className="grid gap-5 lg:grid-cols-2">
        {stagingGate && <GateCard gate={stagingGate} />}
        {releaseGate && <GateCard gate={releaseGate} />}
      </div>
    </section>
  );
}
