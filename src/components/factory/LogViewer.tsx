'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { LogEntry } from '@/types/factory';
import { Terminal, Filter } from 'lucide-react';

// -- Constants ---------------------------------------------------------------

type SourceFilter = 'all' | LogEntry['source'];
type LevelFilter = 'all' | LogEntry['level'];

const sourceOptions: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'agent', label: 'Agent' },
  { value: 'review', label: 'Review' },
  { value: 'ci', label: 'CI' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'qa', label: 'QA' },
];

const levelOptions: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const sourceBadgeConfig: Record<
  LogEntry['source'],
  { label: string; bg: string; text: string }
> = {
  agent: { label: 'agent', bg: 'bg-blue-500/15', text: 'text-blue-400' },
  review: { label: 'review', bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-400' },
  ci: { label: 'ci', bg: 'bg-amber-500/15', text: 'text-amber-400' },
  temporal: { label: 'temporal', bg: 'bg-purple-500/15', text: 'text-purple-400' },
  qa: { label: 'qa', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
};

const levelDotColor: Record<LogEntry['level'], string> = {
  info: 'bg-blue-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
};

// -- Helpers -----------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

// -- Sub-components ----------------------------------------------------------

function FilterBar({
  source,
  level,
  onSourceChange,
  onLevelChange,
}: {
  source: SourceFilter;
  level: LevelFilter;
  onSourceChange: (v: SourceFilter) => void;
  onLevelChange: (v: LevelFilter) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[#2A2A35] bg-[#0A0A0F] flex-wrap">
      {/* Source filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-3 w-3 text-[#8B8B9A]" />
        <span className="text-[11px] text-[#8B8B9A] font-medium uppercase tracking-wider">
          Source
        </span>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Filter by source">
          {sourceOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={source === opt.value}
              onClick={() => onSourceChange(opt.value)}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                source === opt.value
                  ? 'bg-[#2A2A35] text-[#EDEDF0]'
                  : 'text-[#8B8B9A] hover:text-[#EDEDF0] hover:bg-[#2A2A35]/50',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-[#2A2A35] hidden sm:block" />

      {/* Level filter */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#8B8B9A] font-medium uppercase tracking-wider">
          Level
        </span>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Filter by level">
          {levelOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={level === opt.value}
              onClick={() => onLevelChange(opt.value)}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                level === opt.value
                  ? 'bg-[#2A2A35] text-[#EDEDF0]'
                  : 'text-[#8B8B9A] hover:text-[#EDEDF0] hover:bg-[#2A2A35]/50',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const srcCfg = sourceBadgeConfig[entry.source];
  const dotColor = levelDotColor[entry.level];

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 px-4 py-1 font-mono text-xs leading-5 hover:bg-[#1A1A22]/50 transition-colors',
        entry.level === 'error' && 'bg-red-500/5',
        entry.level === 'warn' && 'bg-amber-500/5',
      )}
    >
      {/* Timestamp */}
      <span className="text-[#8B8B9A] shrink-0 tabular-nums select-none">
        {formatTimestamp(entry.timestamp)}
      </span>

      {/* Source badge */}
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium leading-4 shrink-0 min-w-[52px] justify-center',
          srcCfg.bg,
          srcCfg.text,
        )}
      >
        {srcCfg.label}
      </span>

      {/* Level dot */}
      <span
        className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', dotColor)}
        title={entry.level}
        aria-label={`Level: ${entry.level}`}
      />

      {/* Message */}
      <span
        className={cn(
          'text-[#EDEDF0] break-all',
          entry.level === 'error' && 'text-red-300',
          entry.level === 'warn' && 'text-amber-300',
        )}
      >
        {entry.message}
      </span>
    </div>
  );
}

// -- Main Component ----------------------------------------------------------

export function LogViewer() {
  const { state } = useFactory();
  const logs = state.logs;

  const [source, setSource] = useState<SourceFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let result = logs;
    if (source !== 'all') {
      result = result.filter((e) => e.source === source);
    }
    if (level !== 'all') {
      result = result.filter((e) => e.level === level);
    }
    // Newest first
    return [...result].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [logs, source, level]);

  // Auto-scroll to top when new logs arrive (newest is first)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [filtered.length]);

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A35]">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#8B8B9A]" />
          <h2 className="text-sm font-semibold text-[#EDEDF0]">Logs</h2>
          <span className="inline-flex items-center justify-center rounded-full bg-[#2A2A35] px-2 py-0.5 text-[11px] font-medium text-[#8B8B9A] tabular-nums">
            {filtered.length}
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        source={source}
        level={level}
        onSourceChange={setSource}
        onLevelChange={setLevel}
      />

      {/* Log stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-[#0A0A0F] min-h-[320px] max-h-[520px]"
        role="log"
        aria-label="Log stream"
        aria-live="polite"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full py-12">
            <span className="text-sm text-[#8B8B9A]">No log entries match the current filters.</span>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((entry) => (
              <LogLine key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
