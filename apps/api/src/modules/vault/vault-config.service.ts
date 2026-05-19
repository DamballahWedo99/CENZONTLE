import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { Prisma, VaultConfig } from '@prisma/client';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Representación pública de un vault config — nunca incluye el token
 * ni sus campos de encriptación. Este es el shape que viaja vía API REST.
 */
export interface VaultConfigPublic {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  isActive: boolean;
  hasToken: boolean;
  tokenPreview: string;
  allowedPodIds: string[];
  roleDefaults: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  // Clone lifecycle — expuesto al frontend para que VaultSection pueda
  // mostrar badge de estado + botón Sincronizar sin un endpoint extra.
  cloneStatus: 'pending' | 'cloning' | 'ready' | 'error' | 'stale';
  lastSyncedSha: string | null;
  lastPulledAt: Date | null;
  lastSyncError: string | null;
}

export interface VaultConfigCreateInput {
  name: string;
  owner: string;
  repo: string;
  branch?: string;
  token: string;
  allowedPodIds?: string[];
  roleDefaults?: Record<string, string>;
}

export interface VaultConfigUpdateInput {
  name?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
  allowedPodIds?: string[];
  roleDefaults?: Record<string, string>;
}

/**
 * Gestiona la persistencia de vault configs en PG. Encripta tokens at-rest,
 * enforces el "solo uno activo" invariant, y provee un método de test de
 * conexión real contra la GitHub API.
 *
 * Auto-seed al primer boot: si la tabla está vacía pero existen env vars
 * `VAULT_GITHUB_*`, crea un vault "Default" automáticamente para no romper
 * setups existentes que venían de la arquitectura anterior.
 */
@Injectable()
export class VaultConfigService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    // forwardRef: VaultService injecta VaultConfigService → ciclo. Nest lo
    // resuelve hidratando el provider en el segundo pase del DI graph.
    // Necesitamos `invalidateActiveConfig()` tras mutaciones que afecten al
    // active vault (activate/update token/remove activo) — sin esto el cache
    // de 30s del VaultService sigue retornando el vault viejo y los writes
    // van al repo equivocado.
    @Inject(forwardRef(() => VaultService))
    private readonly vaultService: VaultService,
    @InjectPinoLogger(VaultConfigService.name) private readonly logger: PinoLogger,
  ) {}

  async onModuleInit() {
    await this.maybeSeedFromEnv();
  }

  /**
   * Auto-migración: si no hay vaults en PG pero existen env vars legacy,
   * crear un vault "Default" para preservar el setup existente.
   *
   * Idempotent bajo concurrent boot: atrapa P2002 (unique constraint en name)
   * que ocurre si dos instancias del API inicializan simultáneamente y ambas
   * pasan el count check antes de que la otra cree la row.
   */
  private async maybeSeedFromEnv() {
    const count = await this.prisma.vaultConfig.count();
    if (count > 0) return;

    const owner = process.env.VAULT_GITHUB_OWNER;
    const repo = process.env.VAULT_GITHUB_REPO;
    const branch = process.env.VAULT_GITHUB_BRANCH || 'main';
    const token = process.env.VAULT_GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      this.logger.info('[seed] No env vars VAULT_GITHUB_* — skipping auto-seed');
      return;
    }

    this.logger.info({ owner, repo }, `[seed] Auto-importing env vars as "Default" vault: ${owner}/${repo}`);
    const encrypted = this.crypto.encrypt(token);
    try {
      await this.prisma.vaultConfig.create({
        data: {
          name: 'Default',
          owner,
          repo,
          branch,
          tokenCiphertext: encrypted.ciphertext,
          tokenIv: encrypted.iv,
          tokenAuthTag: encrypted.authTag,
          isActive: true,
        },
      });
      this.logger.info('[seed] Auto-seeded Default vault from env vars');
      this.logger.warn(
        '[seed] ⚠ VAULT_GITHUB_TOKEN has been encrypted and stored in the DB. ' +
          'For security, REMOVE the VAULT_GITHUB_* env vars from your environment ' +
          'and restart the API. The token is now managed via Settings → Vault.',
      );
    } catch (err: any) {
      // P2002 = unique constraint violation (raza con otra instancia booteando)
      if (err?.code === 'P2002') {
        this.logger.info('[seed] Default vault already exists (concurrent boot), skipping');
        return;
      }
      throw err;
    }
  }

  // ─── Queries ───

  async findAll(): Promise<VaultConfigPublic[]> {
    const vaults = await this.prisma.vaultConfig.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return vaults.map((v) => this.toPublic(v));
  }

  /**
   * Devuelve solo los vaults accesibles para el usuario autenticado.
   * Misma lógica que el filtro client-side de DefinicionesContext, pero server-side.
   * - AltaGerencia → ve todos los vaults
   * - Otros roles → solo vaults donde allowedPodIds está vacío (sin restricción)
   *   o donde alguno de sus podIds coincide con allowedPodIds del vault.
   */
  async findAccessible(user: AuthenticatedUser): Promise<VaultConfigPublic[]> {
    const all = await this.findAll();
    if (user.role === UserRole.AltaGerencia) return all;
    const userPodIds = new Set(user.podIds ?? []);
    return all.filter(
      (v) => v.allowedPodIds.length === 0 || v.allowedPodIds.some((pid) => userPodIds.has(pid)),
    );
  }

  async findOne(id: string): Promise<VaultConfigPublic> {
    const vault = await this.prisma.vaultConfig.findUnique({ where: { id } });
    if (!vault) throw new NotFoundException('Vault no encontrado');
    return this.toPublic(vault);
  }

  /**
   * Devuelve el vault activo con su token en PLAINTEXT. Solo para uso interno
   * del VaultService — NUNCA exponer vía controller/HTTP.
   */
  async getActiveWithToken(): Promise<{ config: VaultConfig; token: string } | null> {
    const vault = await this.prisma.vaultConfig.findFirst({ where: { isActive: true } });
    if (!vault) return null;
    return this.decryptRow(vault);
  }

  /**
   * Devuelve un vault por ID con su token en plaintext. Usado por VaultCloneService
   * para clonar/pull incluso cuando no es el activo (ej: scheduled clone tras create).
   * Solo para uso interno — NUNCA exponer vía HTTP.
   */
  async getByIdWithToken(id: string): Promise<{ config: VaultConfig; token: string } | null> {
    const vault = await this.prisma.vaultConfig.findUnique({ where: { id } });
    if (!vault) return null;
    return this.decryptRow(vault);
  }

  private decryptRow(vault: VaultConfig): { config: VaultConfig; token: string } | null {
    if (!vault.tokenCiphertext || !vault.tokenIv || !vault.tokenAuthTag) return null;
    const token = this.crypto.decrypt({
      ciphertext: vault.tokenCiphertext,
      iv: vault.tokenIv,
      authTag: vault.tokenAuthTag,
    });
    return { config: vault, token };
  }

  // ─── Mutations ───

  async create(input: VaultConfigCreateInput): Promise<VaultConfigPublic> {
    this.validateInput(input);

    // Check name uniqueness
    const existing = await this.prisma.vaultConfig.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un vault con nombre "${input.name}"`);
    }

    const encrypted = this.crypto.encrypt(input.token!);
    const count = await this.prisma.vaultConfig.count();

    const vault = await this.prisma.vaultConfig.create({
      data: {
        name: input.name,
        owner: input.owner,
        repo: input.repo,
        branch: input.branch || 'main',
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        allowedPodIds: input.allowedPodIds ?? [],
        roleDefaults: input.roleDefaults ?? {},
        isActive: count === 0,
      },
    });

    this.logger.info({ name: vault.name, owner: vault.owner, repo: vault.repo }, `[create] name="${vault.name}" owner=${vault.owner} repo=${vault.repo} autoActive=${count === 0}`);
    return this.toPublic(vault);
  }

  async update(id: string, input: VaultConfigUpdateInput): Promise<VaultConfigPublic> {
    const existing = await this.prisma.vaultConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Vault no encontrado');

    // Check name uniqueness si cambió
    if (input.name && input.name !== existing.name) {
      const conflict = await this.prisma.vaultConfig.findUnique({
        where: { name: input.name },
      });
      if (conflict) {
        throw new ConflictException(`Ya existe un vault con nombre "${input.name}"`);
      }
    }

    const data: Prisma.VaultConfigUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.owner !== undefined) data.owner = input.owner;
    if (input.repo !== undefined) data.repo = input.repo;
    if (input.branch !== undefined) data.branch = input.branch;
    if (input.allowedPodIds !== undefined) data.allowedPodIds = input.allowedPodIds;
    if (input.roleDefaults !== undefined) data.roleDefaults = input.roleDefaults;

    if (input.token) {
      const encrypted = this.crypto.encrypt(input.token);
      data.tokenCiphertext = encrypted.ciphertext;
      data.tokenIv = encrypted.iv;
      data.tokenAuthTag = encrypted.authTag;
    }

    const vault = await this.prisma.vaultConfig.update({ where: { id }, data });
    this.logger.info({ id }, `[update] id=${id} fields=${Object.keys(data).join(',')}`);
    // Si se editó algún campo que forma parte del ActiveContext del
    // VaultService (token/owner/repo/branch) y este vault es el activo,
    // invalidamos el cache para que el próximo write use los valores nuevos.
    const affectsActiveContext =
      existing.isActive &&
      (data.tokenCiphertext !== undefined ||
        data.owner !== undefined ||
        data.repo !== undefined ||
        data.branch !== undefined);
    if (affectsActiveContext) {
      this.vaultService.invalidateActiveConfig();
    }
    return this.toPublic(vault);
  }

  async remove(id: string): Promise<void> {
    // Wrap delete + failover en UNA transacción para evitar la race donde
    // dos deletes concurrentes ven el mismo estado y dejan inconsistente la
    // flag `isActive` (más de uno o ninguno post-borrado).
    //
    // Permitimos eliminar TODOS los vaults — el usuario puede quedar sin
    // vault configurado intencionalmente (ej: borró el repo en GitHub y
    // quiere limpiar la config). Las features que requieren vault (creación
    // de iniciativas/épicas/historias) fallarán hasta que agregue un vault
    // nuevo, lo que es comportamiento correcto: mejor un error claro al
    // intentar usar la feature que un estado fantasma con vault que apunta
    // a un repo inexistente.
    const wasActive = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.vaultConfig.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Vault no encontrado');

      await tx.vaultConfig.delete({ where: { id } });

      // Si era el activo, activar otro automáticamente dentro de la misma tx
      // (si queda alguno). Si era el último, no hay sucesor — quedamos sin
      // vault activo y el VaultService.resolveContext lanzará error la
      // próxima vez que algo intente leer/escribir.
      if (existing.isActive) {
        const next = await tx.vaultConfig.findFirst({
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.vaultConfig.update({
            where: { id: next.id },
            data: { isActive: true },
          });
          this.logger.info({ name: next.name, existing_name: existing.name }, `[remove] Activated "${next.name}" after removing "${existing.name}"`);
        } else {
          this.logger.info({ name: existing.name }, `[remove] Removed last vault "${existing.name}" — system has no active vault now`);
        }
      }
      this.logger.info({ id, name: existing.name }, `[remove] id=${id} name="${existing.name}"`);
      return existing.isActive;
    });

    // Invalidar cache fuera de la tx (el cache vive en memoria de VaultService,
    // no en PG — la tx no lo afecta y queremos invalidar SOLO si el commit
    // de la tx fue exitoso).
    if (wasActive) {
      this.vaultService.invalidateActiveConfig();
    }
  }

  /**
   * Marca un vault como activo y desactiva todos los demás.
   * Transaccional para garantizar que solo hay uno activo.
   */
  async activate(id: string): Promise<VaultConfigPublic> {
    const existing = await this.prisma.vaultConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Vault no encontrado');

    if (existing.isActive) {
      return this.toPublic(existing);
    }

    const activated = await this.prisma.$transaction(async (tx) => {
      await tx.vaultConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.vaultConfig.update({
        where: { id },
        data: { isActive: true },
      });
    });

    this.logger.info({ id, name: activated.name }, `[activate] id=${id} name="${activated.name}"`);
    // CRÍTICO: invalidar el cache del active context en VaultService — sin
    // esto, los siguientes writes (épicas, historias, etc.) durante 30s
    // siguen yendo al vault viejo porque el cache no detecta el cambio.
    this.vaultService.invalidateActiveConfig();
    return this.toPublic(activated);
  }

  /**
   * Prueba la conexión a GitHub con el token del vault. Hace un GET /repos/{owner}/{repo}
   * y verifica que el token tiene acceso de lectura al contenido.
   */
  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    const vault = await this.prisma.vaultConfig.findUnique({ where: { id } });
    if (!vault) throw new NotFoundException('Vault no encontrado');

    if (!vault.tokenCiphertext || !vault.tokenIv || !vault.tokenAuthTag) {
      return { ok: false, message: 'Este vault no tiene un token PAT configurado (puede ser GitHub App).' };
    }
    const token = this.crypto.decrypt({
      ciphertext: vault.tokenCiphertext,
      iv: vault.tokenIv,
      authTag: vault.tokenAuthTag,
    });

    const octokit = new Octokit({ auth: token });
    try {
      const repoRes = await octokit.repos.get({ owner: vault.owner, repo: vault.repo });
      // El campo `permissions` solo se incluye para classic PATs con acceso directo.
      // GitHub Apps y fine-grained PATs frecuentemente lo omiten — en ese caso,
      // hacemos un probe adicional intentando leer el tree del branch activo.
      // Si el probe responde OK, el token tiene al menos acceso de lectura garantizado.
      const perms = (repoRes.data as any).permissions;
      if (perms && !perms.push && !perms.admin) {
        return {
          ok: false,
          message: 'El token tiene acceso de lectura pero no de escritura. Necesitas scope `repo` (classic PAT) o permiso `contents: write` (fine-grained PAT).',
        };
      }
      // Probe adicional: verificar que podemos listar el tree del branch.
      // Esto valida tanto el acceso del token como que el branch configurado existe.
      try {
        await octokit.repos.getBranch({ owner: vault.owner, repo: vault.repo, branch: vault.branch });
      } catch (branchErr: any) {
        if (branchErr?.status === 404) {
          return {
            ok: false,
            message: `El branch "${vault.branch}" no existe en el repositorio.`,
          };
        }
        throw branchErr;
      }
      return { ok: true, message: `Conectado: ${repoRes.data.full_name} (branch: ${vault.branch})` };
    } catch (err: any) {
      const status = err?.status ?? 0;
      if (status === 401) return { ok: false, message: 'Token inválido o expirado' };
      if (status === 404) return { ok: false, message: 'Repositorio no encontrado o sin acceso' };
      if (status === 403) return { ok: false, message: 'Token sin permisos suficientes o rate-limited' };
      return { ok: false, message: err?.message || 'Error desconocido al conectar con GitHub' };
    }
  }

  // ─── Helpers ───

  private validateInput(input: VaultConfigCreateInput) {
    if (!input.name || input.name.length < 1 || input.name.length > 100) {
      throw new BadRequestException('Nombre debe tener entre 1 y 100 caracteres');
    }
    if (!input.owner || !/^[a-zA-Z0-9-]+$/.test(input.owner)) {
      throw new BadRequestException('Owner inválido (solo alfanuméricos y guiones)');
    }
    if (!input.repo || !/^[a-zA-Z0-9._-]+$/.test(input.repo)) {
      throw new BadRequestException('Repo inválido (solo alfanuméricos, guiones, puntos y underscores)');
    }
    if (!input.token || input.token.length < 10) {
      throw new BadRequestException('Token inválido');
    }
  }

  /**
   * Convierte una row de DB a la representación pública segura.
   * Remueve los 3 campos de encriptación y reemplaza con un preview masked.
   */
  private toPublic(vault: VaultConfig): VaultConfigPublic {
    // Nunca desencriptamos aquí — el preview se construye con placeholders
    // fijos porque no queremos ni el trabajo ni el riesgo de tocar el token.
    return {
      id: vault.id,
      name: vault.name,
      owner: vault.owner,
      repo: vault.repo,
      branch: vault.branch,
      isActive: vault.isActive,
      hasToken: !!vault.tokenCiphertext,
      tokenPreview: 'ghp_' + '•'.repeat(20) + vault.id.slice(-4),
      allowedPodIds: vault.allowedPodIds,
      roleDefaults: (vault.roleDefaults as Record<string, string>) ?? {},
      createdAt: vault.createdAt,
      updatedAt: vault.updatedAt,
      cloneStatus: vault.cloneStatus,
      lastSyncedSha: vault.lastSyncedSha,
      lastPulledAt: vault.lastPulledAt,
      lastSyncError: vault.lastSyncError,
    };
  }
}
