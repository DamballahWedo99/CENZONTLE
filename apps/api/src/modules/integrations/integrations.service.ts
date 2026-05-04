import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  IntegrationProvider,
  LinearConfig,
  ConnectionStatus,
  IntegrationConfigResponse,
} from '@cenzontle/shared';
import { DEFAULT_LINEAR_MAPPING } from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../vault/crypto.service';
import { TrackerProviderFactory } from './providers/tracker-provider.factory';
import type { SaveLinearConfigDto } from './dto/save-linear-config.dto';
import type { TestLinearConnectionDto } from './dto/test-linear-connection.dto';
import type {
  TestConnectionResult,
  TrackerProvider,
} from './providers/tracker-provider.interface';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly factory: TrackerProviderFactory,
  ) {}

  /**
   * Fachada para que módulos consumidores (proyectos) no importen el factory
   * directamente — reduce el acoplamiento al interior de este módulo.
   */
  async getProvider(provider: IntegrationProvider): Promise<TrackerProvider> {
    return this.factory.get(provider);
  }

  async getConfigOrNull(
    provider: IntegrationProvider,
  ): Promise<IntegrationConfigResponse | null> {
    const row = await this.prisma.integrationConfig.findUnique({ where: { provider } });
    if (!row) return null;
    return this.toResponse(row);
  }

  async saveLinearConfig(
    dto: SaveLinearConfigDto,
    createdBy?: string,
  ): Promise<IntegrationConfigResponse> {
    const existing = await this.prisma.integrationConfig.findUnique({
      where: { provider: 'linear' },
    });

    let apiKeyCiphertext: string;
    let apiKeyIv: string;
    let apiKeyAuthTag: string;

    let apiKeyMasked: string;
    if (dto.apiKey) {
      const enc = this.crypto.encrypt(dto.apiKey);
      apiKeyCiphertext = enc.ciphertext;
      apiKeyIv = enc.iv;
      apiKeyAuthTag = enc.authTag;
      apiKeyMasked = CryptoService.mask(dto.apiKey);
    } else if (existing) {
      // Edit metadata sin rotar key — preserva la cifrada existente.
      apiKeyCiphertext = existing.apiKeyCiphertext;
      apiKeyIv = existing.apiKeyIv;
      apiKeyAuthTag = existing.apiKeyAuthTag;
      apiKeyMasked = existing.apiKeyMasked ?? '••••••••';
    } else {
      throw new NotFoundException(
        'No hay API key existente. Provee `apiKey` para crear la configuración.',
      );
    }

    const metadata: LinearConfig = {
      apiKey: '', // NUNCA se persiste plaintext — el field existe en el shape canónico
      teamId: dto.teamId,
      teamName: dto.teamName,
      workspaceSlug: dto.workspaceSlug,
      projectId: dto.projectId ?? null,
      projectName: dto.projectName ?? null,
    };

    const fieldMapping = (existing?.fieldMapping as object) ?? DEFAULT_LINEAR_MAPPING;

    const saved = await this.prisma.integrationConfig.upsert({
      where: { provider: 'linear' },
      create: {
        provider: 'linear',
        apiKeyCiphertext,
        apiKeyIv,
        apiKeyAuthTag,
        apiKeyMasked,
        metadata: this.stripSensitive(metadata),
        fieldMapping,
        status: 'disconnected',
        createdBy: createdBy ?? null,
        lastModifiedBy: createdBy ?? null,
      },
      update: {
        apiKeyCiphertext,
        apiKeyIv,
        apiKeyAuthTag,
        apiKeyMasked,
        metadata: this.stripSensitive(metadata),
        lastModifiedBy: createdBy ?? null,
      },
    });

    this.logger.log(
      `[saveLinearConfig] actor=${createdBy ?? '∅'} team=${dto.teamId} workspace=${dto.workspaceSlug} rotatedKey=${!!dto.apiKey}`,
    );

    return this.toResponse(saved);
  }

  async testLinearConnection(
    dto: TestLinearConnectionDto,
  ): Promise<TestConnectionResult & { updatedAt?: string }> {
    // Cuando el caller pasa apiKey explícito, lo trata como un test transitorio
    // (caso "validar antes de guardar"). En ese modo NO tocamos el status
    // persistido — dos users testeando con keys diferentes no deben corromper
    // el estado del config guardado por un tercero.
    const isTransientTest = !!dto.apiKey;

    const persisted = await this.prisma.integrationConfig.findUnique({
      where: { provider: 'linear' },
    });

    let apiKey = dto.apiKey;
    if (!apiKey) {
      if (!persisted) {
        return {
          ok: false,
          error: 'Sin API key — provee `apiKey` o guarda primero la configuración.',
        };
      }
      apiKey = this.crypto.decrypt({
        ciphertext: persisted.apiKeyCiphertext,
        iv: persisted.apiKeyIv,
        authTag: persisted.apiKeyAuthTag,
      });
    }

    // Fallback al config persistido si el caller no pasó metadata (caso
    // "re-validar la config existente sin reescribir el form").
    const persistedMeta = (persisted?.metadata ?? null) as LinearConfig | null;
    const teamId = dto.teamId ?? persistedMeta?.teamId;
    const teamName = dto.teamName ?? persistedMeta?.teamName;
    const workspaceSlug = dto.workspaceSlug ?? persistedMeta?.workspaceSlug;
    if (!teamId || !teamName || !workspaceSlug) {
      return {
        ok: false,
        error:
          'Faltan campos requeridos (teamId, teamName, workspaceSlug). Completa el form o guarda primero.',
      };
    }

    const metadata: LinearConfig = {
      apiKey: '',
      teamId,
      teamName,
      workspaceSlug,
      projectId: dto.projectId ?? persistedMeta?.projectId ?? null,
      projectName: dto.projectName ?? persistedMeta?.projectName ?? null,
    };

    const provider = this.factory.buildEphemeral('linear', apiKey, metadata);
    const result = await provider.testConnection();

    // Solo actualiza status persistido si NO es un test transitorio Y existe
    // config previa.
    if (!isTransientTest && persisted) {
      const status: ConnectionStatus = result.ok ? 'connected' : 'error';
      // El `result.error` ya viene sanitizado del provider, pero lo truncamos
      // de nuevo aquí defensivamente — esta columna se devuelve en GET.
      const sanitizedError = result.ok
        ? null
        : (result.error ?? 'unknown error').slice(0, 200);
      const updated = await this.prisma.integrationConfig.update({
        where: { provider: 'linear' },
        data: {
          status,
          lastTestedAt: new Date(),
          lastError: sanitizedError,
        },
      });
      return { ...result, updatedAt: updated.updatedAt.toISOString() };
    }

    return result;
  }

  async deleteConfig(provider: IntegrationProvider): Promise<void> {
    const row = await this.prisma.integrationConfig.findUnique({ where: { provider } });
    if (!row) throw new NotFoundException(`No hay configuración para "${provider}"`);
    await this.prisma.integrationConfig.delete({ where: { provider } });
    this.logger.log(`[deleteConfig] removed integration ${provider}`);
  }

  /** Marca un sync exitoso — llamado por proyectos tras publishToTracker. */
  async markSyncedAt(provider: IntegrationProvider): Promise<void> {
    await this.prisma.integrationConfig
      .update({
        where: { provider },
        data: { lastSyncedAt: new Date() },
      })
      .catch(() => undefined);
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private toResponse(row: {
    provider: string;
    apiKeyMasked: string | null;
    metadata: unknown;
    status: string;
    lastTestedAt: Date | null;
    lastSyncedAt: Date | null;
    lastError: string | null;
    updatedAt: Date;
  }): IntegrationConfigResponse {
    return {
      provider: row.provider as IntegrationProvider,
      status: row.status as ConnectionStatus,
      // Lee el masked precomputado al save — evita decrypt en hot path (CWE-316).
      maskedKey: row.apiKeyMasked ?? '••••••••',
      metadata: row.metadata as LinearConfig,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      lastError: row.lastError,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Garantiza que el campo `apiKey` nunca llegue al JSONB persistido. */
  private stripSensitive(metadata: LinearConfig): object {
    const { apiKey: _ignored, ...safe } = metadata;
    return safe;
  }
}
