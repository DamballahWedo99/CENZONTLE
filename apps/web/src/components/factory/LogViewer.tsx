'use client';

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { LogEntry } from '@cenzontle/shared';
import { Terminal, Filter, Search, Info, AlertTriangle, XCircle, ChevronDown, Clock } from 'lucide-react';

type SourceFilter = 'all' | LogEntry['source'];
type LevelFilter = 'all' | LogEntry['level'];
type TimeRange = '1h' | '6h' | '24h' | 'all';

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'agent', label: 'Agent' },
  { value: 'review', label: 'Review' },
  { value: 'ci', label: 'CI' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'qa', label: 'QA' },
];

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: 'all', label: 'All' },
];

const SOURCE_BADGE: Record<LogEntry['source'], { bg: string; text: string }> = {
  agent: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  review: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  ci: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  temporal: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  qa: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
};

const LEVEL_ICON = {
  info: { Icon: Info, color: 'text-blue-400' },
  warn: { Icon: AlertTriangle, color: 'text-amber-400' },
  error: { Icon: XCircle, color: 'text-red-400' },
} as const;

const TIME_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
};

// -- Helpers -----------------------------------------------------------------

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-400/30 text-inherit rounded-sm px-0.5">{part}</mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// -- Sub-components ----------------------------------------------------------

function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider select-none">
        {label}
      </span>
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
    </div>
  );
}

function StatsBar({ total, info, warn, error }: { total: number; info: number; warn: number; error: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[11px] font-medium text-muted-foreground tabular-nums select-none">
      <span>{total} logs</span>
      <span className="text-border">|</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-400 inline-block" />{info} info</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />{warn} warn</span>
      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400 inline-block" />{error} error</span>
    </div>
  );
}

function VolumeBar({ info, warn, error, total }: { info: number; warn: number; error: number; total: number }) {
  if (total === 0) return null;
  const pctI = (info / total) * 100;
  const pctW = (warn / total) * 100;
  const pctE = (error / total) * 100;
  return (
    <div className="mx-4 mb-2 h-1.5 rounded-full overflow-hidden bg-muted flex" aria-label={`Log volume: ${info} info, ${warn} warn, ${error} error`}>
      {pctI > 0 && <div className="bg-blue-400/70 h-full transition-all duration-300" style={{ width: `${pctI}%` }} />}
      {pctW > 0 && <div className="bg-amber-400/70 h-full transition-all duration-300" style={{ width: `${pctW}%` }} />}
      {pctE > 0 && <div className="bg-red-400/70 h-full transition-all duration-300" style={{ width: `${pctE}%` }} />}
    </div>
  );
}

function LogRow({ entry, query, expanded, onToggle }: {
  entry: LogEntry; query: string; expanded: boolean; onToggle: () => void;
}) {
  const src = SOURCE_BADGE[entry.source];
  const lvl = LEVEL_ICON[entry.level];

  return (
    <div
      className={cn(
        'group border-l-2 transition-colors',
        entry.level === 'error' && 'bg-red-500/5 border-l-red-400',
        entry.level === 'warn' && 'bg-amber-500/5 border-l-amber-400',
        entry.level === 'info' && 'border-l-transparent hover:border-l-blue-400/50',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-1.5 font-mono text-xs leading-5 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-muted-foreground shrink-0 tabular-nums select-none">{fmtTime(entry.timestamp)}</span>
        <span className={cn('inline-flex items-center rounded px-1.5 text-[10px] font-medium leading-4 shrink-0 min-w-[52px] justify-center', src.bg, src.text)}>
          {entry.source}
        </span>
        <lvl.Icon className={cn('h-3.5 w-3.5 shrink-0', lvl.color)} aria-label={`Level: ${entry.level}`} />
        <span className={cn(
          'flex-1 truncate',
          entry.level === 'error' && 'text-red-300',
          entry.level === 'warn' && 'text-amber-300',
          entry.level === 'info' && 'text-foreground',
        )}>
          {highlightMatch(entry.message, query)}
        </span>
        <ChevronDown className={cn(
          'h-3 w-3 text-muted-foreground shrink-0 transition-transform opacity-0 group-hover:opacity-100',
          expanded && 'rotate-180 opacity-100',
        )} />
      </button>

      {expanded && (
        <div className="px-4 pb-2.5 pt-0.5 ml-[72px] font-mono text-[11px] space-y-1 border-t border-border/50">
          <p className="text-foreground whitespace-pre-wrap break-words">{entry.message}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-muted-foreground">
            <span>Source ID: <span className="text-foreground">{entry.sourceId}</span></span>
            <span>Timestamp: <span className="text-foreground">{entry.timestamp}</span></span>
            <span className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              entry.level === 'info' && 'bg-blue-500/15 text-blue-400',
              entry.level === 'warn' && 'bg-amber-500/15 text-amber-400',
              entry.level === 'error' && 'bg-red-500/15 text-red-400',
            )}>
              {entry.level}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// -- Main Component ----------------------------------------------------------

export function LogViewer() {
  const { state } = useFactory();
  const logs = state.logs;

  const [source, setSource] = useState<SourceFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleRow = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const lowerQ = query.toLowerCase();

    return logs
      .filter((e) => {
        if (source !== 'all' && e.source !== source) return false;
        if (level !== 'all' && e.level !== level) return false;
        if (timeRange !== 'all') {
          const age = now - new Date(e.timestamp).getTime();
          if (age > TIME_MS[timeRange]) return false;
        }
        if (lowerQ && !e.message.toLowerCase().includes(lowerQ)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, source, level, timeRange, query]);

  const counts = useMemo(() => {
    let info = 0, warn = 0, error = 0;
    for (const e of filtered) {
      if (e.level === 'info') info++;
      else if (e.level === 'warn') warn++;
      else error++;
    }
    return { total: filtered.length, info, warn, error };
  }, [filtered]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filtered.length]);

  const isLive = logs.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold text-foreground">Logs</h2>
        <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          {counts.total}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
        )}
        <div className="flex-1" />
        <div className="relative max-w-[220px] w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search logs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-background py-1 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Search log messages"
          />
        </div>
      </div>

      {/* Stats + Volume */}
      <div className="border-b border-border bg-background">
        <StatsBar {...counts} />
        <VolumeBar {...counts} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-background flex-wrap">
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
        <PillGroup label="Source" options={SOURCE_OPTIONS} value={source} onChange={setSource} ariaLabel="Filter by source" />
        <div className="h-4 w-px bg-border hidden sm:block" />
        <PillGroup label="Level" options={LEVEL_OPTIONS} value={level} onChange={setLevel} ariaLabel="Filter by level" />
        <div className="h-4 w-px bg-border hidden sm:block" />
        <PillGroup
          label=""
          options={TIME_RANGES}
          value={timeRange}
          onChange={setTimeRange}
          ariaLabel="Filter by time range"
        />
        <Clock className="h-3 w-3 text-muted-foreground -ml-1 shrink-0" />
      </div>

      {/* Log stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-background"
        role="log"
        aria-label="Log stream"
        aria-live="polite"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
            <Terminal className="h-6 w-6 text-muted-foreground/50" />
            <span className="text-sm text-muted-foreground">No log entries match the current filters.</span>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                query={query}
                expanded={expandedId === entry.id}
                onToggle={() => toggleRow(entry.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
