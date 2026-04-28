import { Injectable, NotFoundException } from '@nestjs/common';
import type { IntegrationProvider, LinearConfig } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../vault/crypto.service';
import { LinearTrackerProvider } from './linear-tracker.provider';
import { JiraTrackerProvider } from './jira-tracker.provider';
import type { TrackerProvider } from './tracker-provider.interface';

@Injectable()
export class TrackerProviderFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Carga la `IntegrationConfig` del provider, desencripta la API key, y
   * construye una instancia fresh del cliente. No cacheamos: las credenciales
   * pueden rotarse y un cache silencioso usaría la key vieja.
   */
  async get(provider: IntegrationProvider): Promise<TrackerProvider> {
    const row = await this.prisma.integrationConfig.findUnique({
      where: { provider },
    });
    if (!row) {
      throw new NotFoundException(
        `No hay configuración guardada para el proveedor "${provider}". Configúralo primero en Settings.`,
      );
    }

    const apiKey = this.crypto.decrypt({
      ciphertext: row.apiKeyCiphertext,
      iv: row.apiKeyIv,
      authTag: row.apiKeyAuthTag,
    });

    if (provider === 'linear') {
      return new LinearTrackerProvider(apiKey, row.metadata as unknown as LinearConfig);
    }
    if (provider === 'jira') {
      return new JiraTrackerProvider();
    }
    throw new NotFoundException(`Proveedor "${provider}" no soportado`);
  }

  /**
   * Variante para el flujo de "test connection" donde el usuario aún no ha
   * guardado la config — se construye con la API key + metadata que viene
   * en el request, sin tocar BD.
   */
  buildEphemeral(
    provider: IntegrationProvider,
    apiKey: string,
    metadata: LinearConfig,
  ): TrackerProvider {
    if (provider === 'linear') {
      return new LinearTrackerProvider(apiKey, metadata);
    }
    if (provider === 'jira') {
      return new JiraTrackerProvider();
    }
    throw new NotFoundException(`Proveedor "${provider}" no soportado`);
  }
}
