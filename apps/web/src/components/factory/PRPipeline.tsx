'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  getForgePrs,
  type ForgePrItem,
  type ForgePrsResponse,
} from '@/lib/api/factory';
import {
  GitPullRequest,
  ExternalLink,
  Bot,
  GitBranch,
  GitMerge,
  FileCode,
  RotateCcw,
  Clock,
  Database,
  AlertTriangle,
  Filter,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

// -- Config -------------------------------------------------------------------

/** Polling del feed — 15s: los PRs cambian al ritmo del Forge, no hace falta
 *  el polling agresivo de 5s de /factory/nodes. */
const POLL_INTERVAL_MS = 15_000;

type PrStatus = ForgePrItem['status'];
type PrKind = ForgePrItem['kind'];

const STATUS_CFG: Record<PrStatus, { label: string; dot: string; bg: string; text: string }> = {
  draft:  { label: 'Draft',  dot: 'bg-gray-400',    bg: 'bg-gray-500/15',    text: 'text-gray-400' },
  open:   { label: 'Open',   dot: 'bg-blue-400',    bg: 'bg-blue-500/15',    text: 'text-blue-400' },
  merged: { label: 'Merged', dot: 'bg-emerald-400', bg: 'bg-emerald-500/80', text: 'text-white' },
  closed: { label: 'Closed', dot: 'bg-red-400',     bg: 'bg-red-500/15',     text: 'text-red-400' },
};

/** Dot de color del veredicto del DoD verifier (solo PRs de story). */
const DOD_DOT: Record<NonNullable<ForgePrItem['dodStatus']>, string> = {
  passed:  'bg-emerald-400',
  failed:  'bg-red-400',
  pending: 'bg-gray-400',
};

type StatusFilter = 'all' | PrStatus;
type KindFilter = 'all' | PrKind;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'open',   label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
  { value: 'draft',  label: 'Draft' },
];

const KIND_FILTER_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all',     label: 'All' },
  { value: 'story',   label: 'Stories' },
  { value: 'staging', label: 'Staging' },
];

// -- Helpers ------------------------------------------------------------------

function timeAgo(iso: string, addSuffix = false): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix });
  } catch {
    return '--';
  }
}

/** Grupo de PRs de un mismo batch — staging primero, luego stories desc. */
interface BatchGroup {
  batchId: string;
  epicTitle: string;
  /** createdAt más reciente entre los PRs del grupo — ordena grupos desc. */
  latestCreatedAt: number;
  staging: ForgePrItem[];
  stories: ForgePrItem[];
}

/** Epoch ms NaN-safe: un ISO corrupto cae a 0 (fin de la lista) en vez de
 *  envenenar el sort con NaN (orden implementation-defined). */
function timestampOf(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function byCreatedAtDesc(a: ForgePrItem, b: ForgePrItem): number {
  return timestampOf(b.createdAt) - timestampOf(a.createdAt);
}

function groupByBatch(prs: ForgePrItem[]): BatchGroup[] {
  const map = new Map<string, BatchGroup>();
  for (const pr of prs) {
    let group = map.get(pr.batchId);
    if (!group) {
      group = {
        batchId: pr.batchId,
        epicTitle: pr.epicTitle,
        latestCreatedAt: 0,
        staging: [],
        stories: [],
      };
      map.set(pr.batchId, group);
    }
    const created = timestampOf(pr.createdAt);
    if (created > group.latestCreatedAt) group.latestCreatedAt = created;
    (pr.kind === 'staging' ? group.staging : group.stories).push(pr);
  }
  const groups = [...map.values()];
  for (const group of groups) {
    group.staging.sort(byCreatedAtDesc);
    group.stories.sort(byCreatedAtDesc);
  }
  return groups.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
}

// -- Sub-components -----------------------------------------------------------

function StatsBar({ prs }: { prs: ForgePrItem[] }) {
  const counts = useMemo(() => {
    const map: Partial<Record<PrStatus, number>> = {};
    for (const pr of prs) map[pr.status] = (map[pr.status] ?? 0) + 1;
    return map;
  }, [prs]);

  const order: PrStatus[] = ['merged', 'open', 'draft', 'closed'];

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[11px] font-medium text-muted-foreground tabular-nums select-none flex-wrap">
      <span>{prs.length} PRs</span>
      {order.map((s) =>
        counts[s] ? (
          <span key={s} className="flex items-center gap-1">
            <span className="text-border">|</span>
            <span className={cn('h-1.5 w-1.5 rounded-full inline-block', STATUS_CFG[s].dot)} />
            {counts[s]} {STATUS_CFG[s].label.toLowerCase()}
          </span>
        ) : null,
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PrStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none shrink-0', cfg.bg, cfg.text)}>
      {cfg.label}
    </span>
  );
}

/** Pills de filtro con semántica radiogroup — compartido por Status y Type. */
function FilterPills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
            value === opt.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Diffstat `+a/-d` — gris cuando no hay datos de GitHub (live=false). */
function DiffStat({ additions, deletions }: Pick<ForgePrItem, 'additions' | 'deletions'>) {
  if (additions === null || deletions === null) {
    return (
      <span className="tabular-nums text-muted-foreground/50">
        +&ndash;<span className="mx-0.5">/</span>-&ndash;
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      <span className="text-emerald-400">+{additions}</span>
      <span className="mx-0.5 text-muted-foreground/50">/</span>
      <span className="text-red-400">-{deletions}</span>
    </span>
  );
}

function BatchGroupHeader({ group }: { group: BatchGroup }) {
  const count = group.staging.length + group.stories.length;
  return (
    <header className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-b border-border">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
        {group.epicTitle}
      </span>
      <span className="inline-flex items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
        {count} {count === 1 ? 'PR' : 'PRs'}
      </span>
    </header>
  );
}

function PRCard({ pr }: { pr: ForgePrItem }) {
  const isStaging = pr.kind === 'staging';
  const retries = pr.attempts !== null && pr.attempts > 1 ? pr.attempts - 1 : 0;

  return (
    <article
      className={cn(
        'border-b border-border px-4 py-3 transition-colors',
        // El PR de staging se destaca del resto del grupo: borde violeta a la
        // izquierda + fondo sutil — es el consolidado que mergea a dev.
        isStaging
          ? 'border-l-2 border-l-violet-400/70 bg-violet-500/[0.06] hover:bg-violet-500/10'
          : 'hover:bg-muted/30',
      )}
      aria-label={`Pull request ${pr.number}: ${pr.title}`}
    >
      {/* Línea 1: número, título, badges de estado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-muted-foreground shrink-0">#{pr.number}</span>
          <span className="text-sm font-semibold text-foreground truncate">{pr.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isStaging && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium leading-none text-violet-400">
              <GitMerge className="h-3 w-3" aria-hidden="true" />
              Staging &rarr; {pr.targetBranch}
            </span>
          )}
          <StatusBadge status={pr.status} />
          {!pr.live && (
            <span
              role="img"
              title="Estado inferido de la BD — sin conexión a GitHub"
              aria-label="Estado inferido de la BD — sin conexión a GitHub"
              className="inline-flex"
            >
              <Database className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
            </span>
          )}
        </div>
      </div>

      {/* Línea 2: contexto (story + agente | epic) + branches */}
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground flex-wrap">
        {isStaging ? (
          <>
            <span className="truncate max-w-[280px]">{pr.epicTitle}</span>
            <span className="text-border">&middot;</span>
          </>
        ) : (
          <>
            {pr.storyTitle && (
              <>
                <span className="truncate max-w-[280px]">{pr.storyTitle}</span>
                <span className="text-border">&middot;</span>
              </>
            )}
            {pr.agentName && (
              <>
                <span className="inline-flex items-center gap-1">
                  <Bot className="h-3 w-3" aria-hidden="true" />
                  {pr.agentName}
                </span>
                <span className="text-border">&middot;</span>
              </>
            )}
          </>
        )}
        <span className="inline-flex items-center gap-1 font-mono">
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {pr.branch}
        </span>
        <span>&rarr;</span>
        <span className="font-mono">{pr.targetBranch}</span>
      </div>

      {/* Línea 3: diffstat, files, DoD, edad, retries */}
      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
        <DiffStat additions={pr.additions} deletions={pr.deletions} />
        {pr.files !== null && (
          <>
            <span className="text-border">&middot;</span>
            <span className="inline-flex items-center gap-1">
              <FileCode className="h-3 w-3" aria-hidden="true" />
              {pr.files} files
            </span>
          </>
        )}
        {pr.dodStatus !== null && (
          <>
            <span className="text-border">&middot;</span>
            <span className="inline-flex items-center gap-1">
              DoD:
              <span
                className={cn('h-2 w-2 rounded-full inline-block', DOD_DOT[pr.dodStatus])}
                aria-hidden="true"
              />
              {pr.dodStatus}
            </span>
          </>
        )}
        <span className="text-border">&middot;</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {pr.mergedAt ? `merged ${timeAgo(pr.mergedAt, true)}` : timeAgo(pr.createdAt)}
        </span>
        {retries > 0 && (
          <>
            <span className="text-border">&middot;</span>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {retries} {retries === 1 ? 'retry' : 'retries'}
            </span>
          </>
        )}
      </div>

      {/* GitHub link — habilitado cuando el backend resolvió la URL real */}
      {pr.url ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-blue-400 hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Ver en GitHub &rarr;
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-muted-foreground/60 cursor-not-allowed"
          aria-label={`Pull request ${pr.number} sin link — no hay repositorio de GitHub configurado`}
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Ver en GitHub &rarr;
        </button>
      )}
    </article>
  );
}

// -- Main Component -----------------------------------------------------------

export function PRPipeline() {
  const [data, setData] = useState<ForgePrsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  // Ref estable al fetch del effect — habilita el botón "Reintentar" sin
  // recrear el effect ni duplicar el interval (mismo patrón que batch/[id]).
  const fetchPrsRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;

    const fetchPrs = async () => {
      try {
        const res = await getForgePrs();
        if (cancelled) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // En re-polls conservamos la data previa — solo registramos el error;
        // el banner discreto avisa que el feed puede estar stale.
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPrsRef.current = () => void fetchPrs();

    void fetchPrs();
    const interval = setInterval(() => void fetchPrs(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleRetry = useCallback(() => {
    // Guard contra clicks rápidos: sin esto cada click lanza un fetch
    // concurrente y el último en resolver gana de forma no determinística.
    if (loading) return;
    setLoading(true);
    fetchPrsRef.current();
  }, [loading]);

  const prs = useMemo(() => data?.prs ?? [], [data]);

  const filtered = useMemo(
    () =>
      prs.filter(
        (pr) =>
          (statusFilter === 'all' || pr.status === statusFilter) &&
          (kindFilter === 'all' || pr.kind === kindFilter),
      ),
    [prs, statusFilter, kindFilter],
  );

  const groups = useMemo(() => groupByBatch(filtered), [filtered]);

  // Totales del header — solo suman los PRs con diffstat real (live=true);
  // los null de sandbox no aportan al agregado.
  const totals = useMemo(() => {
    let additions = 0, deletions = 0, files = 0;
    for (const pr of prs) {
      if (pr.additions !== null) additions += pr.additions;
      if (pr.deletions !== null) deletions += pr.deletions;
      if (pr.files !== null) files += pr.files;
    }
    return { additions, deletions, files };
  }, [prs]);

  const hasActiveFilter = statusFilter !== 'all' || kindFilter !== 'all';

  // -- Loading inicial (sin data previa) --
  if (loading && !data) {
    return (
      <div className="rounded-xl border border-border bg-card flex items-center justify-center h-full py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  // -- Error sin data que mostrar --
  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center h-full py-32 gap-3">
        <AlertTriangle className="h-6 w-6 text-amber-400" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">
          {error ?? 'No se pudieron cargar los pull requests.'}
        </span>
        <button
          type="button"
          onClick={handleRetry}
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Pull Requests</h2>
          <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            {prs.length}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span>
            <span className="text-emerald-400">+{totals.additions}</span>
            <span className="mx-0.5 text-muted-foreground/50">/</span>
            <span className="text-red-400">-{totals.deletions}</span>
          </span>
          <span className="text-border">|</span>
          <span className="inline-flex items-center gap-1">
            <FileCode className="h-3 w-3" aria-hidden="true" />
            {totals.files} files
          </span>
          <span className="text-border">|</span>
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranch className="h-3 w-3" aria-hidden="true" />
            {data.stagingBranch}
          </span>
        </div>
      </div>

      {/* Error de re-poll — discreto, la data previa sigue visible */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-amber-400 bg-amber-500/10 border-b border-border">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Error al refrescar: {error} — mostrando datos previos.</span>
        </div>
      )}

      {/* Stats bar */}
      <div className="border-b border-border bg-background">
        <StatsBar prs={prs} />
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background flex-wrap">
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider select-none">
          Status
        </span>
        <FilterPills
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Filter by PR status"
        />
        <span className="text-border select-none">|</span>
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider select-none">
          Type
        </span>
        <FilterPills
          options={KIND_FILTER_OPTIONS}
          value={kindFilter}
          onChange={setKindFilter}
          ariaLabel="Filter by PR type"
        />
        {hasActiveFilter && (
          <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
            {filtered.length} of {prs.length}
          </span>
        )}
      </div>

      {/* PR cards agrupadas por batch */}
      <div className="flex-1 overflow-y-auto bg-background" role="feed" aria-label="Pull request cards">
        {prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 gap-2 px-6 text-center">
            <GitPullRequest className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              No hay pull requests del Forge todavía.
            </span>
            <span className="text-xs text-muted-foreground/70">
              Los PRs aparecen aquí cuando el Forge procesa historias de un batch.
            </span>
            {data.repoUrl === null && (
              <span className="text-xs text-amber-400/80 mt-1">
                No hay repositorio de GitHub con escritura del Forge configurado
                (Factory Settings &rarr; Código).
              </span>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
            <Filter className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              Ningún PR coincide con los filtros.
            </span>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.batchId} aria-label={`PRs del batch ${group.epicTitle}`}>
              <BatchGroupHeader group={group} />
              {group.staging.map((pr) => (
                <PRCard key={pr.id} pr={pr} />
              ))}
              {group.stories.map((pr) => (
                <PRCard key={pr.id} pr={pr} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
