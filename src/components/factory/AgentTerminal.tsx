'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { FactoryAgent } from '@/types/factory';
import { AgentStatus } from '@/types/factory';
import {
  X,
  Maximize2,
  Minimize2,
  Circle,
  Clock,
  Zap,
  DollarSign,
  FileCode2,
  TestTube2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AgentTerminalProps {
  agent: FactoryAgent;
  onClose: () => void;
}

const statusColors: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'text-zinc-500',
  [AgentStatus.Coding]: 'text-blue-400',
  [AgentStatus.Testing]: 'text-amber-400',
  [AgentStatus.CreatingPR]: 'text-purple-400',
  [AgentStatus.InReview]: 'text-fuchsia-400',
  [AgentStatus.Rejected]: 'text-red-400',
  [AgentStatus.Done]: 'text-green-400',
  [AgentStatus.Error]: 'text-red-400',
};

const statusLabels: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'Idle',
  [AgentStatus.Coding]: 'Coding',
  [AgentStatus.Testing]: 'Testing',
  [AgentStatus.CreatingPR]: 'Creating PR',
  [AgentStatus.InReview]: 'In Review',
  [AgentStatus.Rejected]: 'Rejected',
  [AgentStatus.Done]: 'Done',
  [AgentStatus.Error]: 'Error',
};

// Simulated terminal output for demo — in production this comes from WebSocket/tmux
function generateSimulatedOutput(agent: FactoryAgent): string[] {
  const base = [
    `\x1b[90m$ claude --print --output-format stream-json\x1b[0m`,
    `\x1b[36m[${agent.tmuxSession}]\x1b[0m Connected to worktree: \x1b[33m${agent.worktree}\x1b[0m`,
    ``,
    `\x1b[90m──────────────────────────────────────────────\x1b[0m`,
    `\x1b[1m Story: ${agent.storyKey || 'unassigned'}\x1b[0m`,
    `\x1b[90m──────────────────────────────────────────────\x1b[0m`,
    ``,
  ];

  const codingLines = [
    `\x1b[34m⠋\x1b[0m Reading story context from Linear...`,
    `\x1b[32m✓\x1b[0m Story context loaded (${Math.floor(Math.random() * 500 + 200)} tokens)`,
    `\x1b[34m⠋\x1b[0m Analyzing existing codebase...`,
    `\x1b[32m✓\x1b[0m Found 12 relevant files in \x1b[33msrc/\x1b[0m`,
    `\x1b[34m⠋\x1b[0m Planning implementation...`,
    `\x1b[32m✓\x1b[0m Plan: 4 files to create, 2 files to modify`,
    ``,
    `\x1b[90m> Creating\x1b[0m \x1b[33msrc/middleware/auth.ts\x1b[0m`,
    `  \x1b[32m+\x1b[0m JWT verification middleware`,
    `  \x1b[32m+\x1b[0m Token refresh logic`,
    `  \x1b[32m+\x1b[0m Rate limiting per user`,
    `\x1b[90m> Creating\x1b[0m \x1b[33msrc/middleware/auth.test.ts\x1b[0m`,
    `  \x1b[32m+\x1b[0m 8 test cases for auth flow`,
    `  \x1b[32m+\x1b[0m Mock JWT provider`,
    `\x1b[90m> Modifying\x1b[0m \x1b[33msrc/routes/index.ts\x1b[0m`,
    `  \x1b[33m~\x1b[0m Added auth middleware to protected routes`,
    `\x1b[90m> Creating\x1b[0m \x1b[33msrc/utils/token.ts\x1b[0m`,
    `  \x1b[32m+\x1b[0m Token generation utility`,
    `  \x1b[32m+\x1b[0m HMAC-SHA256 signing`,
  ];

  const testingLines = [
    ``,
    `\x1b[34m⠋\x1b[0m Running test suite...`,
    `\x1b[90m  PASS\x1b[0m \x1b[32m✓\x1b[0m verifies JWT token (23ms)`,
    `\x1b[90m  PASS\x1b[0m \x1b[32m✓\x1b[0m rejects expired token (12ms)`,
    `\x1b[90m  PASS\x1b[0m \x1b[32m✓\x1b[0m handles missing authorization header (8ms)`,
    `\x1b[90m  PASS\x1b[0m \x1b[32m✓\x1b[0m refreshes token before expiry (45ms)`,
    `\x1b[90m  PASS\x1b[0m \x1b[32m✓\x1b[0m rate limits after 100 requests (102ms)`,
    `\x1b[90m  FAIL\x1b[0m \x1b[31m✗\x1b[0m handles concurrent refresh (67ms)`,
    `    \x1b[31mExpected: token to be refreshed once\x1b[0m`,
    `    \x1b[31mReceived: token refreshed 3 times\x1b[0m`,
    ``,
    `\x1b[34m⠋\x1b[0m Fixing concurrent refresh issue...`,
    `\x1b[90m> Modifying\x1b[0m \x1b[33msrc/middleware/auth.ts\x1b[0m`,
    `  \x1b[33m~\x1b[0m Added mutex lock for token refresh`,
    ``,
    `\x1b[34m⠋\x1b[0m Re-running failed tests...`,
    `\x1b[90m  PASS\x1b[0m \x1b[32m✓\x1b[0m handles concurrent refresh (54ms)`,
    ``,
    `\x1b[32m✓ All 6 tests passed\x1b[0m`,
    `\x1b[90m  Coverage: 94.2% statements, 88.7% branches\x1b[0m`,
  ];

  const prLines = [
    ``,
    `\x1b[34m⠋\x1b[0m Creating pull request...`,
    `\x1b[32m✓\x1b[0m PR #89 opened: \x1b[36m"feat: Add JWT auth middleware with rate limiting"\x1b[0m`,
    `  \x1b[32m+247\x1b[0m \x1b[31m-12\x1b[0m across 4 files`,
    `\x1b[34m⠋\x1b[0m Awaiting Claude Review...`,
  ];

  let lines = [...base];
  if (agent.status === AgentStatus.Coding || agent.status === AgentStatus.Testing || agent.status === AgentStatus.CreatingPR || agent.status === AgentStatus.Done) {
    lines = [...lines, ...codingLines];
  }
  if (agent.status === AgentStatus.Testing || agent.status === AgentStatus.CreatingPR || agent.status === AgentStatus.Done) {
    lines = [...lines, ...testingLines];
  }
  if (agent.status === AgentStatus.CreatingPR || agent.status === AgentStatus.Done) {
    lines = [...lines, ...prLines];
  }
  if (agent.status === AgentStatus.Done) {
    lines.push(`\x1b[32m✓\x1b[0m Claude Review: \x1b[32mApproved\x1b[0m`);
    lines.push(`\x1b[32m✓\x1b[0m PR merged to \x1b[33mforge/sprint-batch-47\x1b[0m`);
  }

  return lines;
}

// Simple ANSI to HTML parser for display
function ansiToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\x1b\[0m/g, '</span>')
    .replace(/\x1b\[1m/g, '<span class="font-bold text-zinc-100">')
    .replace(/\x1b\[31m/g, '<span class="text-red-400">')
    .replace(/\x1b\[32m/g, '<span class="text-green-400">')
    .replace(/\x1b\[33m/g, '<span class="text-amber-400">')
    .replace(/\x1b\[34m/g, '<span class="text-blue-400">')
    .replace(/\x1b\[36m/g, '<span class="text-cyan-400">')
    .replace(/\x1b\[90m/g, '<span class="text-zinc-500">');
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function AgentTerminal({ agent, onClose }: AgentTerminalProps) {
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [streamIndex, setStreamIndex] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  const allLines = generateSimulatedOutput(agent);

  // Simulate streaming effect — lines appear one by one
  useEffect(() => {
    setLines([]);
    setStreamIndex(0);
  }, [agent.id]);

  useEffect(() => {
    if (streamIndex >= allLines.length) return;
    const timer = setTimeout(() => {
      setLines((prev) => [...prev, allLines[streamIndex]]);
      setStreamIndex((prev) => prev + 1);
    }, streamIndex < 7 ? 80 : 150 + Math.random() * 200);
    return () => clearTimeout(timer);
  }, [streamIndex, allLines]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      className={cn(
        'rounded-xl border border-[#2A2A35] bg-[#0A0A0F] overflow-hidden flex flex-col transition-all duration-300',
        expanded ? 'fixed inset-4 z-50' : 'h-[420px]'
      )}
    >
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#141419] border-b border-[#2A2A35] shrink-0">
        <div className="flex items-center gap-3">
          {/* Traffic light dots */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onClose}
              className="h-3 w-3 rounded-full bg-[#FF5F56] hover:bg-[#FF5F56]/80 transition-colors"
              aria-label="Close terminal"
            />
            <div className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
            <button
              onClick={() => setExpanded(!expanded)}
              className="h-3 w-3 rounded-full bg-[#27C93F] hover:bg-[#27C93F]/80 transition-colors"
              aria-label={expanded ? 'Minimize terminal' : 'Maximize terminal'}
            />
          </div>

          {/* Agent info */}
          <div className="flex items-center gap-2 ml-2">
            <Circle className={cn('h-2 w-2 fill-current', statusColors[agent.status])} />
            <span className="text-zinc-200 text-sm font-medium">{agent.name}</span>
            <span className="text-zinc-500 text-xs">—</span>
            <span className={cn('text-xs font-medium', statusColors[agent.status])}>
              {statusLabels[agent.status]}
            </span>
            {agent.storyKey && (
              <>
                <span className="text-zinc-600 text-xs">·</span>
                <span className="text-zinc-400 text-xs font-mono">{agent.storyKey}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Metrics in header */}
          <div className="hidden sm:flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(agent.duration)}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {formatTokens(agent.tokens)}
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              ${agent.cost.toFixed(2)}
            </span>
            <span className="flex items-center gap-1">
              <FileCode2 className="h-3 w-3" />
              {agent.linesWritten}
            </span>
            <span className="flex items-center gap-1">
              <TestTube2 className="h-3 w-3" />
              {agent.testsPassed}/{agent.testsRun}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed"
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'text-zinc-300 min-h-[1.375rem]',
              i === lines.length - 1 && streamIndex < allLines.length && 'animate-pulse'
            )}
            dangerouslySetInnerHTML={{ __html: ansiToHtml(line) || '&nbsp;' }}
          />
        ))}

        {/* Cursor blink */}
        {streamIndex < allLines.length && (
          <div className="flex items-center gap-1 mt-1">
            <span className="inline-block h-4 w-2 bg-green-400 animate-[blink_1s_steps(1)_infinite]" />
          </div>
        )}
        {streamIndex >= allLines.length && (
          <div className="flex items-center gap-1 mt-1 text-zinc-600">
            <span className="inline-block h-4 w-2 bg-zinc-600 animate-[blink_1s_steps(1)_infinite]" />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#141419] border-t border-[#2A2A35] text-[10px] text-zinc-600 shrink-0">
        <span>tmux: {agent.tmuxSession} · worktree: {agent.worktree}</span>
        <span>{lines.length} lines · {streamIndex >= allLines.length ? 'stream ended' : 'streaming...'}</span>
      </div>
    </div>
  );
}
