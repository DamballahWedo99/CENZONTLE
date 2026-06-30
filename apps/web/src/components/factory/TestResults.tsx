'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useForgeTests } from '@/hooks/use-forge-tests';
import { rerunQa, type QaBatchTests, type QaLensSummary } from '@/lib/api/factory';
import { ReleaseGateApprovalDialog } from './ReleaseGateApprovalDialog';

const LENS_LABEL: Record<QaLensSummary['lens'], string> = {
  test_suite: 'Suite',
  e2e: 'E2E',
  security_diff: 'Seguridad',
  perf_a11y: 'Perf · A11y',
};

const STAGE_LABEL: Record<QaBatchTests['stage'], string> = {
  staged: 'Staged',
  'qa-testing': 'En QA',
  'qa-gate-ready': 'Listo para release',
  released: 'Released',
};

function LensStatusIcon({ lens }: { lens: QaLensSummary }) {
  const realFindings = lens.findings.filter((f) => f.claimedReal).length;
  if (lens.status === 'running')
    return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" aria-label="corriendo" />;
  if (lens.status === 'pending')
    return <Clock className="h-3.5 w-3.5 text-muted-foreground/60" aria-label="pendiente" />;
  if (lens.status === 'abandoned')
    return <Ban className="h-3.5 w-3.5 text-amber-400" aria-label="abandonado" />;
  if (lens.status === 'failed')
    return <XCircle className="h-3.5 w-3.5 text-red-400" aria-label="falló" />;
  // completed
  return realFindings > 0 ? (
    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-label="con hallazgos" />
  ) : (
    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" aria-label="ok" />
  );
}

function LensPill({ lens }: { lens: QaLensSummary }) {
  const suite = lens.suite;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1">
      <LensStatusIcon lens={lens} />
      <span className="text-[11px] font-medium text-foreground">{LENS_LABEL[lens.lens]}</span>
      {suite && suite.total > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {suite.passed}/{suite.total}
          {suite.coverage !== null ? ` · ${Math.round(suite.coverage)}%` : ''}
        </span>
      )}
    </div>
  );
}

function ConfidenceBadge({ batch }: { batch: QaBatchTests }) {
  if (batch.recommendation === null || batch.confidence === null) return null;
  const rollout = batch.recommendation === 'rollout';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        rollout
          ? 'bg-green-500/15 text-green-400'
          : 'bg-red-500/15 text-red-400',
      )}
    >
      {rollout ? <Rocket className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
      {rollout ? 'Rollout' : 'Rollback'} · {batch.confidence}%
    </span>
  );
}

function BatchCard({ batch, onChanged }: { batch: QaBatchTests; onChanged: () => void }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const realFindings = batch.lenses.flatMap((l) => l.findings).filter((f) => f.claimedReal);

  const handleRerun = async () => {
    setRerunning(true);
    try {
      const res = await rerunQa(batch.batchId);
      if (!res.qaRunId) {
        toast.warning('No se creó una nueva campaña', {
          description: 'El batch no es elegible o ya hay una campaña activa.',
        });
        return;
      }
      toast.success('QA re-encolado', { description: 'Una nueva campaña arrancará en breve.' });
      onChanged();
    } catch {
      toast.error('No se pudo re-correr QA');
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{batch.epicTitle}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {STAGE_LABEL[batch.stage]}
            </span>
            {batch.qaStatus === 'running' || batch.qaStatus === 'synthesizing' ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                {batch.qaStatus === 'synthesizing' ? 'Sintetizando' : 'Corriendo'}
              </span>
            ) : null}
          </div>
        </div>
        <ConfidenceBadge batch={batch} />
      </div>

      {/* Lenses */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {batch.lenses.length > 0 ? (
          batch.lenses.map((l) => <LensPill key={l.lens} lens={l} />)
        ) : (
          <span className="text-[11px] text-muted-foreground/60">Campaña aún sin lentes…</span>
        )}
      </div>

      {/* Auto-rollback warning */}
      {batch.autoRollbackAdvised && (
        <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30">
          <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0" />
          <span className="text-[11px] text-red-400">
            Fallo crítico verificado — rollback aconsejado.
          </span>
        </div>
      )}

      {/* Verified findings */}
      {realFindings.length > 0 && (
        <ul className="mb-3 space-y-1">
          {realFindings.slice(0, 5).map((f) => (
            <li key={`${batch.batchId}-${f.id}`} className="flex items-start gap-1.5 text-[11px]">
              <span
                className={cn(
                  'mt-0.5 inline-block h-1.5 w-1.5 rounded-full shrink-0',
                  f.severity === 'critical'
                    ? 'bg-red-500'
                    : f.severity === 'high'
                      ? 'bg-orange-500'
                      : f.severity === 'medium'
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground',
                )}
              />
              <span className="text-muted-foreground">
                <span className="text-foreground">[{f.severity}]</span> {f.title}
                {f.verification && (f.verification.upheld > 0 || f.verification.refuted > 0) ? (
                  <span className="text-muted-foreground/60">
                    {' '}
                    ({f.verification.upheld}↑/{f.verification.refuted}↓)
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Narrative */}
      {batch.qaReport?.logAnalysis.summary && (
        <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
          {batch.qaReport.logAnalysis.summary}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {batch.stage === 'qa-gate-ready' && (
          <Button size="sm" onClick={() => setGateOpen(true)}>
            <Rocket className="h-3.5 w-3.5 mr-1.5" />
            Aprobar rollout
          </Button>
        )}
        {batch.stage === 'released' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-cyan-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Liberado{batch.releaseApprovedByName ? ` por ${batch.releaseApprovedByName}` : ''}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRerun}
          disabled={rerunning || batch.qaStatus === 'running' || batch.qaStatus === 'synthesizing'}
          className="ml-auto"
        >
          {rerunning ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Re-correr QA
        </Button>
      </div>

      <ReleaseGateApprovalDialog
        open={gateOpen}
        onOpenChange={setGateOpen}
        batchId={batch.batchId}
        onApproved={onChanged}
      />
    </div>
  );
}

/**
 * Dashboard de QA automático del Forge (/factory/tests). Muestra, por batch
 * mergeado a DEV, el estado de la campaña QA: los 4 lentes ejecutados en
 * paralelo, los fallos verificados adversarialmente, el QAReport sintetizado
 * (recomendación + confianza), y el release gate humano. Datos vía
 * useForgeTests (polling 15s, derive-from-Prisma).
 */
export function TestResults() {
  const { data, loading, degraded, refresh } = useForgeTests();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Cargando resultados de QA…
      </div>
    );
  }

  const batches = data?.batches ?? [];

  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-16 flex flex-col items-center text-center gap-3">
        <FlaskConical className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
        <h3 className="text-base font-semibold text-foreground">Sin batches en QA todavía</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          El QA automático arranca cuando un batch se mergea a DEV (staging gate
          aprobado). Aquí verás los lentes, los fallos verificados y el QAReport.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
            <FlaskConical className="w-4 h-4 text-muted-foreground" />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground tracking-tight">QA Testing</h2>
          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {batches.length}
          </span>
        </div>
        {degraded && (
          <span className="text-[11px] text-amber-400 inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Reconectando…
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {batches.map((b) => (
          <BatchCard key={b.batchId} batch={b} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}
