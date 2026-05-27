import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../vault/crypto.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Service singleton para gestionar la API key de Anthropic a nivel de
 * organización. Encripta con AES-256-GCM (mismo CryptoService que usan
 * VaultConfig/CodeRepository/ExternalSecret).
 *
 * Modelo `OrgAnthropicConfig` tiene PK fija `id='global'` — siempre 1 fila.
 *
 * Uso típico:
 *  - Alta Gerencia setea/rota la key desde un endpoint admin (PUT /factory/anthropic-config)
 *  - FleetService.claimStory() llama `getApiKeyPlaintext()` y reenvía al worker
 *  - Los services de generación (épicas/historias/diagramas) también consumen
 *    `getApiKeyPlaintext()` para construir su cliente Anthropic en runtime
 *  - El plaintext NUNCA se loguea ni persiste en otro lugar
 *
 * Caching del plaintext (TTL 5min, in-memory):
 *  - Reduce queries a Postgres + decrypt en hot paths (claim-story, generate)
 *  - Invalidación coordinada en `setApiKey` (rotación instantánea)
 *  - TTL absoluto (no sliding) — out-of-band rotations (SQL directo) se ven
 *    en máximo CACHE_TTL_MS sin necesidad de bounce del server
 */
@Injectable()
export class OrgAnthropicConfigService implements OnApplicationBootstrap {
  private static readonly SINGLETON_ID = 'global';
  // TTL de 5 min. Compromiso entre:
  //  - Reducir queries a Postgres (cada N requests reusa el plaintext)
  //  - Rotación: invalidamos manualmente en setApiKey, así es instantánea
  //  - Si setApiKey nunca se llama (deploy con key estática), el cache
  //    expira solo cada 5 min y se refresca de BD — protege contra
  //    rotaciones out-of-band (e.g. SQL directo al DB).
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private cachedPlaintext: string | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @InjectPinoLogger(OrgAnthropicConfigService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Health check al arrancar: log warning si la key no está configurada,
   * o log info con maskedKey si sí. Esto da visibilidad al operador en el
   * boot del server, antes de que el primer usuario descubra el error 401.
   *
   * NO bloquea el boot — el server arranca igual sin key. El warning es solo
   * señalización.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const config = await this.prisma.orgAnthropicConfig.findUnique({
        where: { id: OrgAnthropicConfigService.SINGLETON_ID },
      });
      if (!config?.apiKeyCiphertext) {
        this.logger.warn(
          '[boot] Anthropic API key NOT configured — la generación de épicas/historias/diagramas y los workers del Forge fallarán hasta configurar la key en /factory/settings',
        );
      } else {
        this.logger.info(
          { maskedKey: config.maskedKey, updatedBy: config.updatedBy },
          `[boot] Anthropic API key configured — maskedKey=${config.maskedKey} updatedBy=${config.updatedBy}`,
        );
      }
    } catch (err) {
      // Failure mode: si Prisma no responde al boot (DB caída), log error
      // pero no bloqueamos el arranque — el error real se mostrará al primer
      // intento de uso.
      this.logger.error(
        { err: (err as Error)?.message },
        '[boot] Failed to check Anthropic API key configuration — DB unreachable?',
      );
    }
  }

  /**
   * Lee la API key plaintext (desencriptada). Throws si no hay config setteada.
   *
   * Usado en hot path de `claimStory` y en los services de generación
   * (épicas/historias/diagramas). El primer hit del ciclo TTL paga query +
   * decrypt; los subsiguientes (hasta CACHE_TTL_MS) regresan desde memoria.
   *
   * SECURITY: el plaintext NUNCA se loguea. El return value es consumido
   * inmediatamente por el caller que lo manda al worker o construye un cliente
   * Anthropic. El cache vive solo en memoria del proceso — no persiste a
   * disco ni a Redis.
   */
  async getApiKeyPlaintext(): Promise<string> {
    // Cache hit: plaintext fresco. Saltar query + decrypt.
    if (this.cachedPlaintext && Date.now() < this.cacheExpiresAt) {
      return this.cachedPlaintext;
    }

    // Cache miss/expired: leer de BD + decrypt.
    const config = await this.prisma.orgAnthropicConfig.findUnique({
      where: { id: OrgAnthropicConfigService.SINGLETON_ID },
    });

    if (!config || !config.apiKeyCiphertext || !config.apiKeyIv || !config.apiKeyAuthTag) {
      throw new NotFoundException(
        'Anthropic API key no configurada. Alta Gerencia debe setearla en /factory/settings antes de que los workers puedan procesar historias.',
      );
    }

    const plaintext = this.crypto.decrypt({
      ciphertext: config.apiKeyCiphertext,
      iv: config.apiKeyIv,
      authTag: config.apiKeyAuthTag,
    });

    // Cache para próximas llamadas. TTL absoluto (no sliding).
    this.cachedPlaintext = plaintext;
    this.cacheExpiresAt = Date.now() + OrgAnthropicConfigService.CACHE_TTL_MS;

    return plaintext;
  }

  /**
   * Setea/rota la API key. Plaintext se encripta y se guarda solo el ciphertext
   * + IV + authTag. El maskedKey se guarda para mostrar en UI (last 4 chars).
   *
   * Idempotente: upsert con id='global'. Rotaciones futuras solo updatean.
   *
   * Invalida el cache in-memory para que la próxima `getApiKeyPlaintext()`
   * lea desde BD — crítico para que rotaciones se reflejen inmediatamente
   * sin esperar TTL.
   */
  async setApiKey(plaintext: string, updatedBy: string): Promise<void> {
    if (!plaintext || plaintext.length < 10) {
      // BadRequestException → 400 al cliente. La DTO `SetAnthropicKeyDto` ya
      // valida `MinLength: 20` + regex `^sk-(ant-)?...`, así que este check
      // es defense-in-depth — si la DTO se modifica en el futuro, mantenemos
      // el 400 correcto en lugar de un 500 (Error plano).
      throw new BadRequestException('API key inválida (mínimo 10 chars)');
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

    // Invalidar cache al rotar — la próxima getApiKeyPlaintext() leerá fresh.
    // Crítico para que rotaciones se reflejen inmediatamente sin esperar TTL.
    this.cachedPlaintext = null;
    this.cacheExpiresAt = 0;

    this.logger.info({ updatedBy, maskedKey }, `[setApiKey] key rotated by=${updatedBy} maskedKey=${maskedKey}`);
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
