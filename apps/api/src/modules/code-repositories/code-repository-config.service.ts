import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { Prisma, CodeRepository, CodeRepoCloneStatus } from '@prisma/client';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../vault/crypto.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Representación pública de un code repository — nunca incluye el token
 * ni sus campos de encriptación. Este es el shape que viaja vía API REST.
 */
export interface CodeRepositoryPublic {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  isActive: boolean;
  /** Cuando true, el Forge puede clonar+commitear+pushear+abrir PRs en este repo.
   *  Independiente de `isActive` (que solo da acceso de lectura a agentes). */
  forgeWritable: boolean;
  hasToken: boolean;
  tokenPreview: string;
  cloneStatus: CodeRepoCloneStatus;
  clonedAtPath: string | null;
  lastPulledAt: string | null;
  lastSyncedSha: string | null;
  lastSyncError: string | null;
  allowedPodIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CodeRepositoryCreateInput {
  name: string;
  owner: string;
  repo: string;
  branch?: string;
  token: string;
  allowedPodIds?: string[];
}

export interface CodeRepositoryUpdateInput {
  name?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
  allowedPodIds?: string[];
}

/**
 * Gestiona la persistencia de code repositories en PG. Encripta tokens at-rest
 * (reutiliza CryptoService del VaultModule), enforces "solo uno activo" invariant,
 * y provee testConnection contra GitHub API.
 *
 * Sin auto-seed desde env vars (a diferencia de Vault): este feature nace sin
 * legacy a migrar.
 */
@Injectable()
export class CodeRepositoryConfigService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    @InjectPinoLogger(CodeRepositoryConfigService.name) private readonly logger: PinoLogger,
  ) {}

  // ─── Queries ───

  async findAll(): Promise<CodeRepositoryPublic[]> {
    const repos = await this.prisma.codeRepository.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return repos.map((r) => this.toPublic(r));
  }

  async findAccessible(user: AuthenticatedUser): Promise<CodeRepositoryPublic[]> {
    const all = await this.findAll();
    if (user.role === UserRole.AltaGerencia) return all;
    const userPodIds = new Set(user.podIds ?? []);
    return all.filter(
      (r) => r.allowedPodIds.length === 0 || r.allowedPodIds.some((pid) => userPodIds.has(pid)),
    );
  }

  async findOne(id: string): Promise<CodeRepositoryPublic> {
    const repo = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!repo) throw new NotFoundException('Code repository no encontrado');
    return this.toPublic(repo);
  }

  /**
   * Devuelve TODOS los repos enabled con sus tokens en plaintext.
   * "isActive" ahora significa "enabled para uso del agente" — pueden
   * haber múltiples enabled al mismo tiempo (Opción C del plan).
   * Solo para uso interno de CodeRepoCloneService — NUNCA exponer vía HTTP.
   */
  async getEnabledWithTokens(): Promise<Array<{ config: CodeRepository; token: string }>> {
    const repos = await this.prisma.codeRepository.findMany({ where: { isActive: true } });
    return repos
      .map((r) => this.decryptRow(r))
      .filter((x): x is { config: CodeRepository; token: string } => x !== null);
  }

  /**
   * Devuelve los repos donde el Forge puede ESCRIBIR (clone + commit + push + PR).
   * Filtra por `forgeWritable=true` AND `isActive=true` — opt-in defensivo:
   * un repo debe estar enabled (read) Y explícitamente marcado como forgeWritable
   * (write) para ser destino del Forge. Esto evita que el Forge escriba
   * accidentalmente en un repo que solo se quería para read-only.
   *
   * Usado por GitHubService para resolver el clone URL al claim de stories.
   * Si retorna [], el Forge cae a sandbox mode (run sin push, sin PR).
   */
  async getForgeWritableWithTokens(): Promise<Array<{ config: CodeRepository; token: string }>> {
    const repos = await this.prisma.codeRepository.findMany({
      where: { isActive: true, forgeWritable: true },
    });
    return repos
      .map((r) => this.decryptRow(r))
      .filter((x): x is { config: CodeRepository; token: string } => x !== null);
  }

  /** Devuelve solo los enabled que ya tienen clone ready (para los tools del agente). */
  async findEnabled(): Promise<CodeRepositoryPublic[]> {
    const repos = await this.prisma.codeRepository.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return repos.map((r) => this.toPublic(r));
  }

  /**
   * Devuelve un repo por ID con su token en plaintext. Usado por CodeRepoCloneService
   * para clonar/pull incluso si no está activo (ej: scheduled clone después de create).
   */
  async getByIdWithToken(id: string): Promise<{ config: CodeRepository; token: string } | null> {
    const repo = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!repo) return null;
    return this.decryptRow(repo);
  }

  private decryptRow(repo: CodeRepository): { config: CodeRepository; token: string } | null {
    if (!repo.tokenCiphertext || !repo.tokenIv || !repo.tokenAuthTag) return null;
    const token = this.crypto.decrypt({
      ciphertext: repo.tokenCiphertext,
      iv: repo.tokenIv,
      authTag: repo.tokenAuthTag,
    });
    return { config: repo, token };
  }

  // ─── Mutations ───

  async create(input: CodeRepositoryCreateInput): Promise<CodeRepositoryPublic> {
    this.validateInput(input);

    const existing = await this.prisma.codeRepository.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new ConflictException(`Ya existe un code repository con nombre "${input.name}"`);
    }

    const encrypted = this.crypto.encrypt(input.token);
    const count = await this.prisma.codeRepository.count();

    const repo = await this.prisma.codeRepository.create({
      data: {
        name: input.name,
        owner: input.owner,
        repo: input.repo,
        branch: input.branch || 'main',
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        allowedPodIds: input.allowedPodIds ?? [],
        isActive: count === 0,
        cloneStatus: 'pending',
      },
    });

    this.logger.info({ name: repo.name, owner: repo.owner, repo: repo.repo }, `[create] name="${repo.name}" owner=${repo.owner} repo=${repo.repo} autoActive=${count === 0}`);
    return this.toPublic(repo);
  }

  async update(id: string, input: CodeRepositoryUpdateInput): Promise<CodeRepositoryPublic> {
    const existing = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code repository no encontrado');

    if (input.name && input.name !== existing.name) {
      const conflict = await this.prisma.codeRepository.findUnique({ where: { name: input.name } });
      if (conflict) {
        throw new ConflictException(`Ya existe un code repository con nombre "${input.name}"`);
      }
    }

    const data: Prisma.CodeRepositoryUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.owner !== undefined) data.owner = input.owner;
    if (input.repo !== undefined) data.repo = input.repo;
    if (input.branch !== undefined) data.branch = input.branch;
    if (input.allowedPodIds !== undefined) data.allowedPodIds = input.allowedPodIds;

    // Si owner/repo/branch cambian, marcamos el clone como stale para que el controller
    // pueda disparar un nuevo scheduleClone.
    if (input.owner !== undefined || input.repo !== undefined || input.branch !== undefined) {
      data.cloneStatus = 'stale';
    }

    if (input.token) {
      const encrypted = this.crypto.encrypt(input.token);
      data.tokenCiphertext = encrypted.ciphertext;
      data.tokenIv = encrypted.iv;
      data.tokenAuthTag = encrypted.authTag;
    }

    const repo = await this.prisma.codeRepository.update({ where: { id }, data });
    this.logger.info({ id }, `[update] id=${id} fields=${Object.keys(data).join(',')}`);
    return this.toPublic(repo);
  }

  /**
   * Eliminar un code repository. Como múltiples pueden estar enabled a la vez
   * (Opción C), no hay failover automático a otro — simplemente se elimina.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code repository no encontrado');
    await this.prisma.codeRepository.delete({ where: { id } });
    this.logger.info({ id, name: existing.name }, `[remove] id=${id} name="${existing.name}"`);
  }

  /**
   * Habilita un repo (isActive=true). A diferencia de Vault, NO desactiva los demás:
   * múltiples repos pueden estar habilitados simultáneamente (Opción C del plan).
   */
  async enable(id: string): Promise<CodeRepositoryPublic> {
    const existing = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code repository no encontrado');
    if (existing.isActive) return this.toPublic(existing);
    const updated = await this.prisma.codeRepository.update({ where: { id }, data: { isActive: true } });
    this.logger.info({ id, name: updated.name }, `[enable] id=${id} name="${updated.name}"`);
    return this.toPublic(updated);
  }

  /** Deshabilita un repo (isActive=false). No elimina nada — el clone queda en disco. */
  async disable(id: string): Promise<CodeRepositoryPublic> {
    const existing = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code repository no encontrado');
    if (!existing.isActive) return this.toPublic(existing);
    const updated = await this.prisma.codeRepository.update({ where: { id }, data: { isActive: false } });
    this.logger.info({ id, name: updated.name }, `[disable] id=${id} name="${updated.name}"`);
    return this.toPublic(updated);
  }

  /**
   * Activa el toggle `forgeWritable` para que este repo sea destino válido
   * de escritura del Forge. Requiere que `isActive=true` también — read es
   * pre-requisito para write.
   */
  async enableForgeWritable(id: string): Promise<CodeRepositoryPublic> {
    const existing = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code repository no encontrado');
    if (!existing.isActive) {
      throw new ConflictException(
        'El repo debe estar habilitado (isActive=true) antes de permitir escritura del Forge',
      );
    }
    if (existing.forgeWritable) return this.toPublic(existing);
    const updated = await this.prisma.codeRepository.update({
      where: { id },
      data: { forgeWritable: true },
    });
    this.logger.warn(
      `[forgeWritable.enable] id=${id} name="${updated.name}" — Forge ahora puede ESCRIBIR (commit/push/PR) en este repo`,
    );
    return this.toPublic(updated);
  }

  /** Desactiva escritura del Forge en este repo (vuelve a read-only). */
  async disableForgeWritable(id: string): Promise<CodeRepositoryPublic> {
    const existing = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code repository no encontrado');
    if (!existing.forgeWritable) return this.toPublic(existing);
    const updated = await this.prisma.codeRepository.update({
      where: { id },
      data: { forgeWritable: false },
    });
    this.logger.info({ id, name: updated.name }, `[forgeWritable.disable] id=${id} name="${updated.name}"`);
    return this.toPublic(updated);
  }

  /**
   * Test connection contra GitHub. No dispara un clone — solo valida token + repo + branch.
   */
  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    const repo = await this.prisma.codeRepository.findUnique({ where: { id } });
    if (!repo) throw new NotFoundException('Code repository no encontrado');

    if (!repo.tokenCiphertext || !repo.tokenIv || !repo.tokenAuthTag) {
      return { ok: false, message: 'Este repositorio no tiene un token PAT configurado.' };
    }
    const token = this.crypto.decrypt({
      ciphertext: repo.tokenCiphertext,
      iv: repo.tokenIv,
      authTag: repo.tokenAuthTag,
    });

    const octokit = new Octokit({ auth: token });
    try {
      const repoRes = await octokit.repos.get({ owner: repo.owner, repo: repo.repo });
      try {
        await octokit.repos.getBranch({ owner: repo.owner, repo: repo.repo, branch: repo.branch });
      } catch (branchErr: any) {
        if (branchErr?.status === 404) {
          return { ok: false, message: `El branch "${repo.branch}" no existe en el repositorio.` };
        }
        throw branchErr;
      }
      return { ok: true, message: `Conectado: ${repoRes.data.full_name} (branch: ${repo.branch})` };
    } catch (err: any) {
      const status = err?.status ?? 0;
      if (status === 401) return { ok: false, message: 'Token inválido o expirado' };
      if (status === 404) return { ok: false, message: 'Repositorio no encontrado o sin acceso' };
      if (status === 403) return { ok: false, message: 'Token sin permisos suficientes o rate-limited' };
      return { ok: false, message: err?.message || 'Error desconocido al conectar con GitHub' };
    }
  }

  // ─── Helpers ───

  private validateInput(input: CodeRepositoryCreateInput) {
    if (!input.name || input.name.length < 1 || input.name.length > 100) {
      throw new BadRequestException('Nombre debe tener entre 1 y 100 caracteres');
    }
    if (!input.owner || !/^[a-zA-Z0-9-]+$/.test(input.owner)) {
      throw new BadRequestException('Owner inválido (solo alfanuméricos y guiones)');
    }
    if (!input.repo || !/^[a-zA-Z0-9._-]+$/.test(input.repo)) {
      throw new BadRequestException('Repo inválido');
    }
    if (!input.token || input.token.length < 10) {
      throw new BadRequestException('Token inválido');
    }
  }

  /**
   * Convierte una row de DB a la representación pública segura.
   * Fechas se serializan como ISO strings para que el API contract sea consistente
   * con lo que consumen los clientes después de JSON serialization.
   */
  private toPublic(repo: CodeRepository): CodeRepositoryPublic {
    return {
      id: repo.id,
      name: repo.name,
      owner: repo.owner,
      repo: repo.repo,
      branch: repo.branch,
      isActive: repo.isActive,
      forgeWritable: repo.forgeWritable,
      hasToken: !!repo.tokenCiphertext,
      tokenPreview: 'ghp_' + '•'.repeat(20) + repo.id.slice(-4),
      cloneStatus: repo.cloneStatus,
      clonedAtPath: repo.clonedAtPath,
      lastPulledAt: repo.lastPulledAt?.toISOString() ?? null,
      lastSyncedSha: repo.lastSyncedSha,
      lastSyncError: repo.lastSyncError,
      allowedPodIds: repo.allowedPodIds,
      createdAt: repo.createdAt.toISOString(),
      updatedAt: repo.updatedAt.toISOString(),
    };
  }
}
