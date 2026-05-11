import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type { CodeRepository } from '@prisma/client';
import { CodeRepositoryConfigService } from '../../code-repositories/code-repository-config.service';

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
  private readonly logger = new Logger(GitHubService.name);

  constructor(private readonly repos: CodeRepositoryConfigService) {}

  /**
   * Obtiene el repo activo del Forge + su Octokit autenticado.
   *
   * Estrategia "primer repo enabled gana" — Sprint 5+ podemos hacer
   * selection por context (epic.repoId, pod.repoId, etc.). Si no hay
   * NINGÚN repo enabled, lanza NotFoundException — el caller debe manejar
   * el error con un mensaje accionable al operador (ej. "configura un
   * repositorio en /factory/settings → Código antes de encolar épicas").
   */
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
      this.logger.log(
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
  }): Promise<{ prNumber: number; htmlUrl: string }> {
    const { octokit, config } = await this.getActiveRepoClient();
    const { owner, repo } = config;

    const pr = await octokit.pulls.create({
      owner,
      repo,
      head: input.headBranch,
      base: input.baseBranch,
      title: input.title,
      body: input.body,
    });

    this.logger.log(
      `[github] story PR creado: ${owner}/${repo} #${pr.data.number} ${input.headBranch} → ${input.baseBranch}`,
    );

    return {
      prNumber: pr.data.number,
      htmlUrl: pr.data.html_url,
    };
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

    const result = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: input.prNumber,
      merge_method: 'squash',
      commit_title: input.commitTitle,
      commit_message: input.commitMessage,
    });

    this.logger.log(
      `[github] PR #${input.prNumber} mergeado a ${owner}/${repo} (sha=${result.data.sha?.slice(0, 7) ?? 'null'})`,
    );

    return {
      merged: result.data.merged,
      sha: result.data.sha ?? null,
    };
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
      this.logger.log(`[github] branch borrada: ${owner}/${repo} ${branchName}`);
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
