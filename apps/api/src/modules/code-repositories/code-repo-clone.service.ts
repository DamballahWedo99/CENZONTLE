import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CodeRepositoryConfigService } from './code-repository-config.service';
import { scrubSecrets } from '../../common/utils/scrub-secrets.util';
import simpleGit from 'simple-git';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import type { CodeRepoCloneStatus } from '@prisma/client';

export interface ActiveCloneInfo {
  id: string;
  name: string;
  absolutePath: string;
  branch: string;
}

export interface CloneStatusInfo {
  status: CodeRepoCloneStatus;
  lastPulledAt: Date | null;
  sha: string | null;
  error: string | null;
}

/**
 * Gestiona los clones locales de repos de GitHub en disco.
 *
 * Estrategia:
 * - Un directorio por repo: {CODE_REPOS_DIR}/{repoId}/
 * - Clone con --depth 1 --single-branch para ahorrar disco (no necesitamos historia)
 * - Mutex por repoId para serializar git pull / git clone simultáneos
 * - Los reads (ripgrep, fs.readFile) NO bloquean — corren contra el working tree
 * - Token NUNCA loggeado: scrubSecrets() se aplica antes de cualquier log/throw
 * - Symlinks deshabilitados en clone (core.symlinks=false) — git deposita symlinks
 *   como archivos de texto con el target como contenido, eliminando el vector
 *   CWE-59 que permitiría que un repo malicioso escape del dir del clon.
 */
@Injectable()
export class CodeRepoCloneService implements OnModuleInit {
  private readonly logger = new Logger(CodeRepoCloneService.name);
  private readonly reposDir: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly configService: CodeRepositoryConfigService,
  ) {
    // Default bajo $HOME porque `/var/` requiere root en dev (macOS/Linux).
    // En prod se debe setear `CODE_REPOS_DIR` explícito (ej. volumen persistente).
    this.reposDir = String(
      this.config.get('CODE_REPOS_DIR') ?? path.join(homedir(), '.cenzontle', 'code-repos'),
    );
  }

  async onModuleInit() {
    await fs.mkdir(this.reposDir, { recursive: true }).catch((err) => {
      this.logger.warn(`Failed to create reposDir ${this.reposDir}: ${err.message}`);
    });
  }

  /**
   * Retorna info de TODOS los repos enabled con clone ready (status='ready').
   * Opción C: múltiples pueden estar enabled simultáneamente. Si ninguno está
   * ready (todos en cloning/error/pending), retorna array vacío.
   */
  async getEnabled(): Promise<ActiveCloneInfo[]> {
    const repos = await this.prisma.codeRepository.findMany({
      where: { isActive: true, cloneStatus: 'ready' },
      orderBy: { name: 'asc' },
    });
    return repos.map((r) => ({
      id: r.id,
      name: r.name,
      absolutePath: this.repoPath(r.id),
      branch: r.branch,
    }));
  }

  /**
   * Busca un repo enabled por nombre (para el parámetro `repository` de las tools).
   * Retorna null si no existe, no está enabled, o no está ready.
   */
  async getEnabledByName(name: string): Promise<ActiveCloneInfo | null> {
    const repo = await this.prisma.codeRepository.findFirst({
      where: { name, isActive: true, cloneStatus: 'ready' },
    });
    if (!repo) return null;
    return {
      id: repo.id,
      name: repo.name,
      absolutePath: this.repoPath(repo.id),
      branch: repo.branch,
    };
  }

  /**
   * Fire-and-forget: programa un clone en background. Actualiza DB con status.
   * Wrapped en withLock para evitar race si otro thread dispara clone simultáneo.
   */
  scheduleClone(repoId: string): void {
    this.logger.log(`[scheduleClone] triggered repo=${repoId}`);
    void this.withLock(repoId, async () => {
      try {
        await this.doCloneOrPull(repoId);
        this.logger.log(`[scheduleClone] completed repo=${repoId}`);
      } catch (err: any) {
        this.logger.warn(`[scheduleClone] failed repo=${repoId} error="${scrubSecrets(err.message ?? String(err))}"`);
      }
    });
  }

  /**
   * Si el clone es más viejo que maxAgeMs, hace git pull. Bloquea hasta terminar.
   * Si el clone está en 'pending'/'error'/'stale', intenta clonar desde cero.
   * Lanza si falla (caller puede atrapar).
   */
  async ensureFresh(repoId: string, maxAgeMs: number): Promise<void> {
    const repo = await this.prisma.codeRepository.findUnique({ where: { id: repoId } });
    if (!repo) throw new Error(`Code repository ${repoId} not found`);

    const needsClone = repo.cloneStatus !== 'ready';
    const ageMs = repo.lastPulledAt ? Date.now() - repo.lastPulledAt.getTime() : Infinity;
    const isStale = !needsClone && ageMs > maxAgeMs;

    if (!needsClone && !isStale) {
      this.logger.debug(
        `[ensureFresh] skip repo=${repoId} status=ready age=${Math.round(ageMs / 1000)}s`,
      );
      return;
    }

    const reason = needsClone
      ? `status=${repo.cloneStatus}`
      : `stale (age=${Math.round(ageMs / 1000)}s > maxAge=${Math.round(maxAgeMs / 1000)}s)`;
    this.logger.log(`[ensureFresh] pulling repo=${repoId} reason="${reason}"`);

    await this.withLock(repoId, () => this.doCloneOrPull(repoId));
  }

  /**
   * Sync manual disparado desde UI. Devuelve resultado (no lanza — para
   * que el controller pueda retornarlo como JSON normal al frontend).
   */
  async syncNow(repoId: string): Promise<{ ok: boolean; sha?: string; message?: string }> {
    try {
      const { sha } = await this.withLock(repoId, () => this.doCloneOrPull(repoId));
      return { ok: true, sha };
    } catch (err: any) {
      return { ok: false, message: scrubSecrets(err?.message ?? String(err)) };
    }
  }

  /**
   * Wipe del clone. Llamado desde el controller en el delete.
   * No lanza: loggea warning si no puede borrar (ej: dir no existe).
   */
  async removeClone(repoId: string): Promise<void> {
    await this.withLock(repoId, async () => {
      try {
        await fs.rm(this.repoPath(repoId), { recursive: true, force: true });
        this.logger.log(`[removeClone] ${repoId}`);
      } catch (err: any) {
        this.logger.warn(`[removeClone] failed for ${repoId}: ${err.message}`);
      }
    });
  }

  async getStatus(repoId: string): Promise<CloneStatusInfo> {
    const repo = await this.prisma.codeRepository.findUnique({ where: { id: repoId } });
    if (!repo) throw new Error(`Code repository ${repoId} not found`);
    return {
      status: repo.cloneStatus,
      lastPulledAt: repo.lastPulledAt,
      sha: repo.lastSyncedSha,
      error: repo.lastSyncError,
    };
  }

  // ─── Private ───

  private async withLock<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(repoId);
    if (existing) await existing;
    let resolve!: () => void;
    const p = new Promise<void>((r) => (resolve = r));
    this.locks.set(repoId, p);
    try {
      return await fn();
    } finally {
      this.locks.delete(repoId);
      resolve();
    }
  }

  private authUrl(owner: string, repo: string, token: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  /**
   * URL pública del repo SIN credenciales. Usada para sobrescribir `.git/config`
   * después del clone, de modo que el PAT nunca quede persistido en disco.
   */
  private cleanUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}.git`;
  }

  private repoPath(repoId: string): string {
    const resolved = path.resolve(this.reposDir, repoId);
    const reposRoot = path.resolve(this.reposDir);
    // Defense in depth: resolved debe estar estrictamente dentro de reposRoot
    if (resolved !== reposRoot && !resolved.startsWith(reposRoot + path.sep)) {
      throw new Error(`Path escape detected for repoId ${repoId}`);
    }
    return resolved;
  }

  /**
   * Core: clona si no existe, o hace git pull si existe. Actualiza DB con el estado.
   * Debe llamarse DENTRO de withLock(repoId, ...) para evitar races.
   */
  private async doCloneOrPull(repoId: string): Promise<{ sha: string }> {
    const resolved = await this.configService.getByIdWithToken(repoId);
    if (!resolved) {
      throw new Error(`Code repository ${repoId} not found or missing token`);
    }
    const { config, token } = resolved;
    const dest = this.repoPath(repoId);

    await this.prisma.codeRepository.update({
      where: { id: repoId },
      data: { cloneStatus: 'cloning', lastSyncError: null },
    });

    try {
      const hasGitDir = await fs
        .access(path.join(dest, '.git'))
        .then(() => true)
        .catch(() => false);

      const authUrl = this.authUrl(config.owner, config.repo, token);
      const cleanUrl = this.cleanUrl(config.owner, config.repo);

      // Capturar SHA actual antes del fetch para diagnosticar si el pull avanzó.
      let oldSha: string | null = null;
      if (hasGitDir) {
        try {
          oldSha = (await simpleGit(dest).revparse(['HEAD'])).trim();
        } catch {
          // .git existe pero corrupto — el fetch/reset abajo lo recuperará
        }
      }
      this.logger.log(
        `[doCloneOrPull] start repo=${repoId} mode=${hasGitDir ? `pull (current=${oldSha?.slice(0, 7) ?? 'unknown'})` : 'fresh-clone'} branch=${config.branch}`,
      );

      if (hasGitDir) {
        // Existing clone: fetch + reset to origin branch (más robusto que pull si hubo historia divergente).
        // Pasamos authUrl como primer argumento de fetch() para que git use las credenciales
        // en runtime SIN persistirlas en .git/config. Defense in depth: también reescribimos
        // origin a cleanUrl antes del fetch por si un clone previo hubiera dejado el PAT filtrado.
        const git = simpleGit(dest);
        await git.remote(['set-url', 'origin', cleanUrl]);
        // Refspec explícito: sin él, `git fetch <url> <branch>` es anónimo —
        // solo actualiza FETCH_HEAD, NO refs/remotes/origin/<branch>. Eso
        // hacía que el siguiente `git reset --hard origin/<branch>` reseteara
        // contra un origin/<branch> stale, dejando el clone permanentemente
        // en el commit inicial sin importar cuántas veces se llamara pull.
        const refspec = `+refs/heads/${config.branch}:refs/remotes/origin/${config.branch}`;
        await git.raw(['fetch', authUrl, refspec]);
        await git.checkout(config.branch);
        await git.reset(['--hard', `origin/${config.branch}`]);
      } else {
        // Fresh clone: --depth 1 para ahorrar disco; --single-branch para solo traer el branch configurado.
        // `core.symlinks=false` evita que git materialice symlinks commiteados al repo como
        // symlinks reales en el filesystem — los deposita como archivos de texto con el target
        // como contenido. Elimina CWE-59 (defensa en profundidad junto con realpath en search).
        //
        // ADVERTENCIA: git clone persiste la URL de origen (incluyendo el PAT) en .git/config.
        // Inmediatamente después del clone, sobrescribimos origin con cleanUrl para evitar
        // que herramientas posteriores (code_read, ripgrep) puedan leer el PAT desde .git/config.
        //
        // Race cleanup: si `remote set-url` falla (disco lleno, SIGKILL, error transitorio)
        // después de que el clone escribió el PAT en .git/config, limpiamos el directorio
        // entero para no dejar credenciales en disco. El catch exterior se encarga del DB state.
        try {
          await simpleGit().clone(authUrl, dest, [
            '--depth',
            '1',
            '--branch',
            config.branch,
            '--single-branch',
            '--config',
            'core.symlinks=false',
          ]);
          await simpleGit(dest).remote(['set-url', 'origin', cleanUrl]);
        } catch (cloneErr) {
          await fs.rm(dest, { recursive: true, force: true }).catch(() => {
            // best-effort — si no se puede limpiar, el catch exterior registra error
          });
          throw cloneErr;
        }
      }

      const sha = (await simpleGit(dest).revparse(['HEAD'])).trim();

      // Conteo de archivos commiteados — verifica que el reset --hard trajo
      // el árbol esperado. `git ls-tree -r HEAD --name-only` lee del index,
      // no del filesystem.
      let fileCount = 0;
      try {
        const lsTree = await simpleGit(dest).raw(['ls-tree', '-r', 'HEAD', '--name-only']);
        fileCount = lsTree.split('\n').filter(Boolean).length;
      } catch {
        // best-effort — el conteo es solo diagnóstico
      }

      await this.prisma.codeRepository.update({
        where: { id: repoId },
        data: {
          cloneStatus: 'ready',
          clonedAtPath: dest,
          lastPulledAt: new Date(),
          lastSyncedSha: sha,
          lastSyncError: null,
        },
      });

      const changed = oldSha && oldSha !== sha;
      const transition = oldSha
        ? `${oldSha.slice(0, 7)} → ${sha.slice(0, 7)} ${changed ? '(updated)' : '(no changes)'}`
        : sha.slice(0, 7);
      this.logger.log(`[doCloneOrPull] success repo=${repoId} ${transition} files=${fileCount}`);
      return { sha };
    } catch (err: any) {
      const scrubbed = scrubSecrets(String(err?.message ?? err));
      await this.prisma.codeRepository.update({
        where: { id: repoId },
        data: {
          cloneStatus: 'error',
          lastSyncError: scrubbed.slice(0, 500),
        },
      });
      this.logger.error(`[doCloneOrPull] FAILED repo=${repoId} error="${scrubbed}"`);
      throw new Error(scrubbed);
    }
  }
}
