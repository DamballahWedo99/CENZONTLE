import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { VaultConfigService } from './vault-config.service';
import { scrubSecrets } from '../../common/utils/scrub-secrets.util';
import simpleGit from 'simple-git';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import type { VaultCloneStatus } from '@prisma/client';

export interface ActiveVaultCloneInfo {
  id: string;
  name: string;
  absolutePath: string;
  branch: string;
}

export interface VaultCloneStatusInfo {
  status: VaultCloneStatus;
  lastPulledAt: Date | null;
  sha: string | null;
  error: string | null;
}

/**
 * Gestiona los clones locales del Vault (repos GitHub de markdown) en disco.
 *
 * Estrategia idéntica a CodeRepoCloneService:
 * - Un directorio por vault: {VAULT_REPOS_DIR}/{vaultId}/
 * - Clone con --depth 1 --single-branch para ahorrar disco
 * - Mutex por vaultId para serializar git pull / git clone simultáneos
 * - Token NUNCA loggeado: scrubSecrets() antes de cualquier log/throw
 * - Symlinks deshabilitados en clone (core.symlinks=false) — git deposita symlinks
 *   como archivos de texto con el target como contenido, eliminando el vector
 *   CWE-59 que permitiría que un repo malicioso escape del dir del clon.
 *
 * DIFERENCIA clave vs CodeRepoCloneService: Vault es read-write (el usuario
 * crea/edita epics/stories via VaultService.writeNote). Por eso:
 * - scheduleClone() se dispara tras cada writeNote/deleteNote exitoso
 *   (wiring en VaultService), no solo en create de VaultConfig
 * - getEnabled() retorna 1 elemento hoy (VaultConfig.isActive es exclusivo)
 *   pero la shape del array soporta futuro multi-active sin cambios
 */
@Injectable()
export class VaultCloneService implements OnModuleInit {
  private readonly logger = new Logger(VaultCloneService.name);
  private readonly reposDir: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly configService: VaultConfigService,
  ) {
    // Default bajo $HOME porque `/var/` requiere root en dev (macOS/Linux) —
    // el proceso Node típicamente corre como user sin permisos para mkdir ahí.
    // En prod se debe setear `VAULT_REPOS_DIR` explícito (ej. volumen persistente).
    this.reposDir = String(
      this.config.get('VAULT_REPOS_DIR') ?? path.join(homedir(), '.cenzontle', 'vault-repos'),
    );
  }

  async onModuleInit() {
    await fs.mkdir(this.reposDir, { recursive: true }).catch((err) => {
      this.logger.warn(`Failed to create reposDir ${this.reposDir}: ${err.message}`);
    });
  }

  /**
   * Retorna info del vault activo con clone ready. Hoy VaultConfig.isActive
   * es exclusivo, así que retorna 0-1 element. Shape-ready para futuro multi-active.
   */
  async getEnabled(): Promise<ActiveVaultCloneInfo[]> {
    const vaults = await this.prisma.vaultConfig.findMany({
      where: { isActive: true, cloneStatus: 'ready' },
      orderBy: { name: 'asc' },
    });
    return vaults.map((v) => ({
      id: v.id,
      name: v.name,
      absolutePath: this.repoPath(v.id),
      branch: v.branch,
    }));
  }

  /**
   * Construye un mensaje diagnóstico para las tools del agente cuando
   * `getEnabled()` retorna vacío. Distingue entre "no hay ninguno activo"
   * y "hay activos pero su clone no está ready" — caso común cuando el
   * usuario configuró un vault pero el clone inicial quedó en `pending`
   * o `error`.
   */
  async getDiagnosticMessage(): Promise<string> {
    const active = await this.prisma.vaultConfig.findMany({
      where: { isActive: true },
      select: { name: true, cloneStatus: true, lastSyncError: true },
    });
    if (active.length === 0) {
      return 'No hay Vaults habilitados. Configura y activa uno en Settings → Vault.';
    }
    const details = active.map((v) => {
      if (v.cloneStatus === 'cloning') {
        return `"${v.name}" se está sincronizando ahora — intenta de nuevo en unos segundos`;
      }
      if (v.cloneStatus === 'error') {
        return `"${v.name}" falló al sincronizar (${v.lastSyncError ?? 'sin detalle'}) — ve a Settings → Vault y presiona "Sincronizar"`;
      }
      if (v.cloneStatus === 'pending') {
        return `"${v.name}" aún no se ha clonado — ve a Settings → Vault y presiona "Sincronizar"`;
      }
      if (v.cloneStatus === 'stale') {
        return `"${v.name}" está desactualizado — ve a Settings → Vault y presiona "Sincronizar"`;
      }
      return `"${v.name}" tiene estado "${v.cloneStatus}"`;
    });
    return `El Vault activo no está listo: ${details.join('; ')}.`;
  }

  /**
   * Busca un vault enabled por nombre — para el parámetro `vault` de las tools
   * cuando hay múltiples enabled (futuro) o el agente quiere scope explícito.
   */
  async getEnabledByName(name: string): Promise<ActiveVaultCloneInfo | null> {
    const vault = await this.prisma.vaultConfig.findFirst({
      where: { name, isActive: true, cloneStatus: 'ready' },
    });
    if (!vault) return null;
    return {
      id: vault.id,
      name: vault.name,
      absolutePath: this.repoPath(vault.id),
      branch: vault.branch,
    };
  }

  /**
   * Fire-and-forget: programa un clone en background. Actualiza DB con status.
   * Usado por: create/update/activate del controller, Y por VaultService
   * tras cada writeNote/deleteNote para invalidar el clone inmediatamente.
   */
  scheduleClone(vaultId: string): void {
    void this.withLock(vaultId, async () => {
      try {
        await this.doCloneOrPull(vaultId);
      } catch (err: any) {
        this.logger.warn(`[scheduleClone] failed for ${vaultId}: ${scrubSecrets(err.message ?? String(err))}`);
      }
    });
  }

  /**
   * Si el clone es más viejo que maxAgeMs, hace git pull. Bloquea hasta terminar.
   * Si el clone está en 'pending'/'error'/'stale', intenta clonar desde cero.
   */
  async ensureFresh(vaultId: string, maxAgeMs: number): Promise<void> {
    const vault = await this.prisma.vaultConfig.findUnique({ where: { id: vaultId } });
    if (!vault) throw new Error(`Vault ${vaultId} not found`);

    const needsClone = vault.cloneStatus !== 'ready';
    const isStale = !needsClone && (!vault.lastPulledAt || Date.now() - vault.lastPulledAt.getTime() > maxAgeMs);

    if (!needsClone && !isStale) return;

    await this.withLock(vaultId, () => this.doCloneOrPull(vaultId));
  }

  /**
   * Sync manual desde UI. Devuelve resultado (no lanza para que controller
   * lo pueda retornar como JSON normal).
   */
  async syncNow(vaultId: string): Promise<{ ok: boolean; sha?: string; message?: string }> {
    try {
      const { sha } = await this.withLock(vaultId, () => this.doCloneOrPull(vaultId));
      return { ok: true, sha };
    } catch (err: any) {
      return { ok: false, message: scrubSecrets(err?.message ?? String(err)) };
    }
  }

  /**
   * Wipe del clone. No lanza: loggea warning si no puede borrar.
   */
  async removeClone(vaultId: string): Promise<void> {
    await this.withLock(vaultId, async () => {
      try {
        await fs.rm(this.repoPath(vaultId), { recursive: true, force: true });
        this.logger.log(`[removeClone] ${vaultId}`);
      } catch (err: any) {
        this.logger.warn(`[removeClone] failed for ${vaultId}: ${err.message}`);
      }
    });
  }

  async getStatus(vaultId: string): Promise<VaultCloneStatusInfo> {
    const vault = await this.prisma.vaultConfig.findUnique({ where: { id: vaultId } });
    if (!vault) throw new Error(`Vault ${vaultId} not found`);
    return {
      status: vault.cloneStatus,
      lastPulledAt: vault.lastPulledAt,
      sha: vault.lastSyncedSha,
      error: vault.lastSyncError,
    };
  }

  // ─── Private ───

  private async withLock<T>(vaultId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(vaultId);
    if (existing) await existing;
    let resolve!: () => void;
    const p = new Promise<void>((r) => (resolve = r));
    this.locks.set(vaultId, p);
    try {
      return await fn();
    } finally {
      this.locks.delete(vaultId);
      resolve();
    }
  }

  private authUrl(owner: string, repo: string, token: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  /**
   * URL sin credenciales — se persiste en `.git/config` del clon para evitar
   * filtrar el PAT en disco (donde herramientas del agente pueden leerlo).
   */
  private cleanUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}.git`;
  }

  private repoPath(vaultId: string): string {
    const resolved = path.resolve(this.reposDir, vaultId);
    const reposRoot = path.resolve(this.reposDir);
    if (resolved !== reposRoot && !resolved.startsWith(reposRoot + path.sep)) {
      throw new Error(`Path escape detected for vaultId ${vaultId}`);
    }
    return resolved;
  }

  /**
   * Core: clona si no existe, o hace git fetch + reset si existe.
   * Debe llamarse DENTRO de withLock(vaultId, ...) para evitar races.
   */
  private async doCloneOrPull(vaultId: string): Promise<{ sha: string }> {
    const resolved = await this.configService.getByIdWithToken(vaultId);
    if (!resolved) {
      throw new Error(`Vault ${vaultId} not found or missing token`);
    }
    const { config, token } = resolved;
    const dest = this.repoPath(vaultId);

    await this.prisma.vaultConfig.update({
      where: { id: vaultId },
      data: { cloneStatus: 'cloning', lastSyncError: null },
    });

    try {
      const hasGitDir = await fs
        .access(path.join(dest, '.git'))
        .then(() => true)
        .catch(() => false);

      const authUrl = this.authUrl(config.owner, config.repo, token);
      const cleanUrl = this.cleanUrl(config.owner, config.repo);

      if (hasGitDir) {
        const git = simpleGit(dest);
        // Defensa en profundidad: si un clon previo persistió el PAT en
        // `.git/config`, lo reescribimos antes de cualquier operación.
        // fetch(authUrl, branch) pasa la URL como argumento de línea de
        // comando — NO se persiste en config.
        await git.remote(['set-url', 'origin', cleanUrl]);
        await git.fetch(authUrl, config.branch);
        await git.checkout(config.branch);
        await git.reset(['--hard', `origin/${config.branch}`]);
      } else {
        // Fresh clone: --depth 1 ahorra disco; --single-branch solo trae branch configurado.
        // `core.symlinks=false` evita que git materialice symlinks commiteados como symlinks
        // reales — los deposita como archivos de texto con el target como contenido. Elimina
        // CWE-59 al no permitir que un repo malicioso cree enlaces fuera del dir del clon.
        //
        // Crítico: `git clone <authUrl>` persiste la URL completa (con el PAT en plaintext)
        // en `.git/config` bajo [remote "origin"]. Reescribimos el remote a la URL sin
        // credenciales para no dejar el token en disco. Operaciones posteriores (fetch/pull)
        // recibirán el authUrl como argumento explícito sin persistirlo.
        //
        // Race cleanup: si `remote set-url` falla (disco lleno, SIGKILL, error transitorio)
        // después de que el clone escribió el PAT en .git/config, limpiamos el directorio
        // entero para no dejar credenciales en disco. El catch exterior maneja el DB state.
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

      await this.prisma.vaultConfig.update({
        where: { id: vaultId },
        data: {
          cloneStatus: 'ready',
          clonedAtPath: dest,
          lastPulledAt: new Date(),
          lastSyncedSha: sha,
          lastSyncError: null,
        },
      });

      this.logger.log(`[doCloneOrPull] ${vaultId} ready at ${sha.slice(0, 7)}`);
      return { sha };
    } catch (err: any) {
      const scrubbed = scrubSecrets(String(err?.message ?? err));
      await this.prisma.vaultConfig.update({
        where: { id: vaultId },
        data: {
          cloneStatus: 'error',
          lastSyncError: scrubbed.slice(0, 500),
        },
      });
      throw new Error(scrubbed);
    }
  }
}
