import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type { CodeRepository } from '@prisma/client';
import { CodeRepositoryConfigService } from '../../code-repositories/code-repository-config.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * GitHubService — wrapper centralizado de Octokit para operaciones del Forge.
 *
 * Por qué un service en vez de usar Octokit directo en cada caller:
 *  1. **Token management**: el PAT vive encriptado en `CodeRepository`. Este
 *     service lo desencripta una vez por operación y crea el cliente Octokit.
 *  2. **Repo selection**: hoy hay múltiples repos enabled. El Forge usa el
 *     PRIMER repo activo como destino — Sprint 5+ podemos hacer routing
 *     por epic.tags o pod del usuario.
 *  3. **Auditoría**: cada operación loggea con el repoId + epicId/storyId
 *     para tracear "qué pasó con esta épica".
 *  4. **Testing**: mockear este service es trivial vs. mockear Octokit en N
 *     callers.
 *
 * Operaciones soportadas (Sprint 4):
 *  - `createIntegrationBranch`: cuando una épica entra al Forge
 *  - `openStoryPullRequest`: cuando un worker termina una historia
 *  - `mergePullRequest`: tras reviewers PASS o tras human gate
 *  - `commentOnPullRequest`: feedback de reviewer agents
 *  - `getPullRequestStatus`: cron de "todos done?" antes del consolidated PR
 *  - `deleteBranch`: cleanup tras merge a DEV (si autoDelete=true)
 */
@Injectable()
export class GitHubService {
  constructor(private readonly repos: CodeRepositoryConfigService,
    @InjectPinoLogger(GitHubService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Obtiene el repo activo del Forge + su Octokit autenticado.
   *
   * Estrategia "primer repo enabled gana" — Sprint 5+ podemos hacer
   * selection por context (epic.repoId, pod.repoId, etc.). Si no hay
   * NINGÚN repo enabled, lanza NotFoundException — el caller debe manejar
   * el error con un mensaje accionable al operador (ej. "configura un
   * repositorio en /factory/settings → Código antes de encolar épicas").
   */
  /**
   * Lee el HEAD de una branch específica. Retorna `null` si no existe en
   * remote — NO throw. Lo usamos para validaciones UX (¿la branch existe?)
   * donde una excepción sería invasiva.
   */
  async getBranchHead(branch: string): Promise<{ sha: string; exists: true } | { sha: null; exists: false }> {
    const { octokit, config } = await this.getActiveRepoClient();
    try {
      const ref = await octokit.git.getRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${branch}`,
      });
      return { exists: true, sha: ref.data.object.sha };
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 404) return { exists: false, sha: null };
      throw err;
    }
  }

  /**
   * Compara dos branches via `compare` API. Retorna el `status` reportado
   * por GitHub (`identical | ahead | behind | diverged`) o uno de nuestros
   * estados sintéticos: `no_common_ancestor` cuando GitHub responde 404
   * con el mensaje específico, `missing_branch` si la branch base o head
   * no existe en remote.
   *
   * Lo usamos para validar el git state de la org (dev y main comparten
   * historia?) antes de operaciones que requieren ancestro común
   * (e.g., consolidated PR del Forge a DEV).
   */
  async compareBranches(input: { base: string; head: string }): Promise<{
    status: 'identical' | 'ahead' | 'behind' | 'diverged' | 'no_common_ancestor' | 'missing_branch';
    aheadBy: number;
    behindBy: number;
    baseSha: string | null;
    headSha: string | null;
  }> {
    const { octokit, config } = await this.getActiveRepoClient();
    try {
      const result = await octokit.repos.compareCommits({
        owner: config.owner,
        repo: config.repo,
        base: input.base,
        head: input.head,
      });
      return {
        status: result.data.status as 'identical' | 'ahead' | 'behind' | 'diverged',
        aheadBy: result.data.ahead_by,
        behindBy: result.data.behind_by,
        baseSha: result.data.base_commit?.sha ?? null,
        headSha: result.data.commits[result.data.commits.length - 1]?.sha ?? result.data.base_commit?.sha ?? null,
      };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 404) {
        const msg = e.message ?? '';
        if (msg.toLowerCase().includes('no common ancestor')) {
          return {
            status: 'no_common_ancestor',
            aheadBy: 0,
            behindBy: 0,
            baseSha: null,
            headSha: null,
          };
        }
        return {
          status: 'missing_branch',
          aheadBy: 0,
          behindBy: 0,
          baseSha: null,
          headSha: null,
        };
      }
      throw err;
    }
  }

  /**
   * Force-update de una branch a apuntar a un SHA dado. DESTRUCTIVO — si la
   * branch ya existía con otra historia, ese trabajo queda huérfano en el
   * remote (recuperable solo via reflog del lado del operador). El caller
   * debe validar permisos (step-up auth + role) ANTES de invocar.
   *
   * Lo usamos para el flow "Alinear dev con main" desde settings — escenario
   * común tras setup inicial donde `dev` se creó como branch huérfana.
   */
  async forceUpdateBranch(branch: string, sha: string): Promise<{ sha: string }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const result = await octokit.git.updateRef({
      owner: config.owner,
      repo: config.repo,
      ref: `heads/${branch}`,
      sha,
      force: true,
    });
    this.logger.warn(
      `[github] FORCE-UPDATE branch ${config.owner}/${config.repo} ${branch} → ${sha.slice(0, 7)} (destructivo, descarta historia anterior)`,
    );
    return { sha: result.data.object.sha };
  }

  /**
   * Info del repo activo del Forge SIN throw — para construir URLs y badges
   * en el frontend cuando NO queremos abortar si no hay repo configurado.
   *
   * Diferente de `getActiveRepoClient`: éste no necesita el token (no devuelve
   * Octokit), por lo que no hace lookup de tokens encriptados — más liviano.
   * Lo usamos en endpoints read-only (getBatchDetail) para retornar el
   * `repoUrl` cuando exista.
   */
  async getActiveRepoInfo(): Promise<{
    owner: string;
    repo: string;
    htmlUrl: string;
  } | null> {
    const writable = await this.repos.getForgeWritableWithTokens();
    if (writable.length === 0) return null;
    const { config } = writable[0];
    return {
      owner: config.owner,
      repo: config.repo,
      htmlUrl: `https://github.com/${config.owner}/${config.repo}`,
    };
  }

  /**
   * Retorna credentials plain del repo writable activo. Usado por
   * ConflictResolverService para autenticar `git clone` cuando intenta
   * resolver merge conflicts via merge local + push.
   *
   * NO loggear el token en cleartext — los callers deben pasarlo solo
   * por canales seguros (URL inyectado, header HTTP, etc.).
   */
  async getRepoCredentials(): Promise<{
    owner: string;
    repo: string;
    repoUrl: string;
    token: string;
  }> {
    const writable = await this.repos.getForgeWritableWithTokens();
    if (writable.length === 0) {
      throw new NotFoundException(
        'No hay code repository con escritura del Forge habilitada.',
      );
    }
    const { config, token } = writable[0];
    return {
      owner: config.owner,
      repo: config.repo,
      repoUrl: `https://github.com/${config.owner}/${config.repo}`,
      token,
    };
  }

  private async getActiveRepoClient(): Promise<{
    octokit: Octokit;
    config: CodeRepository;
  }> {
    // SECURITY (forgeWritable opt-in): solo repos marcados explícitamente
    // como writable. Sin esto, todos los repos enabled (que conceptualmente
    // son solo READ para agentes que generan épicas/stories) serían targets
    // automáticos del Forge — peligroso porque alguien podría haber dado
    // acceso de read sin entender que también daría acceso de write.
    const writable = await this.repos.getForgeWritableWithTokens();
    if (writable.length === 0) {
      throw new NotFoundException(
        'No hay code repository con escritura del Forge habilitada. ' +
          'Ve a /factory/settings → Código y activa "Permitir escritura del Forge" en el repo destino.',
      );
    }
    // Primer repo writable gana. TODO Sprint 5: selection por context (epic.repoId).
    const { config, token } = writable[0];
    const octokit = new Octokit({
      auth: token,
      // User agent identifica nuestro cliente en logs de GitHub —
      // útil si rate-limit y debug.
      userAgent: 'cenzontle-forge/1.0',
    });
    return { octokit, config };
  }

  /**
   * Crea la integration branch del Forge para una épica.
   *
   * Flow:
   *  1. Lee SHA del head de devBranch (la branch de integración del fleet)
   *  2. Crea ref `refs/heads/${branchName}` apuntando a ese SHA
   *  3. Devuelve el branchName + SHA base para auditoría
   *
   * Si la branch ya existe (e.g., re-encole de una épica), devuelve la
   * existente con su SHA actual — operación idempotente.
   *
   * @throws NotFoundException si el devBranch no existe en el repo
   * @throws Error si el GitHub API falla (network, permission, etc.)
   */
  async createIntegrationBranch(input: {
    branchName: string;
    devBranch: string;
    epicId: string;
  }): Promise<{ branchName: string; baseSha: string; alreadyExisted: boolean }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    // 1. Lee el SHA actual del devBranch
    let baseSha: string;
    try {
      const ref = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${input.devBranch}`,
      });
      baseSha = ref.data.object.sha;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 404) {
        throw new NotFoundException(
          `DEV branch "${input.devBranch}" no existe en ${owner}/${repo}. ` +
            `Créala primero o cambia el devBranch en /factory/settings → Estrategia de ramas.`,
        );
      }
      throw err;
    }

    // 2. Intenta crear la integration branch
    try {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${input.branchName}`,
        sha: baseSha,
      });
      this.logger.info(
        `[github] integration branch creada: ${owner}/${repo} ${input.branchName} desde ${input.devBranch}@${baseSha.slice(0, 7)} (epicId=${input.epicId})`,
      );
      return { branchName: input.branchName, baseSha, alreadyExisted: false };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      // 422 — Reference already exists. Idempotencia: devolvemos lo existente.
      if (e.status === 422 && e.message?.includes('Reference already exists')) {
        const existing = await octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${input.branchName}`,
        });
        this.logger.warn(
          `[github] integration branch YA EXISTE: ${input.branchName} @${existing.data.object.sha.slice(0, 7)} (epicId=${input.epicId}). Idempotente.`,
        );
        return {
          branchName: input.branchName,
          baseSha: existing.data.object.sha,
          alreadyExisted: true,
        };
      }
      throw err;
    }
  }

  /**
   * Abre un PR de una story branch contra la integration branch del Forge.
   *
   * Asume que la story branch ya existe en el remote (el worker la pusheó).
   * Si el worker no terminó el push, el PR creation falla con 422.
   */
  async openStoryPullRequest(input: {
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<{ prNumber: number; htmlUrl: string; alreadyExisted: boolean }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    try {
      const pr = await octokit.pulls.create({
        owner,
        repo,
        head: input.headBranch,
        base: input.baseBranch,
        title: input.title,
        body: input.body,
      });

      this.logger.info(
        `[github] story PR creado: ${owner}/${repo} #${pr.data.number} ${input.headBranch} → ${input.baseBranch}`,
      );

      return {
        prNumber: pr.data.number,
        htmlUrl: pr.data.html_url,
        alreadyExisted: false,
      };
    } catch (err) {
      // Idempotencia: GitHub devuelve 422 con "A pull request already exists"
      // si ya hay un PR abierto desde la misma headBranch hacia la misma base.
      // En vez de propagar el error (que el caller silenciaba como "sandbox"),
      // recuperamos el PR existente y lo retornamos — comportamiento esperado
      // de una operación idempotente.
      const githubErr = err as {
        status?: number;
        message?: string;
        response?: { data?: { errors?: Array<{ message?: string }> } };
      };
      const errorMessages = [
        githubErr.message ?? '',
        ...(githubErr.response?.data?.errors?.map((e) => e.message ?? '') ?? []),
      ].join(' ');
      const isAlreadyExists =
        githubErr.status === 422 &&
        /pull request already exists/i.test(errorMessages);

      if (!isAlreadyExists) throw err;

      // Lookup del PR existente. El head viene qualified con owner: para evitar
      // ambigüedad con forks (octokit espera "owner:branch").
      const list = await octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${input.headBranch}`,
        base: input.baseBranch,
        per_page: 1,
      });
      const existing = list.data[0];
      if (!existing) {
        // Race extrema: GitHub dijo "ya existe" pero el list no lo encuentra
        // (state cambió a closed entre los dos calls). Re-throw el original
        // para que el caller maneje como un error real, no como sandbox.
        throw err;
      }

      this.logger.info(
        `[github] story PR ya existía: ${owner}/${repo} #${existing.number} ${input.headBranch} → ${input.baseBranch} (idempotent reuse)`,
      );

      return {
        prNumber: existing.number,
        htmlUrl: existing.html_url,
        alreadyExisted: true,
      };
    }
  }

  /**
   * Postea un comment en un PR (usado por reviewer agents para reportar
   * resultado de code review / security review).
   */
  async commentOnPullRequest(input: {
    prNumber: number;
    body: string;
  }): Promise<void> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: input.prNumber,
      body: input.body,
    });

    this.logger.debug(
      `[github] comment en PR #${input.prNumber} (${owner}/${repo}) — ${input.body.length} chars`,
    );
  }

  /**
   * Mergea un PR. Estrategia: `squash` por default (commit history limpio
   * en la integration branch) — Sprint 5 podemos hacer configurable.
   */
  async mergePullRequest(input: {
    prNumber: number;
    commitTitle?: string;
    commitMessage?: string;
  }): Promise<{ merged: boolean; sha: string | null }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    try {
      const result = await octokit.pulls.merge({
        owner,
        repo,
        pull_number: input.prNumber,
        merge_method: 'squash',
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
      });

      this.logger.info(
        `[github] PR #${input.prNumber} mergeado a ${owner}/${repo} (sha=${result.data.sha?.slice(0, 7) ?? 'null'})`,
      );

      return {
        merged: result.data.merged,
        sha: result.data.sha ?? null,
      };
    } catch (err) {
      // GitHub responde con varios códigos cuando un PR no es mergeable:
      //   - 405 Method Not Allowed: "Pull Request is not mergeable" (conflict
      //     de archivos REAL post-checks)
      //   - 409 Conflict: head SHA cambió mientras procesábamos (race),
      //     o conflict detectado al re-evaluar
      //   - 422 Unprocessable Entity: a veces para conflicts en repos con
      //     branch protection rules
      //
      // Para que `mergeWithRetry` distinga conflict real (skip retry, invocar
      // resolver) de fallos transient (sleep + retry), marcamos el error con
      // `isMergeConflict=true` cuando detectamos el patrón. Sin esta marca,
      // el caller agota retries y nunca invoca el ConflictResolverService.
      //
      // Bug descubierto 2026-05-17: sin este try/catch, los PRs con conflict
      // quedaban OPEN+CONFLICTING y el resolver jamás se invocaba (validado
      // con seed-conflict-stress-test-minimal donde 2/4 PRs no mergueron).
      const ghStatus = (err as { status?: number }).status;
      const message = (err as Error).message ?? '';
      const isConflictResponse =
        (ghStatus === 405 || ghStatus === 409 || ghStatus === 422) &&
        /not mergeable|merge conflict|conflict/i.test(message);

      if (isConflictResponse) {
        this.logger.warn(
          { event: 'github.pr.merge.conflict_detected', prNumber: input.prNumber, ghStatus, message: message.slice(0, 200) },
          `[github] PR #${input.prNumber} merge rechazado por conflict (status=${ghStatus}) — propagando con isMergeConflict=true para invocar ConflictResolverService`,
        );
        throw Object.assign(
          new Error(
            `PR #${input.prNumber}: GitHub rechazó merge por conflict (status=${ghStatus}, message=${message.slice(0, 100)})`,
          ),
          { isMergeConflict: true, cause: err },
        );
      }
      // Otro tipo de error (5xx, rate limit, token sin permisos) — propagar
      // sin marca para que el retry del caller lo trate como transient.
      throw err;
    }
  }

  /**
   * Actualiza el HEAD branch del PR mergeando el base actualizado dentro de
   * él (equivalente al click "Update branch" en la UI de GitHub).
   *
   * Caso de uso primario: stories paralelas de la misma wave clonan del
   * integration branch en T0, terminan en orden no-determinístico. La primera
   * mergea OK y el integration branch avanza a T1. Las siguientes ven
   * `mergeable_state: 'behind'` porque su head sigue apuntando a T0 mientras
   * el base avanzó. Sin updateBranch, GitHub rechaza el merge con "merge
   * conflicts" aunque NO haya overlap real de archivos — un false-positive
   * que mandaba la story a `in_review` por timing, no por conflict real.
   *
   * Outcomes:
   *  - 202 Accepted → updateBranch encolado, GitHub está propagando el merge
   *    interno. El resultado es asíncrono pero típicamente toma <1s en repos
   *    chicos. El caller debe esperar o reintentar el merge final.
   *  - 422 Validation failed → conflict REAL de archivos (overlap de líneas
   *    en el mismo archivo). Throw con `isMergeConflict=true` para que el
   *    caller distinga de fallos transient (rate limit, 5xx).
   *  - 403/4xx/5xx → otros errores (permisos, rate limit). Propagamos como-es.
   *
   * Idempotente: si el head ya está al día con base, GitHub responde 422 con
   * mensaje "merge conflict" o "already up to date" — el caller debe estar
   * preparado para ambos casos.
   */
  async updatePullRequestBranch(prNumber: number): Promise<{
    ok: true;
    message: string;
  }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    try {
      const result = await octokit.pulls.updateBranch({
        owner,
        repo,
        pull_number: prNumber,
      });
      // GitHub returns `message` opcionalmente — defensive fallback al
      // texto canónico para mantener el contract del Promise<{message: string}>.
      const message = result.data.message ?? 'updated';
      this.logger.info(
        `[github] PR #${prNumber} updateBranch ok en ${owner}/${repo}: ${message}`,
      );
      return { ok: true, message };
    } catch (err) {
      const e = err as Error & {
        status?: number;
        response?: { data?: unknown; status?: number };
      };
      const ghStatus = e.status ?? e.response?.status;
      const message = e.message ?? '';

      // Caso 1 — 422 "head ya alineado con base, no se necesita update".
      // GitHub usa al menos DOS mensajes distintos que significan lo mismo
      // semánticamente — "tu PR está OK para merge as-is, no hay nada que
      // pullear del base":
      //  (a) "Already up to date" — cuando head SHA == base SHA exactamente.
      //  (b) "There are no new commits on the base branch" — cuando head
      //      está ahead-of-base. Sucede frecuentemente post-squash-merge de
      //      una hermana: el squash crea un commit nuevo en base que NO
      //      está en la parentage del head, pero GitHub considera que el
      //      head tiene commits propios que el base no tiene → no se
      //      necesita update. El merge final igual funciona via 3-way merge.
      //
      // Ambos casos devolvemos success — el caller procede al merge.
      // qa-reviewer BLOCK 2026-05-15: sin esto, ambos caían a retries
      // transient → 3 fails idénticos → in_review espurio.
      // 2026-05-15 (segundo edge case): agregada variante "no new commits"
      // observada en PR #100 del epic 71fd3cf7 (hermana de SETUP squash-mergeada).
      const isAlreadyAligned =
        ghStatus === 422 &&
        /already up.to.date|no new commits/i.test(message);
      if (isAlreadyAligned) {
        this.logger.info(
          `[github] PR #${prNumber} updateBranch no-op: branch ya está al día con base (${message})`,
        );
        return { ok: true, message: 'already aligned with base' };
      }

      // Caso 2 — 422 "Merge conflict": archivos overlap REAL. Marcamos con
      // `isMergeConflict=true` para que el caller skipee retries (los
      // conflicts son persistentes, esperar no los resuelve).
      // qa-reviewer WARN 2026-05-15: regex tightening a `/merge conflict/i`
      // (frase exacta) en vez de `/conflict|merge/i` (broad OR) para evitar
      // false positives sobre 422s que mencionan "merge" sin ser conflicts
      // (ej. "Cannot merge", "Merge not allowed", "Not mergeable").
      const isMergeConflict =
        ghStatus === 422 && /merge conflict/i.test(message);
      if (isMergeConflict) {
        throw Object.assign(
          new Error(
            `PR #${prNumber}: merge conflict real — archivos overlap entre head y base (${message})`,
          ),
          { isMergeConflict: true, cause: err },
        );
      }
      throw err;
    }
  }

  /**
   * Lee status de un PR — usado por el cron de "batch completo?" para
   * decidir si todos los PRs del batch ya están mergeados antes de crear
   * el consolidated PR a DEV.
   */
  async getPullRequestStatus(prNumber: number): Promise<{
    state: 'open' | 'closed';
    merged: boolean;
    mergeable: boolean | null;
    /** Estado granular del merge: 'behind' | 'blocked' | 'clean' | 'dirty' |
     *  'draft' | 'has_hooks' | 'unknown' | 'unstable'. Distinto de `mergeable`
     *  porque captura el motivo:
     *    - `clean | unstable | has_hooks`: mergeable (proceder a merge).
     *    - `dirty`: archivos overlap real (conflict). Throw isMergeConflict.
     *    - `behind`: head stale, necesita updateBranch.
     *    - `unknown`: GitHub aún computando (response async post-updateBranch).
     *    - `blocked`: branch protection rule bloquea.
     *    - `draft`: PR en draft, no mergeable.
     *  Usado por `updateBranchToBaseWithRetry` para detectar cuándo el
     *  updateBranch terminó de propagar antes de invocar `mergeWithRetry`. */
    mergeableState: string | null;
    /** Base branch que el PR apunta como destino. Crítico para validar que un
     *  merge out-of-band efectivamente fue al branch correcto — no a `main`
     *  o `staging` por error. Sin esto, un admin que mergea al branch wrong
     *  hace que el caller marque el epic como "merged to DEV" incorrectamente. */
    baseBranch: string;
    /** Timestamp REAL del merge según GitHub (ISO string), null si no merged.
     *  El caller debe preferir este sobre `new Date()` para preservar la
     *  precisión del audit trail — si el merge ocurrió out-of-band hace 1h,
     *  el DB no debería decir que fue ahora. */
    mergedAt: string | null;
    /** SHA del merge commit cuando el PR fue merged. NULL si state='open' o si
     *  el PR fue closed-without-merge. Usado por PreviewService como fallback
     *  cuando la integration branch ya fue borrada por el cleanup automático
     *  pero queremos recuperar el snapshot exacto del epic en su merge. */
    mergeCommitSha: string | null;
  }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    const pr = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      state: pr.data.state as 'open' | 'closed',
      merged: pr.data.merged,
      mergeable: pr.data.mergeable,
      mergeableState: pr.data.mergeable_state ?? null,
      baseBranch: pr.data.base.ref,
      mergedAt: pr.data.merged_at ?? null,
      mergeCommitSha: pr.data.merge_commit_sha ?? null,
    };
  }

  /**
   * Borra una branch del remote. Usado en cleanup tras merge consolidado
   * (si BranchStrategyConfig.autoDeleteForgeBranch=true).
   *
   * Idempotente: si la branch ya no existe, retorna sin error.
   */
  async deleteBranch(branchName: string): Promise<void> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    try {
      await octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
      this.logger.info({ owner, repo, branchName }, `[github] branch borrada: ${owner}/${repo} ${branchName}`);
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 404 || e.status === 422) {
        // Ya no existe — idempotente, no es un error real.
        this.logger.warn(
          `[github] branch ${branchName} ya no existe en ${owner}/${repo}, skip delete`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Devuelve clone URL con token embebido para que el worker pueda hacer
   * `git clone https://x-access-token:TOKEN@github.com/owner/repo.git`.
   *
   * SECURITY: el token plaintext viaja al worker — debe estar protegido
   * en transit (HTTPS enforcement Sprint 2) y NUNCA persistirse en disk
   * por el worker. El worker lo usa solo para clone y push.
   */
  async getCloneUrl(): Promise<{ cloneUrl: string; defaultBranch: string }> {
    // Mismo filtro que getActiveRepoClient: solo repos forgeWritable=true.
    const writable = await this.repos.getForgeWritableWithTokens();
    if (writable.length === 0) {
      throw new NotFoundException(
        'No hay code repository con escritura del Forge habilitada. ' +
          'Activa "Permitir escritura del Forge" en /factory/settings → Código.',
      );
    }
    const { config, token } = writable[0];
    const cloneUrl = `https://x-access-token:${token}@github.com/${config.owner}/${config.repo}.git`;
    return {
      cloneUrl,
      defaultBranch: config.branch || 'main',
    };
  }
}
