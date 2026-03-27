import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess, execSync } from 'child_process';
import { createServer } from 'net';
import { resolve, normalize } from 'path';

// ---------------------------------------------------------------------------
// Binary resolution — env var override > PATH lookup
// ---------------------------------------------------------------------------

function resolveBin(name: string): string {
  const envKey = `${name.toUpperCase()}_BIN`;
  if (process.env[envKey]) return process.env[envKey]!;
  try {
    return execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error(
      `'${name}' not found in PATH. Install it or set the ${envKey} environment variable.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TTYD_BIN = resolveBin('ttyd');
const TMUX_BIN = resolveBin('tmux');
const CLAUDE_BIN = resolveBin('claude');

const PORT_START = 7681;
const PORT_MAX = 7999;

const WORKDIR_ROOT = process.env.AGENT_WORKDIR_ROOT ?? '/';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TtydSession {
  agentId: string;
  port: number;
  process: ChildProcess;
  workdir: string;
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
      throw new Error('workdir must not be empty');
    }
    if (workdir.includes('..')) {
      throw new Error('workdir must not contain ".." path traversal');
    }
    const resolved = resolve(normalize(workdir));
    if (WORKDIR_ROOT !== '/' && !resolved.startsWith(resolve(WORKDIR_ROOT))) {
      throw new Error(`workdir must be inside the allowed root (${WORKDIR_ROOT})`);
    }
    return resolved;
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
    let candidate = this.nextPort;
    while (candidate <= PORT_MAX) {
      if (await this.isPortFree(candidate)) {
        this.nextPort = candidate + 1;
        return candidate;
      }
      candidate++;
    }
    throw new Error(`No free ports available in range ${PORT_START}–${PORT_MAX}`);
  }

  // -------------------------------------------------------------------------
  // Start session: ttyd → tmux → claude
  // -------------------------------------------------------------------------

  async startSession(
    agentId: string,
    workdir: string,
    _initialPrompt?: string,
  ): Promise<{ port: number }> {
    const existing = this.sessions.get(agentId);
    if (existing) {
      this.logger.log(`Session already active for agent ${agentId} on port ${existing.port}`);
      return { port: existing.port };
    }

    const safeWorkdir = this.sanitizeWorkdir(workdir);
    const port = await this.findFreePort();
    const tmuxSessionName = `forge-${agentId}`;

    this.logger.log(
      `Starting ttyd+tmux session for agent ${agentId} on port ${port} in ${safeWorkdir}`,
    );

    // ttyd → bash -c "tmux ... && ..."
    // We use a shell wrapper to configure tmux before attaching.
    // Key settings:
    //   smcup@:rmcup@ — disables alternate screen so mouse wheel scrolls
    //     tmux scrollback instead of being converted to arrow keys
    //   mouse on — enables mouse wheel → tmux copy-mode scrollback
    //   status off — hides tmux status bar (UI has its own header)
    // Start tmux server with a config that sets history-limit BEFORE any
    // session/pane is created, so panes inherit the large scrollback.
    const tmuxCmd = [
      // Create session (this also starts the server if needed)
      `${TMUX_BIN} -u new-session -A -s ${tmuxSessionName} -d`,
      // Apply settings
      `${TMUX_BIN} set -g history-limit 50000`,
      `${TMUX_BIN} set -g terminal-overrides ',*:smcup@:rmcup@'`,
      `${TMUX_BIN} set-option -t ${tmuxSessionName} mouse on`,
      `${TMUX_BIN} set-option -t ${tmuxSessionName} status off`,
      `${TMUX_BIN} set-option -t ${tmuxSessionName} display-panes-time 0`,
      `${TMUX_BIN} set -g display-time 0`,
      // Respawn the pane so it inherits the new history-limit
      `${TMUX_BIN} respawn-pane -k -t ${tmuxSessionName} '${CLAUDE_BIN}'`,
      // Attach
      `${TMUX_BIN} attach -t ${tmuxSessionName}`,
    ].join(' && ');

    const ttydArgs = [
      '-W',
      '-p', String(port),
      '-t', 'titleFixed=Claude Code',
      '-t', 'fontSize=13',
      '-t', 'disableResizeOverlay=true',
      '/bin/bash', '-c', tmuxCmd,
    ];

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };

    const child = spawn(TTYD_BIN, ttydArgs, {
      cwd: safeWorkdir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const session: TtydSession = {
      agentId,
      port,
      process: child,
      workdir: safeWorkdir,
      startedAt: new Date(),
    };

    this.sessions.set(agentId, session);

    // Wait for ttyd to be ready before returning the port to the frontend
    await this.waitForTtyd(port);

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logger.debug(`ttyd[${agentId}] stdout: ${chunk.toString().trim()}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.logger.debug(`ttyd[${agentId}] stderr: ${chunk.toString().trim()}`);
    });

    child.on('error', (err: Error) => {
      this.logger.error(`ttyd process error for agent ${agentId}: ${err.message}`);
      this.sessions.delete(agentId);
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      this.logger.log(`ttyd exited for agent ${agentId} — code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.sessions.delete(agentId);
    });

    return { port };
  }

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  stopSession(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (!session) {
      this.logger.warn(`stopSession: no active session for agent ${agentId}`);
      return;
    }

    this.logger.log(`Stopping ttyd session for agent ${agentId} on port ${session.port}`);
    this.sessions.delete(agentId);

    try {
      session.process.kill('SIGTERM');
    } catch (err) {
      this.logger.error(`Error sending SIGTERM: ${(err as Error).message}`);
    }

    // Also kill the tmux session
    try {
      spawn(TMUX_BIN, ['kill-session', '-t', `forge-${agentId}`], { stdio: 'ignore' });
    } catch {
      // best-effort
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
    this.logger.warn(`ttyd on port ${port} did not become ready within ${timeoutMs}ms`);
  }

  // -------------------------------------------------------------------------
  // Check if tmux pane is in copy-mode (user scrolled up)
  // -------------------------------------------------------------------------

  isInCopyMode(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (!session) return false;

    const tmuxSessionName = `forge-${agentId}`;
    try {
      const result = execSync(
        `${TMUX_BIN} display-message -t ${tmuxSessionName} -p "#{pane_in_mode}"`,
        { encoding: 'utf8', timeout: 2000 },
      ).trim();
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

    const tmuxSessionName = `forge-${agentId}`;
    const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` } as NodeJS.ProcessEnv;

    try {
      // Use -l (literal) flag for text containing paths/special chars
      spawn(TMUX_BIN, ['send-keys', '-l', '-t', tmuxSessionName, keys], {
        stdio: 'ignore',
        env,
      });
      this.logger.debug(`Sent keys to agent ${agentId}: ${JSON.stringify(keys).slice(0, 80)}`);
    } catch (err) {
      this.logger.error(`Error sending keys to agent ${agentId}: ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  getSession(agentId: string): { port: number; workdir: string; startedAt: string; url: string } | null {
    const session = this.sessions.get(agentId);
    if (!session) return null;
    return {
      port: session.port,
      workdir: session.workdir,
      startedAt: session.startedAt.toISOString(),
      url: `http://localhost:${session.port}`,
    };
  }

  getSessions(): Array<{ agentId: string; port: number; workdir: string; startedAt: string; url: string }> {
    return [...this.sessions.values()].map((s) => ({
      agentId: s.agentId,
      port: s.port,
      workdir: s.workdir,
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
