import { BadRequestException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess, execSync, execFileSync } from 'child_process';
import { createServer } from 'net';
import { resolve, normalize } from 'path';
import { existsSync, appendFileSync, mkdirSync } from 'fs';

// ---------------------------------------------------------------------------
// Binary resolution — env var override > PATH lookup
// ---------------------------------------------------------------------------

function resolveBin(name: string): string {
  const envKey = `${name.toUpperCase()}_BIN`;
  let binPath: string;

  if (process.env[envKey]) {
    binPath = process.env[envKey]!;
  } else {
    try {
      binPath = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
    } catch {
      throw new Error(
        `'${name}' not found in PATH. Install it or set the ${envKey} environment variable.`,
      );
    }
  }

  // Validate path — must be absolute, no shell metacharacters.
  // Prevents env var injection into bash -c strings (e.g. CLAUDE_BIN="'; rm -rf / #")
  if (!/^\/[a-zA-Z0-9/_.\-]+$/.test(binPath)) {
    throw new Error(`Unsafe binary path for '${name}': "${binPath}"`);
  }

  return binPath;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TTYD_BIN = resolveBin('ttyd');
const TMUX_BIN = resolveBin('tmux');
const CLAUDE_BIN = resolveBin('claude');
const GIT_BIN = resolveBin('git');

const PORT_START = 7681;
const PORT_MAX = 7999;

const WORKDIR_ROOT = process.env.AGENT_WORKDIR_ROOT ?? '/';
const WORKTREE_ROOT = process.env.WORKTREE_ROOT ?? resolve(process.env.HOME ?? '/tmp', '.worktrees');

// Audit log — JSONL file for terminal access tracking
const AUDIT_LOG_DIR = process.env.TERMINAL_AUDIT_DIR ?? resolve(process.env.HOME ?? '/tmp', '.cenzontle');
const AUDIT_LOG_PATH = resolve(AUDIT_LOG_DIR, 'terminal-audit.jsonl');

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TtydSession {
  agentId: string;
  tmuxSocket: string; // Per-agent isolated tmux server socket name
  port: number;
  process: ChildProcess;
  workdir: string;
  worktreePath: string | null; // non-null if we created a worktree
  branch: string | null;
  startedAt: Date;
}

// ---------------------------------------------------------------------------
// TerminalService
// ---------------------------------------------------------------------------

@Injectable()
export class TerminalService implements OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);
  private readonly sessions = new Map<string, TtydSession>();
  private nextPort = PORT_START;

  // -------------------------------------------------------------------------
  // Path safety
  // -------------------------------------------------------------------------

  private sanitizeWorkdir(workdir: string): string {
    if (!workdir || workdir.trim() === '') {
      throw new BadRequestException('workdir must not be empty');
    }
    if (workdir.includes('..')) {
      throw new BadRequestException('workdir must not contain ".." path traversal');
    }
    const resolved = resolve(normalize(workdir));
    if (WORKDIR_ROOT !== '/' && !resolved.startsWith(resolve(WORKDIR_ROOT))) {
      throw new BadRequestException(`workdir must be inside the allowed root (${WORKDIR_ROOT})`);
    }
    return resolved;
  }

  // -------------------------------------------------------------------------
  // Branch name safety
  // -------------------------------------------------------------------------

  private sanitizeBranch(branch: string): string {
    if (!branch || branch.trim() === '') {
      throw new BadRequestException('branch must not be empty');
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_./]*$/.test(branch)) {
      throw new BadRequestException(
        'Invalid branch name. Only alphanumeric, hyphens, underscores, dots, and slashes are allowed.',
      );
    }
    if (branch.includes('..') || branch.endsWith('.lock') || branch.endsWith('/')) {
      throw new BadRequestException('Invalid branch name. Contains forbidden git ref pattern.');
    }
    return branch;
  }

  // -------------------------------------------------------------------------
  // Agent ID safety
  // -------------------------------------------------------------------------

  private sanitizeAgentId(agentId: string): string {
    if (!agentId || agentId.trim() === '') {
      throw new BadRequestException('agentId must not be empty');
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/.test(agentId)) {
      throw new BadRequestException(
        'Invalid agentId. Only alphanumeric, hyphens, and underscores are allowed.',
      );
    }
    if (agentId.length > 128) {
      throw new BadRequestException('agentId must not exceed 128 characters');
    }
    return agentId;
  }

  // -------------------------------------------------------------------------
  // Audit logging — structured JSONL for terminal access tracking
  // -------------------------------------------------------------------------

  auditLog(event: string, agentId: string, meta?: Record<string, unknown>): void {
    const entry = { ts: new Date().toISOString(), event, agentId, ...meta };
    try {
      if (!existsSync(AUDIT_LOG_DIR)) mkdirSync(AUDIT_LOG_DIR, { recursive: true });
      appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch (err) {
      this.logger.warn(`Audit log write failed: ${(err as Error).message}`);
    }
    this.logger.log(`[AUDIT] ${event} agent=${agentId}`);
  }

  getAuditLogPath(): string {
    return AUDIT_LOG_PATH;
  }

  // -------------------------------------------------------------------------
  // Port management
  // -------------------------------------------------------------------------

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((res) => {
      const server = createServer();
      server.once('error', () => res(false));
      server.once('listening', () => {
        server.close(() => res(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  private async findFreePort(): Promise<number> {
    const totalPorts = PORT_MAX - PORT_START + 1;
    for (let i = 0; i < totalPorts; i++) {
      const candidate = PORT_START + ((this.nextPort - PORT_START + i) % totalPorts);
      if (await this.isPortFree(candidate)) {
        this.nextPort = PORT_START + ((candidate - PORT_START + 1) % totalPorts);
        return candidate;
      }
    }
    throw new Error(`No free ports available in range ${PORT_START}–${PORT_MAX}`);
  }

  // -------------------------------------------------------------------------
  // Git worktree management
  // -------------------------------------------------------------------------

  /**
   * Creates an isolated git worktree for an agent.
   * Returns the absolute path to the worktree directory.
   */
  private createWorktree(agentId: string, repoRoot: string, branch: string): string {
    const worktreePath = resolve(WORKTREE_ROOT, 'cenzontle', agentId);

    if (existsSync(worktreePath)) {
      this.logger.log(`Worktree already exists at ${worktreePath}, reusing`);
      return worktreePath;
    }

    this.logger.log(`Creating worktree for agent ${agentId}: branch=${branch} path=${worktreePath}`);

    // Check if branch exists on remote or locally
    let branchExists = false;
    try {
      execFileSync(GIT_BIN, ['rev-parse', '--verify', branch], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      branchExists = true;
    } catch {
      // Branch doesn't exist yet
    }

    // git worktree add [-b branch] <path> [<branch>]
    const args = branchExists
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath, 'main'];

    execFileSync(GIT_BIN, args, {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 30000,
    });

    this.logger.log(`Worktree created at ${worktreePath}`);
    return worktreePath;
  }

  /**
   * Removes a worktree. Safe to call even if it doesn't exist.
   */
  private removeWorktree(agentId: string, repoRoot: string): void {
    const worktreePath = resolve(WORKTREE_ROOT, 'cenzontle', agentId);

    if (!existsSync(worktreePath)) return;

    this.logger.log(`Removing worktree for agent ${agentId} at ${worktreePath}`);
    try {
      execFileSync(GIT_BIN, ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 15000,
      });
    } catch (err) {
      this.logger.warn(`Failed to remove worktree: ${(err as Error).message}`);
    }
  }

  /**
   * Resolves the git repo root from a workdir.
   */
  private getRepoRoot(workdir: string): string {
    return execFileSync(GIT_BIN, ['rev-parse', '--show-toplevel'], {
      cwd: workdir,
      encoding: 'utf-8',
      timeout: 5000,
    }).toString().trim();
  }

  // -------------------------------------------------------------------------
  // Start session: ttyd → tmux → claude
  // -------------------------------------------------------------------------

  async startSession(
    agentId: string,
    workdir: string,
    _initialPrompt?: string,
    branch?: string,
  ): Promise<{ port: number; worktreePath: string | null; branch: string | null }> {
    const safeAgentId = this.sanitizeAgentId(agentId);

    const existing = this.sessions.get(safeAgentId);
    if (existing) {
      this.logger.log(`Session already active for agent ${safeAgentId} on port ${existing.port}`);
      return { port: existing.port, worktreePath: existing.worktreePath, branch: existing.branch };
    }

    const safeWorkdir = this.sanitizeWorkdir(workdir);

    // If a branch is specified, create an isolated worktree
    let effectiveWorkdir = safeWorkdir;
    let worktreePath: string | null = null;
    let safeBranch: string | null = null;

    if (branch) {
      safeBranch = this.sanitizeBranch(branch);
      const repoRoot = this.getRepoRoot(safeWorkdir);
      worktreePath = this.createWorktree(safeAgentId, repoRoot, safeBranch);
      effectiveWorkdir = worktreePath;
    }

    const port = await this.findFreePort();
    // Each agent gets its own isolated tmux server via -L <socket>.
    // This prevents key binding changes from leaking across agents or the host.
    const tmuxSocket = `forge-${safeAgentId}`;

    this.logger.log(
      `Starting ttyd+tmux session for agent ${safeAgentId} on port ${port} in ${effectiveWorkdir}` +
        (safeBranch ? ` (branch: ${safeBranch})` : ''),
    );

    // ttyd → bash -c "tmux ... && ..."
    // SAFETY: agentId is sanitized to [a-zA-Z0-9\-_] only, making shell injection
    // impossible. The tmux command chain requires bash because of &&.
    //
    // SECURITY HARDENING (3 layers):
    //   1. Isolated tmux server (-L) — key binding changes are scoped to this agent
    //   2. Prefix key set to C-] (unreachable from web terminal) + dangerous bindings
    //      unbound (command-prompt, new-window, split-pane, break-pane)
    //   3. default-command = claude — even if a new pane is somehow created, it runs
    //      claude, never a shell. When claude exits, pane dies → session dies → ttyd exits.
    const tmuxCmd = [
      `${TMUX_BIN} -u -L ${tmuxSocket} new-session -A -s main -d`,
      `${TMUX_BIN} -L ${tmuxSocket} set -g history-limit 50000`,
      `${TMUX_BIN} -L ${tmuxSocket} set -g terminal-overrides ',*:smcup@:rmcup@'`,
      // ── Security: prevent shell escape via tmux ──────────────────────
      `${TMUX_BIN} -L ${tmuxSocket} set -g prefix C-]`,
      `${TMUX_BIN} -L ${tmuxSocket} set -g prefix2 C-]`,
      `${TMUX_BIN} -L ${tmuxSocket} set -g default-command '${CLAUDE_BIN}'`,
      `${TMUX_BIN} -L ${tmuxSocket} unbind-key :`,
      `${TMUX_BIN} -L ${tmuxSocket} unbind-key c`,
      `${TMUX_BIN} -L ${tmuxSocket} unbind-key %`,
      `${TMUX_BIN} -L ${tmuxSocket} unbind-key !`,
      `${TMUX_BIN} -L ${tmuxSocket} unbind-key '"'`,
      // ── Display ──────────────────────────────────────────────────────
      `${TMUX_BIN} -L ${tmuxSocket} set-option -t main mouse on`,
      `${TMUX_BIN} -L ${tmuxSocket} set-option -t main status off`,
      `${TMUX_BIN} -L ${tmuxSocket} set-option -t main display-panes-time 1`,
      `${TMUX_BIN} -L ${tmuxSocket} set -g display-time 0`,
      `${TMUX_BIN} -L ${tmuxSocket} respawn-pane -k -t main '${CLAUDE_BIN}'`,
      // ── Auto-destruct: when claude exits, kill the entire tmux server ─
      // Order matters: set AFTER respawn-pane so the initial shell kill
      // doesn't trigger the hook before claude starts.
      `${TMUX_BIN} -L ${tmuxSocket} set-option -t main remain-on-exit on`,
      `${TMUX_BIN} -L ${tmuxSocket} set-hook -g pane-died 'kill-server'`,
      `${TMUX_BIN} -L ${tmuxSocket} attach -t main`,
    ].join(' && ');

    const ttydArgs = [
      '-W',
      '-i', '127.0.0.1',
      '-p', String(port),
      '-t', 'titleFixed=Claude Code',
      '-t', 'fontSize=13',
      '-t', 'disableResizeOverlay=true',
      '-t', 'disableReconnect=true',
      '/bin/bash', '-c', tmuxCmd,
    ];

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };

    const child = spawn(TTYD_BIN, ttydArgs, {
      cwd: effectiveWorkdir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const session: TtydSession = {
      agentId: safeAgentId,
      tmuxSocket,
      port,
      process: child,
      workdir: effectiveWorkdir,
      worktreePath,
      branch: safeBranch,
      startedAt: new Date(),
    };

    this.sessions.set(safeAgentId, session);

    // Wait for ttyd to be ready — clean up zombie session on failure
    try {
      await this.waitForTtyd(port);
    } catch (err) {
      this.logger.error(`ttyd failed to start for agent ${safeAgentId}: ${(err as Error).message}`);
      this.sessions.delete(safeAgentId);
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
      throw err;
    }

    this.auditLog('SESSION_START', safeAgentId, {
      port,
      workdir: effectiveWorkdir,
      branch: safeBranch,
      worktreePath,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logger.debug(`ttyd[${safeAgentId}] stdout: ${chunk.toString().trim()}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.logger.debug(`ttyd[${safeAgentId}] stderr: ${chunk.toString().trim()}`);
    });

    child.on('error', (err: Error) => {
      this.logger.error(`ttyd process error for agent ${safeAgentId}: ${err.message}`);
      this.sessions.delete(safeAgentId);
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      this.logger.log(`ttyd exited for agent ${safeAgentId} — code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.sessions.delete(safeAgentId);
    });

    return { port, worktreePath, branch: safeBranch };
  }

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  stopSession(agentId: string, removeWorktreeOnStop = false): void {
    const session = this.sessions.get(agentId);
    if (!session) {
      this.logger.warn(`stopSession: no active session for agent ${agentId}`);
      return;
    }

    // Use session.agentId (sanitized at startSession time) for all operations
    const safeId = session.agentId;

    this.logger.log(`Stopping ttyd session for agent ${safeId} on port ${session.port}`);
    this.sessions.delete(agentId);

    const durationMs = Date.now() - session.startedAt.getTime();
    this.auditLog('SESSION_STOP', safeId, { port: session.port, durationMs });

    try {
      session.process.kill('SIGTERM');
    } catch (err) {
      this.logger.error(`Error sending SIGTERM: ${(err as Error).message}`);
    }

    try {
      // kill-server (not kill-session) because each agent has its own isolated tmux server
      spawn(TMUX_BIN, ['-L', session.tmuxSocket, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // best-effort
    }

    if (removeWorktreeOnStop && session.worktreePath) {
      try {
        const repoRoot = this.getRepoRoot(session.worktreePath);
        this.removeWorktree(safeId, repoRoot);
      } catch {
        // best-effort — worktree may already be gone
      }
    }
  }

  // -------------------------------------------------------------------------
  // Wait for ttyd to be ready (HTTP 200)
  // -------------------------------------------------------------------------

  private async waitForTtyd(port: number, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}`, { method: 'HEAD' });
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`ttyd on port ${port} did not become ready within ${timeoutMs}ms`);
  }

  // -------------------------------------------------------------------------
  // Check if tmux pane is in copy-mode (user scrolled up)
  // -------------------------------------------------------------------------

  isInCopyMode(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (!session) return false;

    try {
      const result = execFileSync(
        TMUX_BIN,
        ['-L', session.tmuxSocket, 'display-message', '-t', 'main', '-p', '#{pane_in_mode}'],
        { encoding: 'utf8', timeout: 2000 },
      ).toString().trim();
      return result === '1';
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Send keys to the tmux session (e.g. Escape to interrupt auto mode)
  // -------------------------------------------------------------------------

  sendKeys(agentId: string, keys: string): void {
    const session = this.sessions.get(agentId);
    if (!session) {
      this.logger.warn(`sendKeys: no active session for agent ${agentId}`);
      return;
    }

    const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` } as NodeJS.ProcessEnv;

    try {
      spawn(TMUX_BIN, ['-L', session.tmuxSocket, 'send-keys', '-l', '-t', 'main', keys], {
        stdio: 'ignore',
        env,
      });
      this.logger.debug(`Sent keys to agent ${session.agentId}: ${JSON.stringify(keys).slice(0, 80)}`);
    } catch (err) {
      this.logger.error(`Error sending keys to agent ${session.agentId}: ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  getSession(agentId: string): {
    port: number; workdir: string; worktreePath: string | null;
    branch: string | null; startedAt: string; url: string;
  } | null {
    const session = this.sessions.get(agentId);
    if (!session) return null;
    return {
      port: session.port,
      workdir: session.workdir,
      worktreePath: session.worktreePath,
      branch: session.branch,
      startedAt: session.startedAt.toISOString(),
      url: `http://localhost:${session.port}`,
    };
  }

  getSessions(): Array<{
    agentId: string; port: number; workdir: string; worktreePath: string | null;
    branch: string | null; startedAt: string; url: string;
  }> {
    return [...this.sessions.values()].map((s) => ({
      agentId: s.agentId,
      port: s.port,
      workdir: s.workdir,
      worktreePath: s.worktreePath,
      branch: s.branch,
      startedAt: s.startedAt.toISOString(),
      url: `http://localhost:${s.port}`,
    }));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  onModuleDestroy(): void {
    this.logger.log(`Module destroy — stopping ${this.sessions.size} active session(s)`);
    for (const agentId of [...this.sessions.keys()]) {
      this.stopSession(agentId);
    }
  }
}
