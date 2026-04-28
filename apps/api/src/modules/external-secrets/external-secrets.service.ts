import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ExternalSecret } from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../vault/crypto.service';
import { CreateExternalSecretDto } from './dto/create-external-secret.dto';

/**
 * Gestiona credenciales externas (API keys de Stripe/Twilio, merchant codes,
 * OAuth client_secrets, etc.) que el backend necesita para integrar con
 * proveedores de terceros. El valor se encripta at-rest con AES-256-GCM
 * vía `CryptoService` (reutiliza `VAULT_ENCRYPTION_KEY`).
 *
 * Contrato de seguridad:
 *  - `getByName()` es el ÚNICO método que devuelve plaintext. Inyectable
 *    en servicios runtime (ej: payment gateway). Nunca expuesto vía HTTP.
 *  - El controller CRUD siempre devuelve `maskedValue` — nunca plaintext.
 *  - Logs y error messages no incluyen el plaintext.
 *
 * Auto-resolución de dependencias: cuando `create` recibe un
 * `sourceDependencyId`, la dep que originó la creación se marca como
 * `resolved` con `linkedSecretId` apuntando al secret recién creado —
 * cierra el loop entre "el agente detecta una dep que requiere credencial"
 * y "el user provee la credencial".
 */
@Injectable()
export class ExternalSecretsService {
  private readonly logger = new Logger(ExternalSecretsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Crea un secret encriptado. Si `sourceDependencyId` viene, intenta
   * auto-resolver la dep en su epic contenedor (best-effort — fallos en
   * la resolución NO invalidan la creación del secret).
   */
  async create(
    dto: CreateExternalSecretDto,
    createdBy?: string,
  ): Promise<ExternalSecret> {
    const { ciphertext, iv, authTag } = this.crypto.encrypt(dto.value);

    // Chequeo de unicidad pre-insert para dar error 409 legible
    // (el unique constraint también protege, pero Prisma lanza P2002 genérico).
    const existing = await this.prisma.externalSecret.findUnique({
      where: { name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un secret con name "${dto.name}". Usa otro nombre o elimina el existente.`,
      );
    }

    const created = await this.prisma.externalSecret.create({
      data: {
        name: dto.name,
        vendor: dto.vendor ?? null,
        description: dto.description ?? null,
        tokenCiphertext: ciphertext,
        tokenIv: iv,
        tokenAuthTag: authTag,
        createdBy: createdBy ?? null,
      },
    });

    this.logger.log(
      `[create] external secret name=${created.name} vendor=${created.vendor ?? '∅'} id=${created.id}` +
        (dto.sourceDependencyId ? ` sourceDependencyId=${dto.sourceDependencyId}` : ''),
    );

    // Auto-resolver la dep si vino con sourceDependencyId. Best-effort:
    // un fallo no invalida el secret recién creado — la dep puede marcarse
    // manualmente después si el link falla (p.ej. dep ya fue eliminada).
    if (dto.sourceDependencyId) {
      await this.resolveSourceDependency(dto.sourceDependencyId, created.id, dto.name).catch(
        (err) => {
          this.logger.warn(
            `[create] auto-resolve dep ${dto.sourceDependencyId} failed: ${(err as Error)?.message ?? err}`,
          );
        },
      );
    }

    // BULK PROPAGATION: el modelo per-story permite que la misma credencial
    // viva en N rows distintas (una por historia que la requiere). Cuando el
    // user provee el secret una vez, propagamos el linkedSecretId a TODAS las
    // `StoryTechnicalDependency` que matcheen por vendor (case-insensitive)
    // + `requiresCredential=true` + sin link previo. Sin esto, el user vería
    // 1 historia con badge "Secret provisto" y 2 sin él aunque sean la misma.
    // Best-effort: un fallo aquí NO invalida el secret recién creado.
    if (dto.vendor) {
      await this.resolveAllStoryDependenciesByVendor(dto.vendor, created.id, dto.name).catch(
        (err) => {
          this.logger.warn(
            `[create] bulk-resolve story deps for vendor=${dto.vendor} failed: ${(err as Error)?.message ?? err}`,
          );
        },
      );
    }

    return this.toResponse(created, dto.value);
  }

  /** Lista todos los secrets enmascarados. */
  async list(): Promise<ExternalSecret[]> {
    const rows = await this.prisma.externalSecret.findMany({
      orderBy: [{ vendor: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.toResponseMasked(row));
  }

  async delete(id: string): Promise<void> {
    const found = await this.prisma.externalSecret.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Secret ${id} no encontrado`);

    // Desvincular las StoryTechnicalDependency que apuntaban a este secret
    // ANTES de borrarlo. `linkedSecretId` no es FK real (Prisma String, no
    // relación) — sin esto las deps quedarían con un linkedSecretId huérfano
    // y la UI mostraría "Secret provisto" para algo que ya no existe.
    // Tx para que la desvinculación + delete sean atómicos.
    const unlinkedCount = await this.prisma.$transaction(async (tx) => {
      const result = await tx.storyTechnicalDependency.updateMany({
        where: { linkedSecretId: id },
        data: { linkedSecretId: null, status: 'identified' },
      });
      await tx.externalSecret.delete({ where: { id } });
      return result.count;
    });

    this.logger.log(
      `[delete] external secret name=${found.name} id=${id} unlinkedStories=${unlinkedCount}`,
    );
  }

  /**
   * **Runtime consumption**: desencripta y devuelve el plaintext del secret
   * identificado por `name`. Único método que expone plaintext. Llamadores
   * en backend (ej: `payment-gateway.service.ts`) inyectan este service y
   * consumen el valor en memoria, sin persistirlo ni loggearlo.
   *
   * @throws NotFoundException si el secret no existe
   */
  async getByName(name: string): Promise<string> {
    const row = await this.prisma.externalSecret.findUnique({ where: { name } });
    if (!row) {
      throw new NotFoundException(`Secret "${name}" no encontrado`);
    }
    return this.crypto.decrypt({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      authTag: row.tokenAuthTag,
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Auto-resuelve la dep del epic que originó el secret.
   *
   * Dos casos cubiertos:
   *  - `DiscoveredDependency` que NO vive en PG (vault-only): no hay match
   *    de epic; loggeamos y continuamos sin error.
   *  - `EpicDependency` (JSONB en `epic.dependencies[]`): upsert in-place
   *    con `status='resolved'`, `linkedSecretId`, `resolutionNotes`.
   *
   * Invariante: NO sobreescribe un `linkedSecretId` previo. Si la dep ya
   * tenía un secret vinculado, el UPDATE no la toca — queda responsabilidad
   * del user desvincularla manualmente primero (evita perder referencias
   * silenciosamente al primer secret cuando alguien re-resuelve).
   *
   * Nota: la columna `epics.id` es `TEXT` (no `UUID` Postgres nativo) a
   * pesar de que Prisma la declara como `String @default(uuid())`. Por eso
   * los parámetros van SIN cast `::uuid` — si lo tuvieran, Postgres lanza
   * "invalid input syntax for type uuid" al primer request.
   */
  private async resolveSourceDependency(
    sourceDependencyId: string,
    secretId: string,
    secretName: string,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const note = `Secret \`${secretName}\` registrado el ${today}`;

    // Buscar el epic cuya dependencies[] JSONB contenga un item con ese id.
    // Usamos raw query porque Prisma no soporta JSONB path queries fluidas.
    const epics = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM epics
      WHERE dependencies @> ${JSON.stringify([{ id: sourceDependencyId }])}::jsonb
      LIMIT 1
    `;

    if (epics.length === 0) {
      // El dep vino de un DiscoveredDependency (vault-only) — el link se
      // reflejará en la próxima regeneración. No es error.
      this.logger.log(
        `[resolveSourceDependency] no epic owns dep ${sourceDependencyId} — likely vault-only DiscoveredDependency`,
      );
      return;
    }

    const epicId = epics[0].id;
    const now = new Date().toISOString();

    // Upsert atómico del item dentro del array JSONB con SQL puro. Evita
    // race conditions del read-modify-write si hubiera generaciones
    // concurrentes. La guarda `linkedSecretId IS NULL OR = ''` impide
    // sobreescribir un vínculo previo — si la dep ya tiene secret, el CASE
    // cae al ELSE y el elemento se preserva intacto.
    const affected = await this.prisma.$executeRaw`
      UPDATE epics
      SET dependencies = (
        SELECT jsonb_agg(
          CASE
            WHEN elem->>'id' = ${sourceDependencyId}
              AND (elem->>'linkedSecretId' IS NULL OR elem->>'linkedSecretId' = '')
            THEN elem
              || jsonb_build_object(
                'status', 'resolved',
                'linkedSecretId', ${secretId}::text,
                'resolutionNotes', ${note}::text,
                'updatedAt', ${now}::text
              )
            ELSE elem
          END
        )
        FROM jsonb_array_elements(dependencies) AS elem
      )
      WHERE id = ${epicId}
    `;

    this.logger.log(
      `[resolveSourceDependency] epic=${epicId} dep=${sourceDependencyId} linkedSecret=${secretId} rowsAffected=${affected}`,
    );
  }

  /**
   * Bulk-resolve: vincula el secret recién creado a TODAS las
   * `StoryTechnicalDependency` que matcheen por vendor (case-insensitive)
   * + `requiresCredential=true` + sin link previo. Esto refleja el modelo
   * per-story: la misma credencial puede vivir en N rows distintas (una por
   * historia que la requiere) y el user solo provee el secret UNA vez.
   *
   * Invariante: NO sobreescribe un `linkedSecretId` previo (la guarda
   * `linkedSecretId: null` en el WHERE). Si una dep ya estaba vinculada a
   * otro secret, queda intacta — el user debe desvincular manualmente
   * primero para evitar perder referencias silenciosamente.
   */
  private async resolveAllStoryDependenciesByVendor(
    vendor: string,
    secretId: string,
    secretName: string,
  ): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const note = `Secret \`${secretName}\` registrado el ${today}`;
    // `mode: 'insensitive'` requiere PostgreSQL — el repo usa pg, OK.
    // No incluimos `requiresCredential: true` en el filtro porque algunas
    // deps pueden tener vendor pero no requerir credencial (ej: APIs públicas).
    // El match por vendor + sin link previo cubre ambos casos sin falsos negativos.
    const result = await this.prisma.storyTechnicalDependency.updateMany({
      where: {
        vendor: { equals: vendor, mode: 'insensitive' },
        linkedSecretId: null,
      },
      data: {
        linkedSecretId: secretId,
        status: 'resolved',
        resolutionNotes: note,
      },
    });
    this.logger.log(
      `[resolveAllStoryDependenciesByVendor] vendor="${vendor}" secret=${secretId} updated=${result.count} stories`,
    );
    return result.count;
  }

  private toResponse(
    row: Prisma.ExternalSecretGetPayload<Record<string, never>>,
    plaintext?: string,
  ): ExternalSecret {
    // En create pasamos plaintext para generar mask una sola vez sin
    // desencriptar. En list usamos toResponseMasked que no tiene plaintext.
    return {
      id: row.id,
      name: row.name,
      vendor: row.vendor,
      description: row.description,
      maskedValue: plaintext ? CryptoService.mask(plaintext) : '••••••••',
      lastRotatedAt: row.lastRotatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Para el endpoint list: desencripta brevemente cada valor para calcular
   * el `maskedValue`. Se acepta el costo porque el endpoint tiene permisión
   * restrictiva y se usa en un settings screen, no en hot path runtime.
   * La alternativa (guardar la mask en DB) duplica estado y rompe al rotar.
   */
  private toResponseMasked(
    row: Prisma.ExternalSecretGetPayload<Record<string, never>>,
  ): ExternalSecret {
    let maskedValue = '••••••••';
    try {
      const plaintext = this.crypto.decrypt({
        ciphertext: row.tokenCiphertext,
        iv: row.tokenIv,
        authTag: row.tokenAuthTag,
      });
      maskedValue = CryptoService.mask(plaintext);
    } catch {
      // Si falla la decrypt (key rotada, datos corruptos), mostramos
      // placeholder genérico en vez de romper el list.
    }
    return {
      id: row.id,
      name: row.name,
      vendor: row.vendor,
      description: row.description,
      maskedValue,
      lastRotatedAt: row.lastRotatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
