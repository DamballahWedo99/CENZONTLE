import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubService } from '../github/github.service';
import * as net from 'net';

/**
 * Preview state lifecycle:
 *   starting → running ─→ stopped
 *      └──── error ─────┘
 *
 * `starting`: clone + install en curso, todavía no hay puerto bindeado
 * `running`: dev server escuchando, `url` es accesible
 * `stopped`: el operador llamó stop o el proceso murió
 * `error`: clone falló, npm install falló, dev server crasheó
 */
export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'error';

interface PreviewInstance {
  batchId: string;
  status: PreviewStatus;
  port: number;
  url: string;
  workdir: string;
  pid: number | null;
  process: ChildProcess | null;
  startedAt: Date;
  branch: string;
  /** SHA del commit que se hizo checkout post-clone. Solo set cuando usamos
   *  el fallback de SHA (la integration branch ya no existe en remote). El
   *  preview muestra el snapshot exacto del epic en ese SHA. */
  commitSha?: string;
  projectType: 'static' | 'node';
  error?: string;
  logs: string[]; // últimas N lines del stdout/stderr para diagnóstico
}

/**
 * Discriminated union de la fuente del preview. Se resuelve en cascada:
 *   - `branch`: la integration branch existe en remote, clone directo de ella.
 *   - `sha`: la branch ya no existe, clone de `devBranch` + checkout del SHA.
 *
 * El segundo caso surge tras el cleanup automático post-merge (fix 2026-05-17)
 * — el SHA viene de `epic.consolidatedMergeSha` (preferido) o lookup vía
 * GitHub PR API si la DB no tenía el SHA (epics legacy pre-deploy).
 */
type PreviewSource =
  | { kind: 'branch'; branch: string }
  | { kind: 'sha'; sha: string; devBranch: string; source: 'db' | 'pr_api' };

/**
 * Manage local dev server previews para sprint-batch branches. Clona el
 * branch a tmpdir, detecta el tipo de proyecto, spawnea el dev server
 * apropiado (`pnpm dev` para Node, `npx serve` para static HTML), y retorna
 * la URL para que el frontend la abra en otra tab.
 *
 * SECURITY: ejecuta código untrusted del agente (los HTML/scripts del
 * sprint batch). Diseñado para LOCAL DEV solo — en producción debería
 * correrse sandboxed o en container aislado. Spawn args usan shell=false
 * + args array para evitar command injection.
 *
 * STATE: en memoria. Restart del API pierde todos los previews — el
 * operador puede re-triggerlos manualmente. Para multi-instance setups
 * en producción habría que persistir en DB + soportar coordination.
 */
@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  /**
   * Map<batchId, PreviewInstance>. Concurrent previews permitidos (1 por
   * batchId; calling start sobre un batch con preview running retorna 409).
   * Total cap: 10 previews concurrentes para evitar agotar ports.
   */
  private readonly previews = new Map<string, PreviewInstance>();

  /**
   * Port allocation: range [9000, 9099]. Cada preview reserva 1 port.
   * Si se agotan, start tira BadRequestException. En la práctica con cap
   * de 10 nunca se agota.
   */
  private readonly PORT_MIN = 9000;
  private readonly PORT_MAX = 9099;

  /**
   * Timeout máximo para que el dev server bindee al puerto tras spawn.
   * 60s cubre `pnpm install` + dev server boot. Si excede → mark error.
   */
  private readonly READY_TIMEOUT_MS = 60_000;

  /**
   * Cap del log buffer (últimas N líneas conservadas para diagnóstico vía
   * GET /preview). 100 líneas balance entre forensics y memoria.
   */
  private readonly LOG_BUFFER_LINES = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
  ) {}

  /**
   * Spawn el preview de un batch. Retorna inmediatamente con status='starting'
   * — el caller puede polling GET /preview para esperar 'running'.
   *
   * Idempotencia: si ya hay preview para este batchId, retorna el existente
   * (status='running') o tira 409 si está starting/error (operador debe stop
   * primero o esperar el outcome).
   */
  async startPreview(batchId: string): Promise<PreviewInstance> {
    const existing = this.previews.get(batchId);
    if (existing) {
      if (existing.status === 'running') {
        this.logger.log(
          `[preview:${batchId}] Reusing existing preview — already running at ${existing.url}`,
        );
        return existing;
      }
      if (existing.status === 'starting') {
        throw new BadRequestException(
          `Preview ya está iniciando para batch ${batchId}. Esperá a que termine (poll GET /preview) o cancelalo con DELETE /preview.`,
        );
      }
      // 'stopped' o 'error': permitimos re-start. Limpiamos el stale antes.
      this.previews.delete(batchId);
    }

    // Lookup batch + branch + repo info.
    // El worker nombra las branches como `forge/sprint-batch-<epicId.slice(0,8)>`
    // (NO batchId.slice). epicId y batchId son UUIDs DISTINTOS:
    //   - Epic.id          → UUID del epic, usado para naming branches
    //   - Epic.enqueuedBatchId → UUID asignado al encolar, usado en URLs UI
    // Antes asumía incorrectamente que batchId.slice(0,8) daba el branch name,
    // pero solo coincidiría por casualidad cuando los UUIDs random tuvieran
    // prefijo igual. Fix 2026-05-16: usar epic.id.slice(0,8) authoritativamente.
    const epic = await this.prisma.epic.findFirst({
      where: { enqueuedBatchId: batchId },
      select: {
        id: true,
        title: true,
        // Defense-in-depth para preview post-cleanup (2026-05-18): cuando la
        // integration branch ya fue borrada por el cleanup automático, usamos
        // estos campos como fallback para recuperar el snapshot del epic en
        // su merge. Ver `resolvePreviewSource` abajo.
        consolidatedMergeSha: true,
        consolidatedPrNumber: true,
      },
    });
    if (!epic) {
      throw new NotFoundException(`No se encontró epic con batchId=${batchId}`);
    }
    const branch = `forge/sprint-batch-${epic.id.slice(0, 8)}`;
    this.logger.log(
      {
        event: 'preview.branch_name_resolved',
        batchId,
        epicId: epic.id,
        epicIdShort: epic.id.slice(0, 8),
        branch,
      },
      `[preview:${batchId}] resolved branch from epic — epicId=${epic.id.slice(0, 8)} → branch=${branch}`,
    );

    // Resolve clone URL desde GitHubService. `getCloneUrl()` retorna la URL
    // CON el token embebido (formato `https://x-access-token:TOKEN@github.com/...`),
    // requerido para `git clone` no-interactivo. Si usáramos `getRepoCredentials()`
    // que devuelve URL sin token, git intentaría auth interactiva y fallaría
    // con exit 128 (auth failed silently).
    let cloneUrl: string;
    try {
      const clone = await this.github.getCloneUrl();
      cloneUrl = clone.cloneUrl;
    } catch (err) {
      throw new BadRequestException(
        `No se pudo resolver clone URL del repo: ${(err as Error).message}`,
      );
    }

    // Cascada de resolución de fuente del preview (defense-in-depth post-fix
    // del cleanup automático de branches 2026-05-17):
    //
    //   1. Branch viva en GitHub → usar la branch directamente (path actual,
    //      sin cambios — fast-path para previews pre-merge).
    //   2. Branch borrada + `epic.consolidatedMergeSha` set → clone dev +
    //      checkout SHA. Snapshot exacto del epic en su merge.
    //   3. Branch borrada + `epic.consolidatedPrNumber` set (sin SHA en DB,
    //      caso retro-compat para epics mergeados antes de este deploy) →
    //      lookup PR via GitHub API → usar `merge_commit_sha`.
    //   4. Nada disponible → 404 con razón específica (probablemente epic
    //      cuyas stories fallaron DoD repetidamente y nunca pushaeron).
    const previewSource = await this.resolvePreviewSource(batchId, branch, epic);

    // Allocate port
    const port = this.allocatePort();
    if (port === null) {
      throw new BadRequestException(
        `No hay puertos disponibles en rango [${this.PORT_MIN}, ${this.PORT_MAX}]. ` +
          `Hay ${this.previews.size} previews activos — stoppealos antes de iniciar uno nuevo.`,
      );
    }

    // Reserve tmpdir
    const workdir = await fs.mkdtemp(join(tmpdir(), `cenzontle-preview-${batchId.slice(0, 8)}-`));

    // Instance inicial — status='starting'. Cuando usamos el fallback SHA,
    // persistimos el SHA en `commitSha` para que el status del preview lo
    // exponga al UI (operador puede ver que el preview es del estado post-merge).
    const instance: PreviewInstance = {
      batchId,
      status: 'starting',
      port,
      url: `http://localhost:${port}`,
      workdir,
      pid: null,
      process: null,
      startedAt: new Date(),
      branch,
      commitSha: previewSource.kind === 'sha' ? previewSource.sha : undefined,
      projectType: 'static',
      logs: [],
    };
    this.previews.set(batchId, instance);

    this.logger.log(
      `[preview:${batchId}] Starting preview: branch=${branch}${instance.commitSha ? ` @ ${instance.commitSha.slice(0, 7)}` : ''} port=${port} workdir=${workdir}`,
    );

    // Spawn async: clone + detect + spawn server. NO await acá — return
    // inmediato con status='starting'. El caller pollea status.
    this.spawnPreviewAsync(instance, cloneUrl, previewSource).catch((err) => {
      this.logger.error(
        `[preview:${batchId}] spawnPreviewAsync threw — marking error`,
        err,
      );
      instance.status = 'error';
      instance.error = (err as Error).message;
    });

    return instance;
  }

  /**
   * Detiene el preview: kill del proceso (SIGTERM → SIGKILL fallback),
   * remove tmpdir. Idempotente — si ya está stopped, retorna ok.
   */
  async stopPreview(batchId: string): Promise<{ stopped: boolean }> {
    const instance = this.previews.get(batchId);
    if (!instance) {
      return { stopped: false };
    }

    this.logger.log(
      `[preview:${batchId}] Stopping preview (pid=${instance.pid}, port=${instance.port})`,
    );

    if (instance.process && !instance.process.killed) {
      try {
        instance.process.kill('SIGTERM');
        // SIGKILL fallback tras 5s si SIGTERM no funcionó
        setTimeout(() => {
          if (instance.process && !instance.process.killed) {
            try {
              instance.process.kill('SIGKILL');
            } catch {
              // proceso ya muerto
            }
          }
        }, 5000).unref();
      } catch (err) {
        this.logger.warn(
          `[preview:${batchId}] kill failed: ${(err as Error).message}`,
        );
      }
    }

    instance.status = 'stopped';

    // Cleanup tmpdir async (fire-and-forget — no bloquea respuesta)
    fs.rm(instance.workdir, { recursive: true, force: true }).catch((err) => {
      this.logger.warn(
        `[preview:${batchId}] cleanup tmpdir failed: ${(err as Error).message}`,
      );
    });

    this.previews.delete(batchId);
    return { stopped: true };
  }

  /**
   * Estado actual del preview. Si no existe, retorna `{ status: 'stopped' }`
   * (no 404 — más friendly para polling del UI).
   */
  getPreviewStatus(batchId: string): {
    status: PreviewStatus;
    url?: string;
    port?: number;
    branch?: string;
    commitSha?: string;
    projectType?: 'static' | 'node';
    startedAt?: Date;
    error?: string;
    logsTail?: string[];
  } {
    const instance = this.previews.get(batchId);
    if (!instance) {
      return { status: 'stopped' };
    }
    return {
      status: instance.status,
      url: instance.url,
      port: instance.port,
      branch: instance.branch,
      commitSha: instance.commitSha,
      projectType: instance.projectType,
      startedAt: instance.startedAt,
      error: instance.error,
      logsTail: instance.logs.slice(-20), // últimas 20 lines para el UI
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Resuelve la fuente del preview en cascada (defense-in-depth). Ver detalles
   * en la docstring del bloque de cascada en `startPreview` arriba.
   *
   * Throw `NotFoundException` con mensaje específico cuando ningún nivel de la
   * cascada produce una fuente válida. Throw `BadRequestException` ante
   * fallos transient del GitHub API (network, rate limit) — el caller puede
   * reintentar más tarde.
   */
  private async resolvePreviewSource(
    batchId: string,
    branch: string,
    epic: { id: string; consolidatedMergeSha: string | null; consolidatedPrNumber: number | null },
  ): Promise<PreviewSource> {
    // Nivel 1: branch viva en GitHub
    let branchHeadExists = false;
    let branchHeadSha: string | null = null;
    try {
      const branchHead = await this.github.getBranchHead(branch);
      branchHeadExists = branchHead.exists;
      branchHeadSha = branchHead.sha ?? null;
    } catch (err) {
      // Transient (network, auth, rate limit) — NO podemos resolver la cascada
      // con confianza, así que propagamos como BadRequest. El operador
      // distingue esto del 404 "no existe ni en fallbacks" por el mensaje.
      throw new BadRequestException(
        `Falla checkeando existencia de la branch ${branch}: ${(err as Error).message}`,
      );
    }
    if (branchHeadExists) {
      this.logger.log(
        {
          event: 'preview.source.resolved.branch',
          batchId,
          branch,
          headSha: branchHeadSha?.slice(0, 8) ?? null,
        },
        `[preview:${batchId}] source resolved → branch ${branch} (head=${branchHeadSha?.slice(0, 8) ?? '?'})`,
      );
      return { kind: 'branch', branch };
    }

    // Nivel 2: SHA persistido en DB tras el merge
    if (epic.consolidatedMergeSha) {
      const devBranch = await this.resolveDevBranch();
      this.logger.log(
        {
          event: 'preview.source.resolved.sha_db',
          batchId,
          branch,
          sha: epic.consolidatedMergeSha.slice(0, 8),
          devBranch,
        },
        `[preview:${batchId}] source resolved → sha ${epic.consolidatedMergeSha.slice(0, 8)} via DB (branch ${branch} ya borrada por cleanup post-merge)`,
      );
      return {
        kind: 'sha',
        sha: epic.consolidatedMergeSha,
        devBranch,
        source: 'db',
      };
    }

    // Nivel 3: lookup PR via GitHub API (retro-compat para epics mergeados
    // antes de que persistiéramos el SHA en DB)
    if (epic.consolidatedPrNumber) {
      try {
        const prStatus = await this.github.getPullRequestStatus(epic.consolidatedPrNumber);
        if (prStatus.merged && prStatus.mergeCommitSha) {
          const devBranch = await this.resolveDevBranch();
          this.logger.log(
            {
              event: 'preview.source.resolved.sha_pr_api',
              batchId,
              branch,
              prNumber: epic.consolidatedPrNumber,
              sha: prStatus.mergeCommitSha.slice(0, 8),
              devBranch,
            },
            `[preview:${batchId}] source resolved → sha ${prStatus.mergeCommitSha.slice(0, 8)} via PR #${epic.consolidatedPrNumber} (branch borrada, sin SHA en DB legacy)`,
          );
          return {
            kind: 'sha',
            sha: prStatus.mergeCommitSha,
            devBranch,
            source: 'pr_api',
          };
        }
        // PR existe pero no merged (open o closed-without-merge) — no es un
        // candidato válido para preview.
        throw new NotFoundException(
          `La branch ${branch} no existe y el PR #${epic.consolidatedPrNumber} no está merged (state=${prStatus.state}, merged=${prStatus.merged}). No hay snapshot recuperable.`,
        );
      } catch (err) {
        if (err instanceof NotFoundException) throw err;
        throw new BadRequestException(
          `Fallback PR API falló para PR #${epic.consolidatedPrNumber}: ${(err as Error).message}`,
        );
      }
    }

    // Nivel 4: nada — error de "no existe ni hay rastro"
    this.logger.warn(
      {
        event: 'preview.source.not_found',
        batchId,
        branch,
        consolidatedMergeSha: epic.consolidatedMergeSha,
        consolidatedPrNumber: epic.consolidatedPrNumber,
      },
      `[preview:${batchId}] branch ${branch} NO existe en remoto Y no hay fallback SHA/PR — abort`,
    );
    throw new NotFoundException(
      `La branch ${branch} no existe en GitHub y el epic no tiene SHA del merge ni PR consolidado para recuperar. ` +
        `Causa típica: las stories del epic fallaron DoD en todos los attempts y nunca llegaron a 'git push'. ` +
        `Revisá el panel de Stories — si todas están en estado failed/error, no hay código que previsualizar. ` +
        `Soluciones: (1) re-seedear el epic para que el agente intente de nuevo, (2) force-complete una story con código aceptable, (3) push manual del código que ya esté localmente.`,
    );
  }

  /**
   * Lee el `devBranch` de la config global (`BranchStrategyConfig` singleton).
   * Fallback a `'dev'` si la config no existe (primera ejecución de un dashboard
   * sin seed). No usamos `BranchStrategyService.getOrInitDefault()` para evitar
   * circular dep con FleetModule — el read directo de Prisma sobre la PK fija
   * `'global'` es suficiente y consistente con el patrón en `agent-run.service.ts`.
   */
  private async resolveDevBranch(): Promise<string> {
    const config = await this.prisma.branchStrategyConfig.findUnique({
      where: { id: 'global' },
      select: { devBranch: true },
    });
    return config?.devBranch ?? 'dev';
  }

  private allocatePort(): number | null {
    const usedPorts = new Set(
      Array.from(this.previews.values()).map((p) => p.port),
    );
    for (let p = this.PORT_MIN; p <= this.PORT_MAX; p++) {
      if (!usedPorts.has(p)) return p;
    }
    return null;
  }

  /**
   * Pasos async del start:
   *   1. git clone --branch <branch> <repoUrl> <workdir>
   *   2. Detectar projectType (package.json con dev script vs static)
   *   3. Spawn dev server apropiado
   *   4. Wait for port bind (polling) o timeout → error
   */
  private async spawnPreviewAsync(
    instance: PreviewInstance,
    repoUrl: string,
    source: PreviewSource,
  ): Promise<void> {
    const phaseStart = Date.now();
    this.logger.log(
      {
        event: 'preview.lifecycle.spawn_async.start',
        batchId: instance.batchId,
        branch: instance.branch,
        workdir: instance.workdir,
        port: instance.port,
        gitVersionPath: process.env.PATH ?? '(no PATH env)',
      },
      `[preview:${instance.batchId}] spawnPreviewAsync inicio — branch=${instance.branch} workdir=${instance.workdir} port=${instance.port}`,
    );

    // 0. Preflight: verificar que git está disponible en PATH. Si no, fail
    // rápido con mensaje claro en vez de exit 128 críptico del clone.
    try {
      const gitVer = await this.runCommandCapture('git', ['--version']);
      this.appendLog(instance, `[preflight] git OK — ${gitVer.stdout.trim()}`);
      // Downgrade a debug — el preflight pasa siempre en hosts saneados; solo
      // es interesante cuando falla (git_missing en error). El appendLog ya
      // captura el value para el UI del preview.
      this.logger.debug(
        {
          event: 'preview.preflight.git_version',
          batchId: instance.batchId,
          gitVersion: gitVer.stdout.trim(),
        },
        `[preview:${instance.batchId}] preflight OK — ${gitVer.stdout.trim()}`,
      );
    } catch (err) {
      const msg = `Preflight FAIL: git binary no disponible en PATH del API daemon: ${(err as Error).message}`;
      this.logger.error(
        {
          event: 'preview.preflight.git_missing',
          batchId: instance.batchId,
          path: process.env.PATH ?? '(no PATH)',
          error: (err as Error).message,
        },
        `[preview:${instance.batchId}] ${msg}`,
      );
      this.appendLog(instance, msg);
      instance.status = 'error';
      instance.error = msg;
      return;
    }

    // 1. Clone. Path branch (fast, shallow) vs path SHA (full history del
     //    devBranch + checkout) según la cascada de resolución.
    const cloneStart = Date.now();
    const sourceLabel =
      source.kind === 'branch'
        ? `branch=${source.branch}`
        : `${source.devBranch}@${source.sha.slice(0, 7)} (fallback ${source.source})`;
    this.appendLog(instance, `[clone] start ${sourceLabel}`);
    try {
      if (source.kind === 'branch') {
        await this.gitClone(repoUrl, source.branch, instance.workdir);
      } else {
        await this.gitCloneAtSha(repoUrl, source.devBranch, source.sha, instance.workdir);
      }
      const cloneMs = Date.now() - cloneStart;
      this.appendLog(instance, `[clone] OK ${sourceLabel} → ${instance.workdir} (${cloneMs}ms)`);
      this.logger.log(
        {
          event: 'preview.lifecycle.clone.success',
          batchId: instance.batchId,
          branch: instance.branch,
          commitSha: instance.commitSha ?? null,
          sourceKind: source.kind,
          workdir: instance.workdir,
          elapsedMs: cloneMs,
        },
        `[preview:${instance.batchId}] clone OK in ${cloneMs}ms (${sourceLabel})`,
      );
    } catch (err) {
      const cloneMs = Date.now() - cloneStart;
      const msg = `git clone failed: ${(err as Error).message}`;
      // Log estructurado adicional al de gitClone() — ese ya loguea detalle de
      // stderr/stdout, este es el wrapper del lifecycle del preview.
      this.logger.error(
        {
          event: 'preview.lifecycle.clone.failed',
          batchId: instance.batchId,
          branch: instance.branch,
          workdir: instance.workdir,
          elapsedMs: cloneMs,
          errorMessage: (err as Error).message,
        },
        `[preview:${instance.batchId}] ${msg}`,
      );
      this.appendLog(instance, `[clone] ${msg}`);
      instance.status = 'error';
      instance.error = msg;
      // Cleanup del tmpdir vacío (mkdtemp lo creó pero git falló antes de
      // escribir adentro). Sin esto se acumulan tmpdirs huérfanos en /tmp.
      // Fire-and-forget — si falla el rm, no es crítico, el OS lo eventually
      // limpia en /tmp/ rotation. Solo loguear como warn.
      fs.rm(instance.workdir, { recursive: true, force: true })
        .then(() => {
          this.logger.debug(
            { event: 'preview.cleanup.empty_tmpdir', batchId: instance.batchId, workdir: instance.workdir },
            `[preview:${instance.batchId}] cleaned up empty tmpdir post-clone-fail`,
          );
        })
        .catch((rmErr) => {
          this.logger.warn(
            { event: 'preview.cleanup.failed', batchId: instance.batchId, error: (rmErr as Error).message },
            `[preview:${instance.batchId}] cleanup post-fail falló (non-critical): ${(rmErr as Error).message}`,
          );
        });
      return;
    }

    // 2. Detectar projectType — heuristic mejorado 2026-05-16:
    //
    // Casos comunes:
    //  A) Real Next.js project (agente modificó app/page.tsx): tiene
    //     package.json + scripts.dev + app/page.tsx, y NO tiene root HTMLs
    //     "huérfanos" del scaffold. → 'node' (use next dev).
    //
    //  B) Agente dropeó HTMLs sueltos al root (caso seed Popocatépetl):
    //     tiene package.json + scripts.dev pero TAMBIÉN tiene index.html
    //     en el root. next dev IGNORA root HTMLs, así que mostrarías solo
    //     el template default — INCORRECTO. → 'static' (npx serve sirve
    //     todos los archivos del root, including HTMLs).
    //
    //  C) Plain static (sin package.json): obvio. → 'static'.
    //
    // Heurística: HTML en el root del repo MANDA sobre el package.json.
    // Si vemos index.html (o similar), el operador quiere previsualizar
    // ese HTML — no la página default del scaffold.
    const detectStart = Date.now();
    const packageJsonPath = join(instance.workdir, 'package.json');
    let hasDevScript = false;
    let pkgName: string | null = null;
    let detectReason = 'no package.json (HTML estático)';
    try {
      const pkgRaw = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw);
      pkgName = typeof pkg?.name === 'string' ? pkg.name : null;
      hasDevScript = typeof pkg?.scripts?.dev === 'string';
      detectReason = hasDevScript
        ? `package.json con scripts.dev="${pkg.scripts.dev}"`
        : `package.json sin scripts.dev`;
    } catch (err) {
      detectReason = `no package.json legible (${(err as Error).message.slice(0, 80)})`;
    }

    // Detectar HTMLs huérfanos en root (que next dev ignoraría).
    // index.html es el más claro indicador, pero también consideramos otros
    // como info-card.html, history.html, demo.html, etc. del agente.
    const rootEntries = await fs.readdir(instance.workdir).catch(() => [] as string[]);
    const rootHtmlFiles = rootEntries.filter((f) => f.toLowerCase().endsWith('.html'));
    const hasRootIndexHtml = rootHtmlFiles.some((f) => f.toLowerCase() === 'index.html');

    // Override del projectType: si hay CUALQUIER HTML en root, preferir
    // static aunque haya package.json (caso B arriba — extended 2026-05-16
    // post-PR #109+#110 merge donde sprint-batch quedó con info-card.html y
    // history.html pero SIN index.html porque PR #111 quedó con conflicts).
    //
    // Razonamiento: si el agente dropeó HTML al root del repo, ESE es el
    // output que el operador quiere previsualizar — no la página template
    // del scaffold. `npx serve` sin index.html muestra directory listing
    // navegable, mejor que `next dev` mostrando un template vacío.
    let finalProjectType: 'static' | 'node';
    let overrideReason: string | null = null;
    if (rootHtmlFiles.length > 0) {
      finalProjectType = 'static';
      overrideReason = hasRootIndexHtml
        ? `override → static: hay index.html en root (${rootHtmlFiles.length} HTML files total) — next dev los ignoraría`
        : `override → static: ${rootHtmlFiles.length} HTML(s) en root [${rootHtmlFiles.slice(0, 3).join(', ')}] — agente dropeó archivos sueltos, npx serve mostrará directory listing`;
    } else if (hasDevScript) {
      finalProjectType = 'node';
    } else {
      finalProjectType = 'static';
    }
    instance.projectType = finalProjectType;
    this.appendLog(
      instance,
      `[detect] projectType=${instance.projectType} ` +
        `package="${detectReason}" rootHtmls=[${rootHtmlFiles.slice(0, 5).join(', ')}${rootHtmlFiles.length > 5 ? '...' : ''}]` +
        (overrideReason ? ` ${overrideReason}` : ''),
    );
    this.logger.log(
      {
        event: 'preview.lifecycle.detect.complete',
        batchId: instance.batchId,
        projectType: instance.projectType,
        hasDevScript,
        pkgName,
        packageReason: detectReason,
        rootHtmlFiles,
        hasRootIndexHtml,
        rootEntriesCount: rootEntries.length,
        overrideReason,
        elapsedMs: Date.now() - detectStart,
      },
      `[preview:${instance.batchId}] projectType=${instance.projectType} — ${overrideReason ?? detectReason} (rootHtmls=${rootHtmlFiles.length})`,
    );

    // 3. Spawn dev server
    let cmd: string;
    let args: string[];
    let env: NodeJS.ProcessEnv;
    // IMPORTANTE: dispatch por finalProjectType (post-override), NO hasDevScript.
    // Si hay HTMLs en root, el override eligió 'static' aunque exista package.json
    // con scripts.dev — en ese caso queremos npx serve (next dev ignoraría los
    // HTMLs del root).
    // SECURITY (security-reviewer 2026-05-17 — Vulns 1 & 3):
    //
    // 1) Env whitelist: el child proceso ejecuta AGENT-GENERATED code (pnpm
    //    install corre postinstall scripts arbitrarios; pnpm run dev ejecuta
    //    el `dev` script del package.json del agente). Spread `...process.env`
    //    leakea TODO el environment del backend al proceso untrusted —
    //    incluyendo `VAULT_ENCRYPTION_KEY` (decifra todos los secrets del
    //    `CryptoService`), `DATABASE_URL`, `AUTH0_*`, GitHub PATs. Un agente
    //    malicioso (o un dependency con postinstall) puede exfiltrar el env
    //    a un endpoint externo. Allowlist explícito SOLO las vars que el
    //    dev server necesita.
    //
    // 2) HOST loopback: bindear a `0.0.0.0` expone el preview a TODA la LAN
    //    (incluyendo redes wifi públicas). El waitForPort probe corre contra
    //    127.0.0.1 anyway. Default a loopback; gate behind PREVIEW_BIND_HOST
    //    env var si en el futuro se requiere acceso remoto explícito.
    const SAFE_BIND_HOST =
      process.env.PREVIEW_BIND_HOST?.trim() || '127.0.0.1';
    const baseSafeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      // NODE_ENV explícito para que el dev server use modo development sin
      // heredar el del proceso parent (que en producción sería 'production'
      // — irónico para un dev server).
      NODE_ENV: 'development',
      // Locale básico para que npm/pnpm + git formateen output con UTF-8.
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
    };

    if (finalProjectType === 'node') {
      // Node project: pnpm install + pnpm dev
      // CAVEAT: pnpm dev puede no respetar --port. Inyectamos via PORT env
      // var (Vite/Next/CRA todos lo respetan). Si el proyecto usa otro
      // mecanismo, el dev server binde al puerto default y el preview falla.
      cmd = 'sh';
      args = ['-c', `pnpm install --silent && PORT=${instance.port} pnpm run dev`];
      env = {
        ...baseSafeEnv,
        PORT: String(instance.port),
        HOST: SAFE_BIND_HOST,
        BROWSER: 'none', // evita que dev server abra browser automático
      };
    } else {
      // Static HTML: npx serve
      cmd = 'npx';
      args = [
        '--yes',
        'serve',
        '--listen',
        // `serve` acepta host:port para bindear a interfaz específica.
        `${SAFE_BIND_HOST}:${instance.port}`,
        '--no-clipboard',
        instance.workdir,
      ];
      env = { ...baseSafeEnv };
    }

    const spawnStart = Date.now();
    const child = spawn(cmd, args, {
      cwd: instance.workdir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // detached: false → child muere si API muere (lo que queremos)
    });
    instance.process = child;
    instance.pid = child.pid ?? null;
    const spawnLogLine = `[spawn] cmd="${cmd} ${args.join(' ')}" pid=${child.pid} cwd=${instance.workdir}`;
    this.appendLog(instance, spawnLogLine);
    this.logger.log(
      {
        event: 'preview.lifecycle.dev_server.spawned',
        batchId: instance.batchId,
        cmd,
        argsCount: args.length,
        pid: child.pid,
        cwd: instance.workdir,
        port: instance.port,
        projectType: instance.projectType,
      },
      `[preview:${instance.batchId}] dev server spawned: ${cmd} ${args.slice(0, 2).join(' ')}... pid=${child.pid}`,
    );

    let totalStderrBytes = 0;
    let totalStdoutBytes = 0;
    child.stdout?.on('data', (chunk: Buffer) => {
      totalStdoutBytes += chunk.length;
      const text = chunk.toString('utf-8').trim();
      if (text) this.appendLog(instance, `[stdout] ${text}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      totalStderrBytes += chunk.length;
      const text = chunk.toString('utf-8').trim();
      if (text) this.appendLog(instance, `[stderr] ${text}`);
      // Streamed observability: si el stderr arranca con "error" o "fatal",
      // logueamos warning inmediato. Útil para detectar fail de pnpm install
      // mucho antes que el timeout de port wait.
      const lower = text.toLowerCase();
      if (lower.startsWith('error') || lower.includes('fatal:') || lower.includes('enoent')) {
        this.logger.warn(
          {
            event: 'preview.dev_server.stderr_warn',
            batchId: instance.batchId,
            pid: child.pid,
            stderrPreview: text.slice(0, 200),
          },
          `[preview:${instance.batchId}] dev server stderr early warning: ${text.slice(0, 100)}`,
        );
      }
    });

    child.on('error', (err) => {
      // ENOENT = comando no existe (e.g., `pnpm` no instalado en PATH).
      // EACCES = permisos. EPERM = otro tipo de denegación.
      const isCommonError =
        err.message.includes('ENOENT') ||
        err.message.includes('EACCES') ||
        err.message.includes('EPERM');
      this.logger.error(
        {
          event: 'preview.lifecycle.dev_server.spawn_error',
          batchId: instance.batchId,
          cmd,
          errorMessage: err.message,
          isCommonError,
          hint: isCommonError
            ? `Probable causa: '${cmd}' no está en PATH del API daemon. Verificá: which ${cmd}`
            : null,
        },
        `[preview:${instance.batchId}] dev server spawn error: ${err.message}`,
      );
      this.appendLog(instance, `[spawn error] ${err.message}`);
      instance.status = 'error';
      instance.error = `spawn error: ${err.message}${isCommonError ? ` — verificá '${cmd}' en PATH` : ''}`;
    });

    child.on('exit', (code, signal) => {
      const elapsedMs = Date.now() - spawnStart;
      this.logger.log(
        {
          event: 'preview.lifecycle.dev_server.exit',
          batchId: instance.batchId,
          pid: child.pid,
          code,
          signal,
          previousStatus: instance.status,
          elapsedMs,
          totalStderrBytes,
          totalStdoutBytes,
        },
        `[preview:${instance.batchId}] dev server exit code=${code} signal=${signal} elapsed=${elapsedMs}ms (was status=${instance.status})`,
      );
      // Si era 'running' y muere, marca error. Si era 'stopped' (operador hizo stop), OK.
      if (instance.status === 'running' || instance.status === 'starting') {
        instance.status = 'error';
        instance.error = `dev server exited unexpectedly (code=${code}, signal=${signal})`;
      }
    });

    // 4. Wait for port bind (polling cada 500ms hasta READY_TIMEOUT_MS)
    const portWaitStart = Date.now();
    this.appendLog(instance, `[port-wait] esperando bind a localhost:${instance.port} (timeout ${this.READY_TIMEOUT_MS}ms)`);
    // Downgrade a debug — start del polling no aporta nuevo signal sobre el
    // `dev_server.spawned` ya emitido hace milisegundos. Lo importante es
    // `port_wait.success` (con elapsedMs) o `port_wait.timeout` (error).
    this.logger.debug(
      {
        event: 'preview.lifecycle.port_wait.start',
        batchId: instance.batchId,
        port: instance.port,
        timeoutMs: this.READY_TIMEOUT_MS,
      },
      `[preview:${instance.batchId}] port-wait start port=${instance.port}`,
    );
    const ready = await this.waitForPort(instance.port, this.READY_TIMEOUT_MS);
    const portWaitMs = Date.now() - portWaitStart;
    if (!ready) {
      const msg = `Dev server no bindeó al puerto ${instance.port} dentro de ${this.READY_TIMEOUT_MS}ms — probablemente fail en install/build (revisa logsTail)`;
      this.logger.error(
        {
          event: 'preview.lifecycle.port_wait.timeout',
          batchId: instance.batchId,
          port: instance.port,
          elapsedMs: portWaitMs,
          childKilled: child.killed,
          childExited: child.exitCode !== null,
          childExitCode: child.exitCode,
          recentLogsTail: instance.logs.slice(-10),
        },
        `[preview:${instance.batchId}] ${msg}`,
      );
      this.appendLog(instance, msg);
      instance.status = 'error';
      instance.error = msg;
      // Mate el child que está atorado
      if (!child.killed) child.kill('SIGTERM');
      return;
    }
    this.logger.log(
      {
        event: 'preview.lifecycle.port_wait.success',
        batchId: instance.batchId,
        port: instance.port,
        elapsedMs: portWaitMs,
        totalPhaseElapsedMs: Date.now() - phaseStart,
      },
      `[preview:${instance.batchId}] port-wait OK in ${portWaitMs}ms (total spawn lifecycle=${Date.now() - phaseStart}ms)`,
    );

    instance.status = 'running';
    this.appendLog(instance, `[ready] dev server escuchando en ${instance.url}`);
    this.logger.log(
      `[preview:${instance.batchId}] ✅ READY at ${instance.url} (projectType=${instance.projectType})`,
    );
  }

  private async gitClone(repoUrl: string, branch: string, workdir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const redact = (s: string) =>
        s.replace(/https:\/\/x-access-token:[^@\s]+@/g, 'https://x-access-token:[REDACTED]@');

      // Pre-spawn logging: argumentos exactos (con token redactado) para que
      // el operador pueda copy-paste el comando equivalente y reproducir el
      // error fuera del daemon si necesario.
      const args = ['clone', '--depth', '1', '--branch', branch, repoUrl, workdir];
      const redactedArgs = args.map((a) => redact(a));
      this.logger.log(
        {
          event: 'preview.git_clone.spawn',
          branch,
          workdir,
          repoUrlPreview: redact(repoUrl).slice(0, 80),
          cmd: 'git',
          args: redactedArgs,
        },
        `[git-clone] Spawning: git ${redactedArgs.join(' ')}`,
      );

      const child = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
          // Defense: GIT_TERMINAL_PROMPT=0 fuerza fail-fast si git pide
          // credenciales interactivas (vs colgarse esperando input que
          // nunca llega cuando estamos en NodeJS daemon non-tty).
          GIT_TERMINAL_PROMPT: '0',
          // GIT_ASKPASS vacío evita que git busque programa askpass
          // gráfico (Keychain on macOS) que también colgaría.
          GIT_ASKPASS: 'echo',
          // SSH_ASKPASS sigue el mismo principio para clones SSH (no
          // aplica acá porque usamos HTTPS, defensive depth).
          SSH_ASKPASS: 'echo',
          // GIT_CONFIG_GLOBAL='' evita que git lea ~/.gitconfig del operador
          // (que podría tener helpers de credenciales que cambien el flow).
          // Usamos un archivo vacío en vez de unset para preservar
          // determinismo del entorno.
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_SYSTEM: '/dev/null',
        },
      });

      // Downgrade a debug — el `preview.git_clone.spawn` previo ya logueó cmd
      // + args redactados. Solo añade `pid` que es útil únicamente cuando algo
      // falla (y entonces los logs error/exit ya lo incluyen).
      this.logger.debug(
        {
          event: 'preview.git_clone.spawned',
          pid: child.pid,
          branch,
        },
        `[git-clone] Process started pid=${child.pid}`,
      );

      // Capturamos AMBOS stdout y stderr — algunos git errors van a stdout
      // (raro pero pasa con remotes mal configurados). Cap a 4KB cada uno
      // para no acumular si git escupe progress dots infinitos.
      let stderr = '';
      let stdout = '';
      let stderrChunks = 0;
      let stdoutChunks = 0;
      const MAX_CAPTURE = 4096;

      child.stderr?.on('data', (d) => {
        stderrChunks++;
        const chunk = d.toString();
        if (stderr.length < MAX_CAPTURE) stderr += chunk;
        // Stream observabilidad: logueamos cada chunk de stderr conforme llega
        // (cap a 200 chars del chunk + chunk index). Si git emite una fatal
        // tarde, lo veremos antes que el evento close. Importante para race
        // conditions tipo "exit fired antes que stderr drain".
        this.logger.debug(
          {
            event: 'preview.git_clone.stderr_chunk',
            chunkIndex: stderrChunks,
            chunkBytes: chunk.length,
            chunkPreview: redact(chunk).slice(0, 200),
          },
          `[git-clone:stderr:#${stderrChunks}] ${redact(chunk).slice(0, 100)}`,
        );
      });
      child.stdout?.on('data', (d) => {
        stdoutChunks++;
        const chunk = d.toString();
        if (stdout.length < MAX_CAPTURE) stdout += chunk;
        this.logger.debug(
          {
            event: 'preview.git_clone.stdout_chunk',
            chunkIndex: stdoutChunks,
            chunkBytes: chunk.length,
            chunkPreview: redact(chunk).slice(0, 200),
          },
          `[git-clone:stdout:#${stdoutChunks}] ${redact(chunk).slice(0, 100)}`,
        );
      });

      child.on('error', (err) => {
        // 'error' fires SOLO si fallo en el spawn mismo (ENOENT, EPERM, etc.).
        // El exit con código no-zero NO dispara 'error', dispara 'close'/'exit'.
        this.logger.error(
          {
            event: 'preview.git_clone.spawn_error',
            errMessage: err.message,
            errStack: err.stack?.split('\n').slice(0, 3).join(' | '),
          },
          `[git-clone] spawn error: ${err.message}`,
        );
        reject(new Error(`git spawn error: ${err.message}`));
      });

      // CRÍTICO: usamos 'close' en vez de 'exit'. 'exit' puede firearse ANTES
      // que stderr/stdout terminen de drain (race condition documentada en
      // Node docs: "the exit event may or may not fire after an error event
      // [...] when listening to both events, guard against accidentally
      // invoking handler functions multiple times"). 'close' garantiza que
      // todos los stdio streams cerraron, así stderr está completo.
      //
      // Esto explica el caso del operador: exit 128 con "Clonando en..." y
      // nada más en stderr — el fatal real probablemente llegó después del
      // exit event, y nunca se incluyó en el buffer.
      let exitCode: number | null = null;
      let exitSignal: NodeJS.Signals | null = null;
      child.on('exit', (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        this.logger.debug(
          {
            event: 'preview.git_clone.exit',
            code,
            signal,
            stderrLenAtExit: stderr.length,
            stdoutLenAtExit: stdout.length,
            elapsedMs: Date.now() - startedAt,
          },
          `[git-clone] exit event (code=${code} signal=${signal}) — esperando close para flush stderr`,
        );
      });

      child.on('close', (code, signal) => {
        const elapsedMs = Date.now() - startedAt;
        const finalCode = code ?? exitCode;
        const finalSignal = signal ?? exitSignal;

        if (finalCode === 0) {
          this.logger.log(
            {
              event: 'preview.git_clone.success',
              branch,
              workdir,
              elapsedMs,
              stderrChunks,
              stdoutChunks,
            },
            `[git-clone] ✅ OK ${branch} → ${workdir} in ${elapsedMs}ms`,
          );
          resolve();
          return;
        }

        // Fail path — logueamos el detalle COMPLETO antes de tirar excepción
        const combined = [redact(stderr), redact(stdout)].filter(Boolean).join(' | ');
        const errorTail = combined.slice(-1200) || '(no stderr/stdout captured)';
        this.logger.error(
          {
            event: 'preview.git_clone.failed',
            branch,
            workdir,
            code: finalCode,
            signal: finalSignal,
            elapsedMs,
            stderrChunks,
            stdoutChunks,
            stderrLen: stderr.length,
            stdoutLen: stdout.length,
            stderrTail: redact(stderr).slice(-600),
            stdoutTail: redact(stdout).slice(-600),
            stderrHead: redact(stderr).slice(0, 200),
          },
          `[git-clone] ❌ FAILED code=${finalCode} signal=${finalSignal} in ${elapsedMs}ms — stderr/stdout en log estructurado`,
        );
        reject(
          new Error(
            `git clone exit ${finalCode}${finalSignal ? ` (signal=${finalSignal})` : ''}: ${errorTail}`,
          ),
        );
      });
    });
  }

  /**
   * Clone single-branch full-history del `devBranch` y checkout al `sha`.
   *
   * Usado en el fallback post-cleanup (integration branch ya borrada): el SHA
   * del merge commit sigue siendo reachable desde dev (por el merge commit
   * de squash/merge), por lo que un single-branch clone de dev garantiza que
   * el SHA está disponible localmente para `git checkout`.
   *
   * vs `gitClone` (path normal): NO usa `--depth 1` porque necesitamos history
   * suficiente para reachear el SHA. El single-branch clone es más liviano
   * que un full clone (solo dev branch, no otras refs), pero más pesado que
   * shallow. Trade-off acceptable porque el fallback es el path frío.
   *
   * SECURITY: mismo env hardening que `gitClone` — sin terminal prompt, sin
   * askpass interactivo, sin gitconfig global.
   */
  private async gitCloneAtSha(
    repoUrl: string,
    devBranch: string,
    sha: string,
    workdir: string,
  ): Promise<void> {
    const redact = (s: string) =>
      s.replace(/https:\/\/x-access-token:[^@\s]+@/g, 'https://x-access-token:[REDACTED]@');

    // Paso 1: clone single-branch del devBranch (full history)
    await new Promise<void>((resolve, reject) => {
      const args = [
        'clone',
        '--single-branch',
        '--branch',
        devBranch,
        '--no-tags',
        repoUrl,
        workdir,
      ];
      this.logger.log(
        {
          event: 'preview.git_clone_at_sha.clone.spawn',
          devBranch,
          sha: sha.slice(0, 8),
          workdir,
          cmd: 'git',
          args: args.map((a) => redact(a)),
        },
        `[git-clone-at-sha] Spawning: git ${args.map((a) => redact(a)).join(' ')}`,
      );

      const child = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo',
          SSH_ASKPASS: 'echo',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_SYSTEM: '/dev/null',
        },
      });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        const s = d.toString();
        if (stderr.length < 4096) stderr += s;
      });
      child.on('error', (err) => reject(new Error(`spawn git clone failed: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git clone (single-branch) exit ${code}: ${redact(stderr).slice(-400)}`));
      });
    });

    // Paso 2: checkout del SHA (detached HEAD — esperado para preview de snapshot)
    await new Promise<void>((resolve, reject) => {
      const args = ['-C', workdir, 'checkout', sha];
      this.logger.log(
        {
          event: 'preview.git_clone_at_sha.checkout.spawn',
          sha: sha.slice(0, 8),
          workdir,
        },
        `[git-checkout-sha] Spawning: git -C ${workdir} checkout ${sha.slice(0, 8)}`,
      );
      const child = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_SYSTEM: '/dev/null',
        },
      });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        const s = d.toString();
        if (stderr.length < 2048) stderr += s;
      });
      child.on('error', (err) => reject(new Error(`spawn git checkout failed: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `git checkout ${sha.slice(0, 8)} exit ${code}: ${stderr.slice(-400)}. ` +
                `Causa probable: el SHA no está alcanzable desde ${devBranch} (force-push reescribió historia, o el merge fue revertido).`,
            ),
          );
      });
    });
  }

  /**
   * Pollea cada 500ms si el puerto está bindeado. Retorna true si OK,
   * false si timeout.
   *
   * Implementación: intenta TCP connect a localhost:port. Si succeeds,
   * server está escuchando. Si fails (ECONNREFUSED), todavía no.
   */
  private async waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const isOpen = await new Promise<boolean>((resolve) => {
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
        socket.connect(port, '127.0.0.1');
      });
      if (isOpen) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  private appendLog(instance: PreviewInstance, line: string): void {
    instance.logs.push(`[${new Date().toISOString()}] ${line}`);
    // Truncate al cap
    if (instance.logs.length > this.LOG_BUFFER_LINES) {
      instance.logs.shift();
    }
  }

  /**
   * Ejecuta un comando y captura stdout/stderr. Falla si exit no es 0.
   * Usado para preflight checks (e.g., `git --version`) donde queremos
   * confirmar que un binario está disponible y funcional antes de
   * intentar usarlo con argumentos más complejos.
   */
  private async runCommandCapture(
    cmd: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => reject(new Error(`spawn ${cmd} failed: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-400) || stdout.slice(-400)}`));
        }
      });
    });
  }

  /**
   * Cleanup hook llamado en NestJS module destroy (graceful API shutdown).
   * Kill todos los preview processes para no dejar zombies.
   */
  async cleanupAll(): Promise<void> {
    this.logger.log(`[preview] Cleanup all (${this.previews.size} active previews)`);
    const batchIds = Array.from(this.previews.keys());
    await Promise.all(batchIds.map((id) => this.stopPreview(id)));
  }
}
