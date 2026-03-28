'use client';

import { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface UseAgentTerminalReturn {
  /** The ttyd URL to embed in an iframe (null if no session) */
  ttydUrl: string | null;
  /** Whether a session is active */
  sessionActive: boolean;
  /** Loading state for start/stop operations */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** The worktree path created by the backend (null if no branch was specified) */
  worktreePath: string | null;
  /** Start a ttyd+tmux+claude session for this agent */
  startSession: (workdir: string, initialPrompt?: string, branch?: string) => Promise<void>;
  /** Stop the current session */
  stopSession: () => Promise<void>;
  /** Send keys to the tmux session (e.g. Escape to interrupt) */
  sendKeys: (keys: string) => Promise<void>;
}

export function useAgentTerminal(agentId: string): UseAgentTerminalReturn {
  const [ttydUrl, setTtydUrl] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worktreePath, setWorktreePath] = useState<string | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/factory/terminal/session/${agentId}`);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as {
            url?: string; worktreePath?: string | null; branch?: string | null;
          };
          if (data.url) {
            setTtydUrl(data.url);
            setSessionActive(true);
            if (data.worktreePath !== undefined) setWorktreePath(data.worktreePath);
          }
        }
      } catch {
        // API not reachable — stay in demo mode
      }
    })();

    return () => { cancelled = true; };
  }, [agentId]);

  // Reset on agentId change
  useEffect(() => {
    setTtydUrl(null);
    setSessionActive(false);
    setError(null);
    setWorktreePath(null);
  }, [agentId]);

  const startSession = useCallback(
    async (workdir: string, initialPrompt?: string, branch?: string) => {
      setLoading(true);
      setError(null);

      try {
        const body: Record<string, string> = { agentId, workdir };
        if (initialPrompt) body.initialPrompt = initialPrompt;
        if (branch) body.branch = branch;

        const res = await fetch(`${API_URL}/api/factory/terminal/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`Terminal start failed (${res.status}): ${text}`);
        }

        const data = (await res.json()) as {
          agentId: string; port: number; url: string;
          worktreePath: string | null; branch: string | null;
        };
        setTtydUrl(data.url);
        setSessionActive(true);
        setWorktreePath(data.worktreePath);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [agentId],
  );

  const stopSession = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/factory/terminal/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Terminal stop failed (${res.status}): ${text}`);
      }

      setTtydUrl(null);
      setSessionActive(false);
      setWorktreePath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const sendKeys = useCallback(
    async (keys: string) => {
      try {
        await fetch(`${API_URL}/api/factory/terminal/send-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, keys }),
        });
      } catch {
        // Best-effort — don't surface key-send failures to the user
      }
    },
    [agentId],
  );

  return { ttydUrl, sessionActive, loading, error, worktreePath, startSession, stopSession, sendKeys };
}
