import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../vault/crypto.service';

/**
 * Service singleton para gestionar la API key de Anthropic a nivel de
 * organización. Encripta con AES-256-GCM (mismo CryptoService que usan
 * VaultConfig/CodeRepository/ExternalSecret).
 *
 * Modelo `OrgAnthropicConfig` tiene PK fija `id='global'` — siempre 1 fila.
 *
 * Uso típico:
 *  - Alta Gerencia setea/rota la key desde un endpoint admin (TODO Sprint 3)
 *  - FleetService.claimStory() llama `getApiKeyPlaintext()` y reenvía al worker
 *  - El plaintext NUNCA se loguea ni persiste en otro lugar
 */
@Injectable()
export class OrgAnthropicConfigService {
  private readonly logger = new Logger(OrgAnthropicConfigService.name);
  private static readonly SINGLETON_ID = 'global';

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Lee la API key plaintext (desencriptada). Throws si no hay config setteada.
   *
   * Usado en hot path de `claimStory` — debe ser rápido. El cost del decrypt
   * es ~1ms para una key de 100 bytes.
   *
   * SECURITY: el plaintext NUNCA se loguea. El return value es consumido
   * inmediatamente por el caller que lo manda en el response al worker.
   */
  async getApiKeyPlaintext(): Promise<string> {
    const config = await this.prisma.orgAnthropicConfig.findUnique({
      where: { id: OrgAnthropicConfigService.SINGLETON_ID },
    });

    if (!config || !config.apiKeyCiphertext || !config.apiKeyIv || !config.apiKeyAuthTag) {
      throw new NotFoundException(
        'Anthropic API key no configurada. Alta Gerencia debe setearla en /factory/settings antes de que los workers puedan procesar historias.',
      );
    }

    return this.crypto.decrypt({
      ciphertext: config.apiKeyCiphertext,
      iv: config.apiKeyIv,
      authTag: config.apiKeyAuthTag,
    });
  }

  /**
   * Setea/rota la API key. Plaintext se encripta y se guarda solo el ciphertext
   * + IV + authTag. El maskedKey se guarda para mostrar en UI (last 4 chars).
   *
   * Idempotente: upsert con id='global'. Rotaciones futuras solo updatean.
   */
  async setApiKey(plaintext: string, updatedBy: string): Promise<void> {
    if (!plaintext || plaintext.length < 10) {
      throw new Error('API key inválida (mínimo 10 chars)');
    }

    const encrypted = this.crypto.encrypt(plaintext);
    const maskedKey = `sk-...${plaintext.slice(-4)}`;

    await this.prisma.orgAnthropicConfig.upsert({
      where: { id: OrgAnthropicConfigService.SINGLETON_ID },
      create: {
        id: OrgAnthropicConfigService.SINGLETON_ID,
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        maskedKey,
        updatedBy,
      },
      update: {
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        maskedKey,
        updatedBy,
      },
    });

    this.logger.log(`[org-anthropic] key rotated by=${updatedBy} maskedKey=${maskedKey}`);
  }

  /**
   * Devuelve metadata pública (maskedKey + updatedAt) sin plaintext.
   * Para mostrar en UI de admin.
   */
  async getPublicConfig() {
    const config = await this.prisma.orgAnthropicConfig.findUnique({
      where: { id: OrgAnthropicConfigService.SINGLETON_ID },
    });
    if (!config) {
      return { configured: false, maskedKey: null, updatedAt: null, updatedBy: null };
    }
    return {
      configured: !!config.apiKeyCiphertext,
      maskedKey: config.maskedKey,
      updatedAt: config.updatedAt.toISOString(),
      updatedBy: config.updatedBy,
    };
  }
}
