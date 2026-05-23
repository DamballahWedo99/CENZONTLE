import { ExternalSecretsService } from './external-secrets.service';
import { CryptoService } from '../vault/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPinoLogger } from '../../common/testing/mock-pino-logger';

/**
 * Tests de `ExternalSecretsService.getAllPlaintext` — el método que el worker
 * del Forge consume (vía `AgentRunService.materializeClaim`) para recibir los
 * secretos del org desencriptados en cada claim.
 *
 * Usa un `CryptoService` REAL (round-trip genuino encrypt→decrypt) con un
 * Prisma mockeado. `VAULT_ENCRYPTION_KEY` se setea acá para el ctor del
 * CryptoService — el salt scrypt es estable, así que encrypt y decrypt usan
 * la misma key derivada.
 */
process.env.VAULT_ENCRYPTION_KEY =
  process.env.VAULT_ENCRYPTION_KEY ?? 'test-vault-key-at-least-16-chars';

function makeMockPrisma(rows: unknown[]): PrismaService {
  return {
    externalSecret: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService;
}

describe('ExternalSecretsService.getAllPlaintext', () => {
  const crypto = new CryptoService(createMockPinoLogger());

  /** Construye una fila de external_secret encriptada de verdad. */
  function encryptedRow(
    id: string,
    name: string,
    value: string,
    vendor: string | null,
  ) {
    const enc = crypto.encrypt(value);
    return {
      id,
      name,
      vendor,
      description: null,
      tokenCiphertext: enc.ciphertext,
      tokenIv: enc.iv,
      tokenAuthTag: enc.authTag,
      createdBy: null,
      lastRotatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('desencripta todos los secretos (round-trip) y preserva name/vendor', async () => {
    const prisma = makeMockPrisma([
      encryptedRow('id-1', 'STRIPE_API_KEY', 'sk_live_secret_one', 'Stripe'),
      encryptedRow('id-2', 'TWILIO_AUTH_TOKEN', 'twilio_secret_two', 'Twilio'),
    ]);
    const service = new ExternalSecretsService(
      prisma,
      crypto,
      createMockPinoLogger(),
    );

    const out = await service.getAllPlaintext();

    expect(out).toEqual([
      { name: 'STRIPE_API_KEY', value: 'sk_live_secret_one', vendor: 'Stripe' },
      { name: 'TWILIO_AUTH_TOKEN', value: 'twilio_secret_two', vendor: 'Twilio' },
    ]);
  });

  it('omite un secreto corrupto sin lanzar — no rompe el resto del claim', async () => {
    // tokenIv/tokenAuthTag con longitudes inválidas para AES-256-GCM →
    // `crypto.decrypt` lanza. Simula una key rotada o un dato corrupto.
    const corruptRow = {
      id: 'id-corrupt',
      name: 'CORRUPT_SECRET',
      vendor: null,
      description: null,
      tokenCiphertext: 'not-valid-ciphertext',
      tokenIv: 'AAAA',
      tokenAuthTag: 'BBBB',
      createdBy: null,
      lastRotatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = makeMockPrisma([
      encryptedRow('id-ok', 'GOOD_SECRET', 'value_that_is_fine', 'VendorOk'),
      corruptRow,
    ]);
    const service = new ExternalSecretsService(
      prisma,
      crypto,
      createMockPinoLogger(),
    );

    // No debe lanzar — el corrupto se omite, el bueno sobrevive.
    const out = await service.getAllPlaintext();

    expect(out).toEqual([
      { name: 'GOOD_SECRET', value: 'value_that_is_fine', vendor: 'VendorOk' },
    ]);
  });

  it('org sin secretos registrados → array vacío', async () => {
    const prisma = makeMockPrisma([]);
    const service = new ExternalSecretsService(
      prisma,
      crypto,
      createMockPinoLogger(),
    );

    expect(await service.getAllPlaintext()).toEqual([]);
  });
});
