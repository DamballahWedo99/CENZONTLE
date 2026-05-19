import 'dotenv/config';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { VaultConfigService } from './vault-config.service';
import { VaultCloneService } from './vault-clone.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface VaultNote {
  path: string;
  content: string;
  sha: string;
  updatedAt: string | null;
}

export interface VaultTreeNode {
  path: string;        // Full path relative to repo root
  name: string;        // Leaf segment (filename or folder name)
  type: 'file' | 'folder';
  size?: number;       // Only for files
  sha: string;
  children?: VaultTreeNode[];  // Only for folders
}

export interface VaultConfigInfo {
  owner: string;
  repo: string;
  branch: string;
  connected: boolean;
}

/**
 * Context resuelto del vault activo — owner, repo, branch y Octokit authenticado.
 * Se cachea en memoria por ~30s para evitar hit a PG y desencripción del token
 * en cada request. Se invalida cuando el usuario cambia el vault activo o edita
 * el token del activo via el controller (ver `invalidateActiveConfig()`).
 */
interface ActiveContext {
  configId: string;  // ID del VaultConfig activo — usado para scheduleClone tras writes
  owner: string;
  repo: string;
  branch: string;
  octokit: Octokit;
  expiresAt: number;
}

/**
 * Servicio principal del vault. Autentica contra GitHub usando el vault
 * actualmente activo en `VaultConfigService`. Los métodos públicos son
 * idénticos a la versión anterior — los callers no notan el cambio.
 */
@Injectable()
export class VaultService {
  private readonly cache = new Map<string, { note: VaultNote; expiresAt: number }>();
  private readonly cacheTtlMs = 60_000; // 60 segundos por nota
  private readonly configCacheTtlMs = 30_000; // 30 segundos por context activo
  private activeContext: ActiveContext | null = null;

  constructor(
    private readonly vaultConfigs: VaultConfigService,
    // forwardRef por seguridad: VaultCloneService depende de VaultConfigService
    // (igual que nosotros), no hay ciclo real hoy pero el forwardRef protege
    // contra futuros cambios que lo introduzcan.
    @Inject(forwardRef(() => VaultCloneService))
    private readonly vaultClone: VaultCloneService,
    @InjectPinoLogger(VaultService.name) private readonly logger: PinoLogger,
  ) {
    this.logger.info('[ctor] VaultService initialized (dynamic config via VaultConfigService)');
  }

  /**
   * Resuelve el context del vault activo (owner/repo/branch/octokit).
   * Cachea por 30s para minimizar hits a PG y operaciones criptográficas.
   * Lanza si no hay vault activo configurado.
   */
  private async getContext(): Promise<ActiveContext> {
    if (this.activeContext && this.activeContext.expiresAt > Date.now()) {
      return this.activeContext;
    }

    const active = await this.vaultConfigs.getActiveWithToken();
    if (!active) {
      throw new InternalServerErrorException(
        'No hay vault activo configurado. Agrega uno desde Settings → Vault.',
      );
    }

    const ctx: ActiveContext = {
      configId: active.config.id,
      owner: active.config.owner,
      repo: active.config.repo,
      branch: active.config.branch,
      octokit: new Octokit({ auth: active.token }),
      expiresAt: Date.now() + this.configCacheTtlMs,
    };
    this.activeContext = ctx;
    this.logger.info({ owner: ctx.owner, repo: ctx.repo, branch: ctx.branch }, `[getContext] refreshed context for ${ctx.owner}/${ctx.repo}@${ctx.branch}`);
    return ctx;
  }

  /**
   * Invalida el cache del context activo. Debe llamarse cuando cambia el vault
   * activo o cuando se edita el token del activo (vía VaultConfigController).
   * También limpia el cache de notas porque el repo puede haber cambiado.
   */
  invalidateActiveConfig(): void {
    this.activeContext = null;
    this.cache.clear();
    this.logger.info('[invalidateActiveConfig] cleared active context + note cache');
  }

  /**
   * Resuelve el context de UN vault específico por id, SIN tocar el cache del
   * activo. Usado por reads de browsing (tree/file/changelog) cuando el user
   * está navegando por el dropdown un vault distinto al vinculado — quieres
   * leer del vault elegido pero NO cambiar a dónde se escribe.
   *
   * No cachea: cada llamada hace 1 query a PG + 1 desencripción del token.
   * El uso típico es esporádico (browse manual del user), así que el costo
   * es aceptable. Si crece, agregamos un cache LRU keyed por vaultId.
   */
  private async getContextById(vaultId: string): Promise<ActiveContext> {
    const result = await this.vaultConfigs.getByIdWithToken(vaultId);
    if (!result) {
      throw new NotFoundException(
        `Vault ${vaultId} no existe o no tiene token configurado.`,
      );
    }
    return {
      configId: result.config.id,
      owner: result.config.owner,
      repo: result.config.repo,
      branch: result.config.branch,
      octokit: new Octokit({ auth: result.token }),
      expiresAt: 0, // sin caché, no nos importa
    };
  }

  /**
   * Resuelve el context: si `vaultId` viene, usa ese vault específico
   * (`getContextById`); sino, usa el activo (`getContext`). Helper interno
   * usado por todos los métodos de read parametrizables.
   */
  private async resolveContext(vaultId?: string): Promise<ActiveContext> {
    if (vaultId) return this.getContextById(vaultId);
    return this.getContext();
  }

  /**
   * Read a note from the vault. Returns null if the file does not exist.
   * Uses a short-lived in-memory cache.
   *
   * Si `vaultId` viene, lee de ese vault específico SIN tocar el cache del
   * activo (browse-mode). El cache de notas se skipea cuando se especifica
   * vaultId — el cache global está keyed solo por path, no por (path,vaultId).
   */
  async readNote(path: string, vaultId?: string): Promise<VaultNote | null> {
    // Skip cache cuando se browse otro vault — el cache no distingue entre vaults.
    if (!vaultId) {
      const cached = this.cache.get(path);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.note;
      }
    }

    try {
      const ctx = await this.resolveContext(vaultId);
      const res = await ctx.octokit.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path,
        ref: ctx.branch,
      });

      if (Array.isArray(res.data) || res.data.type !== 'file') {
        return null;
      }

      const content = Buffer.from(res.data.content, 'base64').toString('utf-8');

      // Obtener fecha del último commit que tocó este archivo
      let updatedAt: string | null = null;
      try {
        const commits = await ctx.octokit.repos.listCommits({
          owner: ctx.owner,
          repo: ctx.repo,
          sha: ctx.branch,
          path,
          per_page: 1,
        });
        if (commits.data.length > 0) {
          updatedAt = commits.data[0].commit.committer?.date ?? commits.data[0].commit.author?.date ?? null;
        }
      } catch {
        // No bloquear la lectura si falla obtener la fecha
      }

      const note: VaultNote = { path, content, sha: res.data.sha, updatedAt };

      // Solo cachear lecturas del activo (sin vaultId). Browse-mode con
      // vaultId no debe contaminar el cache global con notas de otros vaults.
      if (!vaultId) {
        this.cache.set(path, { note, expiresAt: Date.now() + this.cacheTtlMs });
      }
      return note;
    } catch (err: any) {
      if (err.status === 404) return null;
      this.logger.error({ err }, `Error reading note ${path}`);
      throw new InternalServerErrorException(`Error leyendo ${path} del vault`);
    }
  }

  /**
   * Mutex queue para serializar TODAS las operaciones de escritura al vault.
   *
   * Por que: GitHub Contents API no soporta N writes concurrentes al mismo
   * branch. Cada write commitea, invalidando el SHA del tree, y el siguiente
   * write en flight recibe 409. Con burst de 24+ writes (6 historias x 4
   * archivos), el retry no puede ganar — hay livelock: cada retry encuentra
   * que otro write acaba de invalidar el SHA de nuevo.
   *
   * Solucion: los callers siguen usando Promise.all si quieren, pero cada
   * writeNote/deleteNote espera su turno en esta queue. GitHub commita en
   * serie internamente de todos modos — no perdemos throughput real.
   *
   * Timing esperado: 24 writes x ~300ms = ~7 seg total, pero 0 errors.
   */
  private githubWriteQueue: Promise<unknown> = Promise.resolve();

  private enqueueGithubWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.githubWriteQueue.then(operation, operation);
    // Swallow errors en la cadena del queue para que un write fallido no
    // bloquee los siguientes. El caller recibe el error via el Promise returned.
    this.githubWriteQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Create or update a note in the vault. Commits the change to GitHub.
   *
   * Serializado via mutex queue (ver githubWriteQueue arriba). Los callers
   * pueden lanzar N writeNote en Promise.all, pero internamente se procesan
   * uno a la vez — GitHub los queue igual server-side, solo que aqui
   * evitamos los 409s que el paralelismo cliente-side producia.
   *
   * Retry con backoff (max 3, 200/400/800ms) se mantiene para resiliencia
   * ante writes concurrentes desde OTROS procesos/clones de la app.
   */
  async writeNote(path: string, content: string, commitMessage: string, vaultId?: string): Promise<VaultNote> {
    return this.enqueueGithubWrite(() => this.writeNoteImpl(path, content, commitMessage, vaultId));
  }

  private async writeNoteImpl(path: string, content: string, commitMessage: string, vaultId?: string): Promise<VaultNote> {
    this.logger.info({ path, length: content.length, commitMessage }, `[writeNote] path=${path} contentLen=${content.length} vaultId=${vaultId ?? 'active'} msg="${commitMessage}"`);
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const ctx = await this.resolveContext(vaultId);
        // IMPORTANTE: invalidar cache antes de re-leer en retries para forzar
        // fetch fresco del SHA (el cache puede tener el SHA viejo pre-conflict).
        // Solo cache management cuando escribimos al activo (sin vaultId).
        if (attempt > 0 && !vaultId) this.cache.delete(path);
        const existing = await this.readNote(path, vaultId);
        if (attempt === 0) {
          const existingSha = existing ? existing.sha.slice(0, 8) : null;
          this.logger.info({ path, existingSha, isNew: !existing }, `[writeNote] existing=${existingSha ?? 'NEW'}`);
        }

        const res = await ctx.octokit.repos.createOrUpdateFileContents({
          owner: ctx.owner,
          repo: ctx.repo,
          path,
          message: commitMessage,
          content: Buffer.from(content, 'utf-8').toString('base64'),
          branch: ctx.branch,
          ...(existing ? { sha: existing.sha } : {}),
        });

        const newSha = res.data.content?.sha ?? '';
        this.logger.info(
          `[writeNote] OK newSha=${newSha.slice(0, 8)}${attempt > 0 ? ` (after ${attempt} retry)` : ''}`,
        );
        const note: VaultNote = { path, content, sha: newSha, updatedAt: new Date().toISOString() };

        // Solo cachear y schedule clone para writes al activo (sin vaultId).
        // Writes a otros vaults son escasos (manual browse-mode CRUD) y no
        // deben contaminar el cache del active. El clone local se sincroniza
        // explícitamente cuando el user vincule ese vault.
        if (!vaultId) {
          this.cache.set(path, { note, expiresAt: Date.now() + this.cacheTtlMs });
          this.vaultClone.scheduleClone(ctx.configId);
        }

        return note;
      } catch (err: any) {
        // 409 Conflict: SHA expirado por commit concurrente. Retry con backoff.
        const isRetriable409 = err?.status === 409 && attempt < MAX_RETRIES;
        if (isRetriable409) {
          const backoffMs = 200 * Math.pow(2, attempt); // 200, 400, 800
          this.logger.warn(
            `[writeNote] 409 conflict on ${path}, retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        this.logger.error({ path, status: err?.status, message: err?.message }, `[writeNote] FAILED path=${path} status=${err?.status} message=${err?.message}`);
        if (err?.response?.data) {
          const scrubbed = {
            message: err.response.data?.message,
            documentation_url: err.response.data?.documentation_url,
            status: err?.status,
          };
          this.logger.error({ githubResponse: scrubbed, path }, '[writeNote] GitHub response error');
        }
        throw new InternalServerErrorException(`Error escribiendo ${path} al vault`);
      }
    }

    // Inalcanzable (el loop retorna o throws) pero TypeScript lo exige.
    throw new InternalServerErrorException(`Error escribiendo ${path} al vault (retries exhausted)`);
  }

  /**
   * Delete a note from the vault. Fails silently if the note doesn't exist.
   * Serializado via mutex queue (ver writeNote) + retry con backoff ante 409.
   */
  async deleteNote(path: string, commitMessage: string, vaultId?: string): Promise<void> {
    return this.enqueueGithubWrite(() => this.deleteNoteImpl(path, commitMessage, vaultId));
  }

  private async deleteNoteImpl(path: string, commitMessage: string, vaultId?: string): Promise<void> {
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const ctx = await this.resolveContext(vaultId);
        if (attempt > 0 && !vaultId) this.cache.delete(path);
        const existing = await this.readNote(path, vaultId);
        if (!existing) {
          this.logger.warn({ path }, `Attempted to delete non-existent note: ${path}`);
          return;
        }

        await ctx.octokit.repos.deleteFile({
          owner: ctx.owner,
          repo: ctx.repo,
          path,
          message: commitMessage,
          sha: existing.sha,
          branch: ctx.branch,
        });

        if (attempt > 0) {
          this.logger.info({ path, attempt }, `[deleteNote] OK ${path} (after ${attempt} retry) vaultId=${vaultId ?? 'active'}`);
        }
        // Solo invalidar cache + schedule clone para writes al activo.
        if (!vaultId) {
          this.cache.delete(path);
          this.vaultClone.scheduleClone(ctx.configId);
        }
        return;
      } catch (err: any) {
        if (err.status === 404) return;

        const isRetriable409 = err?.status === 409 && attempt < MAX_RETRIES;
        if (isRetriable409) {
          const backoffMs = 200 * Math.pow(2, attempt);
          this.logger.warn(
            `[deleteNote] 409 conflict on ${path}, retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        this.logger.error({ err }, `Error deleting note ${path}`);
        throw new InternalServerErrorException(`Error eliminando ${path} del vault`);
      }
    }

    throw new InternalServerErrorException(`Error eliminando ${path} del vault (retries exhausted)`);
  }

  /**
   * List notes in a folder (non-recursive).
   * Si `vaultId` viene, lee de ese vault específico (browse-mode).
   */
  async listNotes(folder: string, vaultId?: string): Promise<string[]> {
    try {
      const ctx = await this.resolveContext(vaultId);
      const res = await ctx.octokit.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path: folder,
        ref: ctx.branch,
      });

      if (!Array.isArray(res.data)) return [];

      return res.data
        .filter((item) => item.type === 'file' && item.name.endsWith('.md'))
        .map((item) => item.path);
    } catch (err: any) {
      if (err.status === 404) return [];
      this.logger.error({ err }, `Error listing folder ${folder}`);
      throw new InternalServerErrorException(`Error listando ${folder} del vault`);
    }
  }

  /**
   * Invalidate all cached entries. Useful after bulk operations.
   */
  invalidateCache(path?: string) {
    if (path) {
      this.cache.delete(path);
    } else {
      this.cache.clear();
    }
  }

  /**
   * List the full tree (recursive) rooted at a given folder.
   * Uses GitHub's Git Tree API (`/git/trees/{sha}?recursive=1`) which returns
   * the entire repo tree in a single request, then filters to the subpath.
   *
   * This is O(1) requests regardless of tree size, vs O(N) with getContent.
   *
   * Si `vaultId` viene, lee de ese vault específico (browse-mode sin tocar el activo).
   */
  async listTree(folder: string, vaultId?: string): Promise<VaultTreeNode[]> {
    try {
      const ctx = await this.resolveContext(vaultId);
      // 1. Get the SHA of the branch head
      const branchRes = await ctx.octokit.repos.getBranch({
        owner: ctx.owner,
        repo: ctx.repo,
        branch: ctx.branch,
      });
      const treeSha = branchRes.data.commit.commit.tree.sha;

      // 2. Get the full recursive tree
      const treeRes = await ctx.octokit.git.getTree({
        owner: ctx.owner,
        repo: ctx.repo,
        tree_sha: treeSha,
        recursive: 'true',
      });

      if (treeRes.data.truncated) {
        this.logger.warn(
          `[listTree] GitHub tree response truncated (>100k entries or >7MB). Some files may be missing.`,
        );
      }

      // 3. Normalize folder prefix (strip trailing slash, handle empty = root)
      const prefix = folder.replace(/\/+$/, '');
      const prefixWithSlash = prefix ? `${prefix}/` : '';

      // 4. Filter entries under the folder and build a nested structure
      type FlatEntry = { path: string; relativePath: string; type: 'file' | 'folder'; sha: string; size?: number };
      const flat: FlatEntry[] = [];
      for (const entry of treeRes.data.tree) {
        if (!entry.path || !entry.sha) continue;
        // Include entries inside the folder (or all entries when folder is '')
        if (prefix && !entry.path.startsWith(prefixWithSlash)) continue;
        if (prefix && entry.path === prefix) continue; // skip the folder itself

        const relativePath = prefix ? entry.path.slice(prefixWithSlash.length) : entry.path;
        const type: 'file' | 'folder' = entry.type === 'tree' ? 'folder' : 'file';

        flat.push({
          path: entry.path,
          relativePath,
          type,
          sha: entry.sha,
          size: entry.size,
        });
      }

      // 5. Build a nested tree from the flat list
      return this.buildNestedTree(flat);
    } catch (err: any) {
      if (err.status === 404) return [];
      this.logger.error({ err }, `Error listing tree for ${folder}`);
      throw new InternalServerErrorException(`Error listando árbol del vault`);
    }
  }

  /**
   * Convert a flat list of paths into a nested VaultTreeNode structure.
   * Children are sorted: folders first (alphabetical), then files (alphabetical).
   */
  private buildNestedTree(
    flat: { path: string; relativePath: string; type: 'file' | 'folder'; sha: string; size?: number }[],
  ): VaultTreeNode[] {
    // Map from relative path → node, so children can find parents.
    const nodeMap = new Map<string, VaultTreeNode>();
    const roots: VaultTreeNode[] = [];

    // First pass: create every node
    for (const entry of flat) {
      const segments = entry.relativePath.split('/');
      const name = segments[segments.length - 1];
      const node: VaultTreeNode = {
        path: entry.path,
        name,
        type: entry.type,
        sha: entry.sha,
        ...(entry.type === 'file' ? { size: entry.size } : { children: [] }),
      };
      nodeMap.set(entry.relativePath, node);
    }

    // Second pass: wire parent/child relationships
    for (const entry of flat) {
      const node = nodeMap.get(entry.relativePath);
      if (!node) continue;
      const segments = entry.relativePath.split('/');
      if (segments.length === 1) {
        roots.push(node);
      } else {
        const parentRelative = segments.slice(0, -1).join('/');
        const parent = nodeMap.get(parentRelative);
        if (parent?.children) {
          parent.children.push(node);
        } else {
          // Orphan: GitHub returned a file whose parent folder isn't in the tree
          // (can happen when a folder has no explicit 'tree' entry, only files).
          // Promote to root in that case.
          roots.push(node);
        }
      }
    }

    // Sort: folders first, then files, both alphabetical
    const sortChildren = (nodes: VaultTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'es');
      });
      for (const n of nodes) {
        if (n.children) sortChildren(n.children);
      }
    };
    sortChildren(roots);

    return roots;
  }

  /**
   * Lista los commits más recientes del vault. Cada commit representa un cambio
   * (create, update, delete) que se hizo al vault. Es el changelog natural del vault
   * porque cada writeNote/deleteNote genera un commit con un mensaje descriptivo.
   */
  async listCommits(limit = 30, path?: string, vaultId?: string): Promise<Array<{
    sha: string;
    message: string;
    authorName: string;
    date: string;
    files: Array<{ filename: string; status: string }>;
  }>> {
    try {
      const ctx = await this.resolveContext(vaultId);
      const res = await ctx.octokit.repos.listCommits({
        owner: ctx.owner,
        repo: ctx.repo,
        sha: ctx.branch,
        per_page: limit,
        ...(path ? { path } : {}),
      });

      return res.data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        authorName: c.commit.author?.name || 'Unknown',
        date: c.commit.author?.date || '',
        // listCommits no incluye files — eso requiere getCommit individual.
        // Parseamos el path del commit message para evitar N+1 requests.
        files: [],
      }));
    } catch (err: any) {
      if (err.status === 404) return [];
      this.logger.error('Error listing commits', err);
      return [];
    }
  }

  /**
   * Obtiene el detalle de un commit individual, incluyendo el patch (diff) de cada archivo.
   * Se usa para cargar el "antes/después" de un changelog entry lazily al seleccionarlo.
   */
  async getCommitDetail(sha: string, vaultId?: string): Promise<{
    sha: string;
    message: string;
    authorName: string;
    date: string;
    beforeContent: string | null;
    afterContent: string | null;
    filename: string | null;
  } | null> {
    try {
      const ctx = await this.resolveContext(vaultId);
      const res = await ctx.octokit.repos.getCommit({
        owner: ctx.owner,
        repo: ctx.repo,
        ref: sha,
      });

      // Tomar el primer archivo .md del commit (la mayoría de commits del vault tocan 1 solo archivo)
      const mdFile = (res.data.files || []).find((f) => f.filename?.endsWith('.md'));
      if (!mdFile?.filename) {
        return {
          sha: res.data.sha,
          message: res.data.commit.message,
          authorName: res.data.commit.author?.name || 'Unknown',
          date: res.data.commit.author?.date || '',
          beforeContent: null,
          afterContent: null,
          filename: null,
        };
      }

      // Obtener el contenido "después" (en este commit)
      let afterContent: string | null = null;
      try {
        const afterRes = await ctx.octokit.repos.getContent({
          owner: ctx.owner, repo: ctx.repo, path: mdFile.filename, ref: sha,
        });
        if (!Array.isArray(afterRes.data) && afterRes.data.type === 'file') {
          afterContent = Buffer.from(afterRes.data.content, 'base64').toString('utf-8');
        }
      } catch { /* archivo puede haber sido eliminado en este commit */ }

      // Obtener el contenido "antes" (en el commit padre)
      let beforeContent: string | null = null;
      const parentSha = res.data.parents?.[0]?.sha;
      if (parentSha) {
        try {
          const beforeRes = await ctx.octokit.repos.getContent({
            owner: ctx.owner, repo: ctx.repo, path: mdFile.filename, ref: parentSha,
          });
          if (!Array.isArray(beforeRes.data) && beforeRes.data.type === 'file') {
            beforeContent = Buffer.from(beforeRes.data.content, 'base64').toString('utf-8');
          }
        } catch { /* archivo no existía antes de este commit (es nuevo) */ }
      }

      return {
        sha: res.data.sha,
        message: res.data.commit.message,
        authorName: res.data.commit.author?.name || 'Unknown',
        date: res.data.commit.author?.date || '',
        beforeContent,
        afterContent,
        filename: mdFile.filename,
      };
    } catch (err: any) {
      if (err.status === 404) return null;
      this.logger.error({ err }, `Error fetching commit ${sha}`);
      return null;
    }
  }

  /**
   * Return public-facing vault configuration info from the active vault.
   * Never exposes the token.
   */
  async getConfigInfo(): Promise<VaultConfigInfo> {
    try {
      const ctx = await this.getContext();
      return {
        owner: ctx.owner,
        repo: ctx.repo,
        branch: ctx.branch,
        connected: true,
      };
    } catch {
      return { owner: '', repo: '', branch: '', connected: false };
    }
  }
}
