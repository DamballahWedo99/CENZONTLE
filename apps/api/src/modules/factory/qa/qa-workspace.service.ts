import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import * as net from 'net';
import { GitHubService } from '../github/github.service';
import {
  QA_CLONE_TIMEOUT_MS,
  QA_INSTALL_TIMEOUT_MS,
  QA_PORT_MAX,
  QA_PORT_MIN,
  QA_SERVE_READY_TIMEOUT_MS,
} from './qa-config';

const execFileAsync = promisify(execFile);

/** Bind solo a loopback — pasa el allowlist isInternalUrl y nunca expone el
 *  app generado a la red. Override por env igual que PreviewService. */
const SAFE_BIND_HOST = process.env.QA_BIND_HOST?.trim() || '127.0.0.1';

export type QaProjectType = 'static' | 'node' | 'vite';

export interface PreparedWorkspace {
  workdir: string;
  projectType: QaProjectType;
  /** SHA efectivamente checkouteado (stagingSha si se logró, si no null). */
  checkedOutSha: string | null;
  /** Gestor de paquetes detectado. */
  packageManager: 'pnpm' | 'npm' | 'yarn';
  /** True si `install` corrió sin error. */
  installOk: boolean;
}

export interface ServedApp {
  url: string;
  port: number;
  /** Mata el process-group del dev server. Idempotente. */
  stop: () => void;
}

/**
 * Provisión de entornos efímeros para los lentes de QA. Clona el código
 * mergeado a DEV en un tmpdir aislado, instala dependencias, y (para lentes
 * que lo necesitan) sirve el app en una URL loopback. Reusa los patrones del
 * worker runner (git execFile con GIT_TERMINAL_PROMPT=0) y del PreviewService
 * (detección static/node/vite, env whitelist, kill de process-group).
 *
 * SECURITY: corre código agent-generated. Mitigaciones: env whitelist (no
 * hereda DATABASE_URL/VAULT_ENCRYPTION_KEY/etc.), bind loopback, teardown
 * garantizado del process-group + rm del tmpdir.
 */
@Injectable()
export class QaWorkspaceService {
  /** Puertos en uso por servidores efímeros vivos — evita colisiones. */
  private readonly usedPorts = new Set<number>();

  constructor(
    private readonly github: GitHubService,
    @InjectPinoLogger(QaWorkspaceService.name)
    private readonly logger: PinoLogger,
  ) {}

  private async git(
    args: string[],
    cwd: string,
    timeout = QA_CLONE_TIMEOUT_MS,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, {
      cwd,
      timeout,
      env: {
        HOME: process.env.HOME ?? '',
        PATH: process.env.PATH ?? '',
        USER: process.env.USER ?? '',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        GIT_TERMINAL_PROMPT: '0',
      },
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  /**
   * Clona el devBranch (target del merge) en un tmpdir y hace best-effort
   * checkout del stagingSha exacto. Luego instala dependencias. Lanza si el
   * clone falla (la campaña no puede continuar sin código).
   */
  async prepare(input: {
    devBranch: string;
    stagingSha: string | null;
    runId: string;
  }): Promise<PreparedWorkspace> {
    const { cloneUrl } = await this.github.getCloneUrl();
    const workdir = await fs.mkdtemp(join(tmpdir(), `qa-${input.runId.slice(0, 8)}-`));

    // El workdir ya existe en disco; si algo falla después (clone/install),
    // lo borramos antes de propagar para no dejar tmpdirs huérfanos (el catch
    // del orquestador no tiene el `ws` para hacer teardown — qa-reviewer NEW-03).
    try {
      return await this.prepareInWorkdir(workdir, cloneUrl, input);
    } catch (err) {
      await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  }

  private async prepareInWorkdir(
    workdir: string,
    cloneUrl: string,
    input: { devBranch: string; stagingSha: string | null; runId: string },
  ): Promise<PreparedWorkspace> {
    // Clone shallow del devBranch. Profundidad 50 para poder checkoutear un
    // sha reciente (el merge que disparó la campaña) sin traer todo el history.
    await this.git(
      ['clone', '--depth', '50', '--branch', input.devBranch, cloneUrl, workdir],
      tmpdir(),
    );

    let checkedOutSha: string | null = null;
    if (input.stagingSha) {
      try {
        await this.git(['checkout', input.stagingSha], workdir);
        checkedOutSha = input.stagingSha;
      } catch {
        // El sha no está dentro de la profundidad shallow — fetch dirigido.
        try {
          await this.git(['fetch', '--depth', '1', 'origin', input.stagingSha], workdir);
          await this.git(['checkout', input.stagingSha], workdir);
          checkedOutSha = input.stagingSha;
        } catch (err) {
          this.logger.warn(
            { event: 'qa.workspace.checkout_fallback', runId: input.runId, sha: input.stagingSha },
            `[qa:${input.runId}] no se pudo checkoutear stagingSha — se prueba el HEAD de ${input.devBranch}: ${(err as Error).message}`,
          );
        }
      }
    }

    // Asegura que el primer-padre del merge esté local para el diff diferencial
    // de seguridad (best-effort, mientras origin aún tiene el token). Si HEAD^1
    // no existe en el shallow clone, profundiza un poco.
    try {
      await this.git(['rev-parse', '--verify', 'HEAD^1'], workdir);
    } catch {
      await this.git(['fetch', '--deepen', '5', 'origin'], workdir).catch(() => undefined);
    }

    // SECURITY (security-reviewer 2026-06-13 — Finding #1): arranca las
    // credenciales del remote ANTES de correr cualquier código generado. El
    // token de clone (x-access-token:<PAT>@) queda escrito en .git/config, y
    // install (--ignore-scripts=false) / dev / test corren con cwd=workdir y
    // podrían leerlo y exfiltrarlo. QA no necesita el remote después de este
    // punto (el diff de seguridad es local), así que removemos origin.
    await this.git(['remote', 'remove', 'origin'], workdir).catch(() => undefined);

    const packageManager = await this.detectPackageManager(workdir);
    const installOk = await this.install(workdir, packageManager, input.runId);
    const projectType = await this.detectProjectType(workdir);

    return { workdir, projectType, checkedOutSha, packageManager, installOk };
  }

  private async detectPackageManager(workdir: string): Promise<'pnpm' | 'npm' | 'yarn'> {
    const has = async (f: string): Promise<boolean> => {
      try {
        await fs.access(join(workdir, f));
        return true;
      } catch {
        return false;
      }
    };
    if (await has('pnpm-lock.yaml')) return 'pnpm';
    if (await has('yarn.lock')) return 'yarn';
    if (await has('package-lock.json')) return 'npm';
    return 'pnpm';
  }

  private async install(
    workdir: string,
    pm: 'pnpm' | 'npm' | 'yarn',
    runId: string,
  ): Promise<boolean> {
    let pkgExists = true;
    try {
      await fs.access(join(workdir, 'package.json'));
    } catch {
      pkgExists = false;
    }
    if (!pkgExists) return true; // proyecto estático — nada que instalar.

    const installArgs: Record<typeof pm, string[]> = {
      pnpm: ['install', '--silent', '--ignore-scripts=false'],
      npm: ['install', '--no-audit', '--no-fund'],
      yarn: ['install'],
    };
    try {
      await this.runCommand(pm, installArgs[pm], workdir, QA_INSTALL_TIMEOUT_MS);
      return true;
    } catch (err) {
      this.logger.warn(
        { event: 'qa.workspace.install_failed', runId, pm },
        `[qa:${runId}] install falló (${pm}): ${(err as Error).message.slice(0, 200)}`,
      );
      return false;
    }
  }

  /**
   * Detección static/node/vite — espejo de PreviewService.spawnPreviewAsync:
   * Vite primero (su index.html es el entry, no un archivo suelto), luego
   * HTML en root → static, luego dev script → node, si no → static.
   */
  private async detectProjectType(workdir: string): Promise<QaProjectType> {
    let devScript: string;
    try {
      const pkg = JSON.parse(await fs.readFile(join(workdir, 'package.json'), 'utf-8'));
      devScript = typeof pkg?.scripts?.dev === 'string' ? pkg.scripts.dev : '';
    } catch {
      return 'static';
    }
    const hasDevScript = devScript.length > 0;

    const viteConfigs = [
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.cjs',
      'vite.config.mts',
      'vite.config.cts',
    ];
    let hasViteConfig = false;
    for (const c of viteConfigs) {
      try {
        await fs.access(join(workdir, c));
        hasViteConfig = true;
        break;
      } catch {
        /* sigue */
      }
    }
    const devHasVite = /\bvite\b/.test(devScript);
    const devHasNext = /\bnext\b/.test(devScript);
    const isVite = devHasVite || (hasViteConfig && !devHasNext);
    if (isVite) return 'vite';

    const rootEntries = await fs.readdir(workdir).catch(() => [] as string[]);
    const hasRootHtml = rootEntries.some((f) => f.toLowerCase().endsWith('.html'));
    if (hasRootHtml) return 'static';
    if (hasDevScript) return 'node';
    return 'static';
  }

  /** Levanta el app en un puerto libre y espera a que acepte conexiones. */
  async serve(ws: PreparedWorkspace, runId: string): Promise<ServedApp | null> {
    const port = this.allocatePort();
    if (port === null) {
      this.logger.warn(
        { event: 'qa.workspace.no_ports', runId },
        `[qa:${runId}] sin puertos libres para servir`,
      );
      return null;
    }

    const baseEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'development',
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
      BROWSER: 'none',
    };

    let cmd: string;
    let args: string[];
    let env: NodeJS.ProcessEnv;
    if (ws.projectType === 'vite') {
      cmd = 'sh';
      args = ['-c', `pnpm exec vite --port ${port} --host ${SAFE_BIND_HOST} --strictPort`];
      env = baseEnv;
    } else if (ws.projectType === 'node') {
      cmd = 'sh';
      args = ['-c', `PORT=${port} ${ws.packageManager} run dev`];
      env = { ...baseEnv, PORT: String(port), HOST: SAFE_BIND_HOST };
    } else {
      cmd = 'npx';
      args = ['--yes', 'serve', '--listen', `tcp://${SAFE_BIND_HOST}:${port}`, '--no-clipboard', ws.workdir];
      env = baseEnv;
    }

    const child = spawn(cmd, args, {
      cwd: ws.workdir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const pid = child.pid ?? null;
    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      this.usedPorts.delete(port);
      this.killProcessGroup(pid, 'SIGTERM');
      setTimeout(() => this.killProcessGroup(pid, 'SIGKILL'), 5000).unref();
    };

    const ready = await this.waitForPort(port, QA_SERVE_READY_TIMEOUT_MS);
    if (!ready) {
      this.logger.warn(
        { event: 'qa.workspace.serve_timeout', runId, port, projectType: ws.projectType },
        `[qa:${runId}] dev server no levantó en ${QA_SERVE_READY_TIMEOUT_MS}ms`,
      );
      stop();
      return null;
    }
    return { url: `http://${SAFE_BIND_HOST}:${port}`, port, stop };
  }

  /** Corre un comando en el workspace con env whitelist + timeout. */
  async runCommand(
    cmd: string,
    args: string[],
    workdir: string,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: workdir,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          NODE_ENV: 'test',
          CI: '1',
          LANG: process.env.LANG ?? 'en_US.UTF-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const cap = 2 * 1024 * 1024;
      child.stdout?.on('data', (c: Buffer) => {
        if (stdout.length < cap) stdout += c.toString();
      });
      child.stderr?.on('data', (c: Buffer) => {
        if (stderr.length < cap) stderr += c.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`command timeout tras ${timeout}ms: ${cmd} ${args.join(' ')}`));
      }, timeout);
      timer.unref();
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
  }

  async teardown(workdir: string): Promise<void> {
    await fs.rm(workdir, { recursive: true, force: true }).catch((err) => {
      this.logger.warn(
        { event: 'qa.workspace.cleanup_failed', workdir },
        `[qa] cleanup tmpdir falló (non-fatal): ${(err as Error).message}`,
      );
    });
  }

  private allocatePort(): number | null {
    for (let p = QA_PORT_MIN; p <= QA_PORT_MAX; p++) {
      if (!this.usedPorts.has(p)) {
        this.usedPorts.add(p);
        return p;
      }
    }
    return null;
  }

  private killProcessGroup(pid: number | null, signal: NodeJS.Signals): void {
    if (pid == null) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        /* ya muerto */
      }
    }
  }

  private async waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const open = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, SAFE_BIND_HOST);
      });
      if (open) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }
}
