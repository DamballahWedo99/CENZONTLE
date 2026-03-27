'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { FactoryAgent } from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import { X, Circle, AlertTriangle, Loader2, ArrowDown, ImagePlus, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentTerminal } from '@/hooks/use-agent-terminal';
import { useFactory } from '@/context/FactoryContext';
import { AgentDetailDrawer, deriveDod, deriveMilestones } from './AgentDetailDrawer';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AgentTerminalProps {
  agent: FactoryAgent;
  onClose: () => void;
}

const statusColors: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'text-muted-foreground/70',
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

export function AgentTerminal({ agent, onClose }: AgentTerminalProps) {
  const { ttydUrl, sessionActive, loading, error, startSession, sendKeys } = useAgentTerminal(agent.id);
  const { state, getStoryById } = useFactory();

  // Lookup related data for the detail drawer
  const story = agent.storyId ? getStoryById(agent.storyId) ?? null : null;
  const batch = state.factory.currentBatch;

  const [detailOpen, setDetailOpen] = useState(false);
  const [activeBar, setActiveBar] = useState<'dod' | 'milestones' | null>(null);

  function toggleBar(bar: 'dod' | 'milestones') {
    setActiveBar((prev) => (prev === bar ? null : bar));
  }

  // ---------------------------------------------------------------------------
  // Copy-mode polling (scroll-to-bottom button)
  // ---------------------------------------------------------------------------
  const [inCopyMode, setInCopyMode] = useState(false);

  useEffect(() => {
    if (!ttydUrl) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/factory/terminal/copy-mode/${agent.id}`);
        if (res.ok) {
          const data = await res.json();
          setInCopyMode(data.inCopyMode);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [ttydUrl, agent.id]);

  function scrollToBottom() {
    sendKeys('q');
    setInCopyMode(false);
  }

  // ---------------------------------------------------------------------------
  // Image upload via file picker
  // ---------------------------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipOpen(true);
    // Auto-close after 2s to prevent it from sticking when mouse goes to iframe
    tooltipTimer.current = setTimeout(() => setTooltipOpen(false), 2000);
  }

  function hideTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipOpen(false);
  }

  const handleImageUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/api/factory/terminal/upload/${agent.id}`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        // Exit copy-mode first (in case user scrolled up), then send the path
        await sendKeys('q');
        await new Promise((r) => setTimeout(r, 200));
        sendKeys(' ' + data.filepath);
      }
    } catch {
      // Best-effort
    } finally {
      setUploading(false);
    }
  }, [agent.id, sendKeys]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    handleImageUpload(file);
    // Reset after a delay so we don't trigger re-render loops
    setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Auto-start
  // ---------------------------------------------------------------------------
  const defaultWorkdir = agent.worktree.startsWith('/worktrees/')
    ? process.env.NEXT_PUBLIC_PROJECT_ROOT || '.'
    : agent.worktree;

  useEffect(() => {
    if (!sessionActive && !loading && !ttydUrl) {
      startSession(defaultWorkdir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="relative overflow-hidden flex flex-col h-full bg-card">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Circle
              className={cn('h-2.5 w-2.5 fill-current shrink-0', statusColors[agent.status])}
            />
            <h3 className="text-sm font-semibold text-foreground truncate">{agent.name}</h3>
            <span
              className={cn(
                'text-xs font-medium shrink-0 rounded-full px-2 py-0.5',
                statusColors[agent.status],
                'bg-current/10',
              )}
            >
              {statusLabels[agent.status]}
            </span>
            {agent.storyKey && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {agent.storyKey}
              </span>
            )}
            {batch?.branch && (
              <a
                href={`https://github.com/DamballahWedo99/CENZONTLE/tree/${batch.branch}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title={`Open branch ${batch.branch} on GitHub`}
              >
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>
                {batch.branch}
              </a>
            )}
            {/* DoD pill */}
            {(() => {
              const dod = deriveDod(agent);
              const dodDone = dod.filter((c) => c.done).length;
              return (
                <button
                  onClick={() => toggleBar('dod')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                    activeBar === 'dod'
                      ? 'border-purple-500/50 bg-purple-500/10 text-purple-400'
                      : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <span className="font-medium">{dodDone}/{dod.length}</span>
                  <span>DoD</span>
                </button>
              );
            })()}
            {/* Milestones pill */}
            {(() => {
              const milestones = deriveMilestones(story, agent);
              const msDone = milestones.filter((c) => c.done).length;
              return (
                <button
                  onClick={() => toggleBar('milestones')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                    activeBar === 'milestones'
                      ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                      : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <span className="font-medium">{msDone}/{milestones.length}</span>
                  <span>milestones</span>
                </button>
              );
            })()}
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-3">
            {/* Upload image button — also accepts drag-and-drop */}
            <TooltipProvider delayDuration={200}>
              <Tooltip open={tooltipOpen}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'h-7 w-7 p-0 text-muted-foreground hover:text-foreground transition-colors',
                      isDragging && 'ring-2 ring-blue-500 text-blue-400',
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onMouseEnter={showTooltip}
                    onMouseLeave={hideTooltip}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
                      if (file) handleImageUpload(file);
                    }}
                    disabled={uploading || !ttydUrl}
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="text-xs">
                  Upload image — click or drag & drop
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Agent detail */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDetailOpen(true)}
              title="Agent details"
            >
              <Info className="h-3.5 w-3.5" />
            </Button>

            {/* Close */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Close terminal"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/50 border-b border-red-800/40 text-xs text-red-300 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {/* Terminal */}
      {ttydUrl ? (
        <div className="relative flex-1 min-h-0">
          <iframe
            src={ttydUrl}
            className="absolute inset-0 w-full h-full border-0 bg-[#0d1117]"
            allow="clipboard-read; clipboard-write"
            title={`Terminal — ${agent.name}`}
          />

          {/* Bottom bar — DoD or Milestones (mutually exclusive) */}
          {activeBar && (() => {
            const items = activeBar === 'dod'
              ? deriveDod(agent)
              : deriveMilestones(story, agent);
            const doneCount = items.filter((c) => c.done).length;
            const label = activeBar === 'dod' ? 'Definition of Done' : 'Milestones';
            const accentColor = activeBar === 'dod' ? 'text-purple-400' : 'text-blue-400';
            return (
              <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-card/90 backdrop-blur-sm border-t border-border">
                <span className={cn('text-[10px] font-medium uppercase tracking-wider shrink-0', accentColor)}>
                  {label}
                </span>
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  {items.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5 min-w-0">
                      {c.done ? (
                        <svg className="h-3 w-3 shrink-0 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <div className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/30" />
                      )}
                      <span className={cn('text-[11px] truncate', c.done ? 'text-foreground/70' : 'text-muted-foreground/40')}>
                        {c.text}
                      </span>
                    </div>
                  ))}
                </div>
                <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0">
                  {doneCount}/{items.length}
                </span>
              </div>
            );
          })()}

          {/* Scroll to bottom */}
          {inCopyMode && (
            <button
              onClick={scrollToBottom}
              className={cn(
                'absolute right-4 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-foreground/90 text-background shadow-lg hover:bg-foreground transition-colors',
                activeBar ? 'bottom-12' : 'bottom-4',
              )}
              title="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0d1117]">
          <Loader2 className="h-6 w-6 animate-spin text-[#484f58]" />
        </div>
      )}

      {/* Agent detail drawer */}
      <AgentDetailDrawer
        agent={agent}
        story={story}
        batch={batch}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
