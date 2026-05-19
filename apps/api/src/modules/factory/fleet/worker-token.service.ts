import {
  Injectable,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface GeneratedToken {
  /** Plaintext devuelto UNA SOLA VEZ al crear. Después solo existe el hash. */
  plaintext: string;
  /** Primeros chars del plaintext para mostrar en UI (worker_a3f8c2e9). */
  prefix: string;
  /** ID de la fila WorkerToken creada. */
  id: string;
}

/**
 * Service que gestiona el ciclo de vida de tokens Bearer para workers.
 *
 * Patrón Stripe: el plaintext se devuelve UNA sola vez al crear y luego
 * solo se guarda su SHA-256 hex hash. La revocación es soft (`revokedAt` set)
 * y el guard rechaza con 401 inmediatamente.
 *
 * Hashing: SHA-256 (no bcrypt) — los tokens son random 256-bit strings
 * (no passwords humanos brute-forceables) y los workers traen el token en
 * cada request, así que la latencia importa.
 */
@Injectable()
export class WorkerTokenService {
  constructor(private readonly prisma: PrismaService,
    @InjectPinoLogger(WorkerTokenService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Genera un token nuevo para un nodo. Devuelve el plaintext UNA vez —
   * el caller debe mostrarlo al usuario inmediatamente. Después solo el
   * hash y el prefix son recuperables.
   *
   * Format: `worker_<32 chars base32>` (52 chars total). Base32 elegido
   * por: (a) safe en URLs/headers sin escape, (b) googleable como leaked
   * secret format, (c) 32 chars × 5 bits = 160 bits de entropía (suficiente
   * para tokens no brute-forceables sin necesidad de bcrypt).
   */
  async generate(nodeId: string, createdById: string | null): Promise<GeneratedToken> {
    const plaintext = this.generatePlaintext();
    const tokenHash = this.hashToken(plaintext);
    // SECURITY (CWE-532): prefix corto (`worker_` + 4 chars = 8 visibles)
    // para mostrar en UI. Antes guardábamos 12 chars que leakeaban 25 bits
    // del secret a logs/changelog (security-reviewer #2 MEDIUM 2026-05-06).
    // 4 chars = 20 bits de fixed prefix + ~135 bits del secret restante,
    // suficientemente identificable para humanos sin facilitar brute force.
    const prefix = plaintext.slice(0, 11); // "worker_axxx" — 4 chars del secret

    const token = await this.prisma.workerToken.create({
      data: {
        nodeId,
        tokenHash,
        prefix,
        createdById,
      },
    });

    this.logger.info(
      `[token] generated tokenId=${token.id} nodeId=${nodeId} prefix=${prefix} createdBy=${createdById ?? 'system'}`,
    );

    return { plaintext, prefix, id: token.id };
  }

  /**
   * Resuelve un plaintext token a su row WorkerToken. Devuelve null si:
   *  - No existe (no match en tokenHash)
   *  - Está revocado (revokedAt set)
   *  - Está expirado (expiresAt < now)
   *
   * Se usa en `WorkerAuthGuard` en cada request del worker.
   *
   * NO actualiza `lastUsedAt` aquí para evitar write contention en el hot
   * path de auth — eso lo hace `touchLastUsed` en background.
   */
  async resolve(plaintext: string): Promise<{ id: string; nodeId: string } | null> {
    if (!plaintext.startsWith('worker_') || plaintext.length < 20) return null;
    const tokenHash = this.hashToken(plaintext);

    const token = await this.prisma.workerToken.findUnique({
      where: { tokenHash },
      select: { id: true, nodeId: true, revokedAt: true, expiresAt: true },
    });

    if (!token) return null;
    if (token.revokedAt !== null) return null;
    if (token.expiresAt && token.expiresAt < new Date()) return null;

    return { id: token.id, nodeId: token.nodeId };
  }

  /**
   * Actualiza `lastUsedAt` del token. Llamado fire-and-forget desde el
   * guard después de resolver — no bloquea el request si falla.
   */
  async touchLastUsed(tokenId: string): Promise<void> {
    try {
      await this.prisma.workerToken.update({
        where: { id: tokenId },
        data: { lastUsedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn({ tokenId, message: (err as Error).message }, `[token] touchLastUsed failed tokenId=${tokenId}: ${(err as Error).message}`);
    }
  }

  /**
   * Lista los tokens de un nodo (sin plaintext, solo prefix + metadata).
   * Para UI de "Tokens" en la pantalla de detalle del nodo.
   */
  async listByNode(nodeId: string) {
    return this.prisma.workerToken.findMany({
      where: { nodeId },
      select: {
        id: true,
        prefix: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
        createdById: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoca un token. Soft revoke (set `revokedAt`) — preservamos la fila
   * para auditoría. Después de revocar, los workers que tengan ese token
   * recibirán 401 en el próximo request.
   */
  async revoke(tokenId: string, revokedById: string | null): Promise<void> {
    await this.prisma.workerToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    this.logger.info({ tokenId }, `[token] revoke tokenId=${tokenId} by=${revokedById ?? 'system'}`);
  }

  /**
   * Revoca TODOS los tokens activos de un nodo. Usado al eliminar el nodo
   * (soft delete con `retiredAt`) — un nodo retirado no debería poder
   * autenticar más.
   */
  async revokeAllForNode(nodeId: string, revokedById: string | null): Promise<number> {
    const result = await this.prisma.workerToken.updateMany({
      where: { nodeId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.info(
      `[token] revokeAllForNode nodeId=${nodeId} count=${result.count} by=${revokedById ?? 'system'}`,
    );
    return result.count;
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private generatePlaintext(): string {
    // 20 bytes random → base32 ≈ 32 chars (160 bits de entropía)
    const random = randomBytes(20);
    const base32 = this.toBase32(random);
    return `worker_${base32}`;
  }

  private hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  /**
   * Base32 RFC 4648 sin padding. Implementación inline para evitar dep
   * extra. 5 bits por char → 20 bytes = 32 chars.
   */
  private toBase32(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) {
      output += alphabet[(value << (5 - bits)) & 31];
    }
    // Lowercase para consistencia visual con npm tokens (`npm_...`).
    return output.toLowerCase();
  }
}
