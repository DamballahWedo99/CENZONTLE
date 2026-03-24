'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { FactoryPR, PRStatus } from '@/types/factory';
import {
  GitPullRequest,
  FileCode,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

// -- Status color map --------------------------------------------------------

const prStatusConfig: Record<
  PRStatus,
  { label: string; bg: string; text: string; ring?: string }
> = {
  draft: {
    label: 'Draft',
    bg: 'bg-[#2A2A35]',
    text: 'text-[#8B8B9A]',
  },
  open: {
    label: 'Open',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
  },
  'in-review': {
    label: 'In Review',
    bg: 'bg-fuchsia-500/15',
    text: 'text-fuchsia-400',
  },
  'changes-requested': {
    label: 'Changes',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
  },
  approved: {
    label: 'Approved',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
  },
  merged: {
    label: 'Merged',
    bg: 'bg-emerald-500/80',
    text: 'text-white',
  },
  closed: {
    label: 'Closed',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
  },
};

const ciDotColor: Record<FactoryPR['ciStatus'], string> = {
  pending: 'bg-[#8B8B9A]',
  running: 'bg-blue-400 animate-pulse',
  passed: 'bg-emerald-400',
  failed: 'bg-red-400',
};

// -- Helpers -----------------------------------------------------------------

function timeSince(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: false });
  } catch {
    return '--';
  }
}

// -- Sub-components ----------------------------------------------------------

function StatusBadge({ status }: { status: PRStatus }) {
  const cfg = prStatusConfig[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
        cfg.bg,
        cfg.text,
      )}
    >
      {cfg.label}
    </span>
  );
}

function CIDot({ status }: { status: FactoryPR['ciStatus'] }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full shrink-0', ciDotColor[status])}
      title={`CI: ${status}`}
      aria-label={`CI status: ${status}`}
    />
  );
}

function PRRow({ pr }: { pr: FactoryPR }) {
  return (
    <tr className="border-b border-[#2A2A35] hover:bg-[#1A1A22] transition-colors">
      {/* PR Number */}
      <td className="px-3 py-2.5 font-mono text-xs text-[#8B8B9A] whitespace-nowrap">
        #{pr.number}
      </td>

      {/* Title + Story */}
      <td className="px-3 py-2.5 max-w-[320px]">
        <div className="truncate text-sm text-[#EDEDF0]">{pr.title}</div>
        <span className="text-[11px] font-mono text-[#8B8B9A]">{pr.storyKey}</span>
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        <StatusBadge status={pr.status} />
      </td>

      {/* CI */}
      <td className="px-3 py-2.5 text-center">
        <CIDot status={pr.ciStatus} />
      </td>

      {/* +/- */}
      <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap">
        <span className="text-emerald-400">+{pr.additions}</span>
        <span className="mx-1 text-[#2A2A35]">/</span>
        <span className="text-red-400">-{pr.deletions}</span>
      </td>

      {/* Files */}
      <td className="px-3 py-2.5 text-xs tabular-nums text-[#8B8B9A] text-center">
        {pr.files}
      </td>

      {/* Retries */}
      <td className="px-3 py-2.5 text-center">
        {pr.retryCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
            <RotateCcw className="h-3 w-3" />
            {pr.retryCount}
          </span>
        ) : (
          <span className="text-[#2A2A35]">--</span>
        )}
      </td>

      {/* Time */}
      <td className="px-3 py-2.5 text-xs text-[#8B8B9A] whitespace-nowrap text-right">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {timeSince(pr.createdAt)}
        </span>
      </td>
    </tr>
  );
}

// -- Main Component ----------------------------------------------------------

export function PRPipeline() {
  const { state } = useFactory();
  const prs = state.prs;

  const sorted = useMemo(
    () => [...prs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [prs],
  );

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A35]">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-[#8B8B9A]" />
          <h2 className="text-sm font-semibold text-[#EDEDF0]">Pull Requests</h2>
          <span className="inline-flex items-center justify-center rounded-full bg-[#2A2A35] px-2 py-0.5 text-[11px] font-medium text-[#8B8B9A] tabular-nums">
            {prs.length}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#8B8B9A]">
          <span className="flex items-center gap-1">
            <FileCode className="h-3 w-3" />
            {prs.reduce((s, p) => s + p.files, 0)} files
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left" role="grid" aria-label="Pull Requests pipeline">
          <thead>
            <tr className="border-b border-[#2A2A35] bg-[#0A0A0F]">
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider">
                PR
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-center">
                CI
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider">
                Changes
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-center">
                Files
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-center">
                Retries
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-right">
                Age
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-[#8B8B9A]">
                  No pull requests in the current batch.
                </td>
              </tr>
            ) : (
              sorted.map((pr) => <PRRow key={pr.id} pr={pr} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
