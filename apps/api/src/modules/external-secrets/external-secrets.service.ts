import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ExternalSecret, ExternalSecretForWorker } from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../vault/crypto.service';
import { CreateExternalSecretDto } from './dto/create-external-secret.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Normaliza un título de credencial para matcheo. PARITARIO con
 * `normalizeTitle` de `dedupe-rollup.ts` y `dedup-cross-stories.ts` —
 * cualquier divergencia produce el bug donde una dep se considera distinta
 * en un módulo y duplicada en otro. Strippea prefijos comunes ("GitHub
 * Secret: VERCEL_TOKEN" → "VERCEL_TOKEN") y normaliza case/whitespace.
 *
 * Riesgo residual conocido (security-reviewer MEDIUM 2026-05-04): titles
 * GENÉRICOS pueden colisionar tras el strip + lowercase. Ejemplo:
 *   - "Secret: TOKEN"        → "token"
 *   - "TOKEN"                → "token"
 *   - "GitHub Secret: TOKEN" → "token"
 * Si dos deps del MISMO vendor usan títulos genéricos que normalizan al
 * mismo string pero referencian secrets distintos, el bulk-resolve las
 * uniría. Mitigación práctica: el LLM (en story-generation.service.ts)
 * está prompted para emitir nombres canónicos UPPER_SNAKE_CASE específicos
 * del vendor (ej. AMADEUS_CLIENT_ID, no genérico "TOKEN") — los títulos
 * típicos NO colisionan. Si ves colisiones reales en producción, agregar
 * el `secretName` denormalizado al schema de la dep en generation time.
 */
function normalizeTitle(title: string): string {
  return title
    .replace(
      /^(github\s+secret|secret|credencial|credential|token|api\s+key)\s*:\s*(?=[A-Z_])/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Gestiona credenciales externas (API keys de Stripe/Twilio, merchant codes,
 * OAuth client_secrets, etc.) que el backend necesita para integrar con
 * proveedores de terceros. El valor se encripta at-rest con AES-256-GCM
 * vía `CryptoService` (reutiliza `VAULT_ENCRYPTION_KEY`).
 *
 * Contrato de seguridad:
 *  - `getByName()` y `getAllPlaintext()` son los ÚNICOS métodos que
 *    devuelven plaintext, ambos solo para inyección runtime: `getByName`
 *    para servicios backend (ej: payment gateway); `getAllPlaintext` para
 *    forwardear los secrets al worker del Forge en cada claim. Ninguno se
 *    expone vía HTTP.
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @InjectPinoLogger(ExternalSecretsService.name) private readonly logger: PinoLogger,
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

    this.logger.info(
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

    this.logger.info(
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

  /**
   * **Runtime consumption (worker del Forge)**: desencripta TODOS los
   * secrets registrados en la org y los devuelve como `ExternalSecretForWorker[]`.
   * Lo consume `AgentRunService.materializeClaim` para forwardear los
   * secrets en cada claim — el agente coder y el DoD verifier los inyectan
   * como env vars + `.env` efímero en el workdir.
   *
   * Defensivo: si un secret falla la desencriptación (key rotada, dato
   * corrupto), se OMITE con `logger.error` en vez de propagar la excepción.
   * Un secret corrupto no debe romper el claim entero ni privar al worker
   * del resto de los secrets — mismo patrón defensivo que `toResponseMasked`.
   *
   * Nunca expuesto vía HTTP: igual que `getByName`, solo inyección runtime.
   */
  async getAllPlaintext(): Promise<ExternalSecretForWorker[]> {
    const rows = await this.prisma.externalSecret.findMany({
      orderBy: [{ vendor: 'asc' }, { name: 'asc' }],
    });
    const result: ExternalSecretForWorker[] = [];
    for (const row of rows) {
      try {
        const value = this.crypto.decrypt({
          ciphertext: row.tokenCiphertext,
          iv: row.tokenIv,
          authTag: row.tokenAuthTag,
        });
        result.push({ name: row.name, value, vendor: row.vendor });
      } catch (err) {
        this.logger.error(
          `[getAllPlaintext] decrypt falló para secret name=${row.name} id=${row.id} — ` +
            `omitido del claim: ${(err as Error)?.message ?? err}`,
        );
      }
    }
    return result;
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
      this.logger.info(
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

    this.logger.info(
      `[resolveSourceDependency] epic=${epicId} dep=${sourceDependencyId} linkedSecret=${secretId} rowsAffected=${affected}`,
    );
  }

  /**
   * Bulk-resolve: vincula el secret recién creado a TODAS las
   * `StoryTechnicalDependency` que matcheen por `(vendor, normalizedTitle)`
   * + sin link previo. Esto refleja el modelo per-story: la misma credencial
   * (ej. AMADEUS_CLIENT_ID) puede vivir en N rows distintas (una por historia
   * que la requiere) y el user solo provee el secret UNA vez.
   *
   * BUG FIX (2026-05-04): antes el filtro era SOLO por vendor, así que crear
   * un secret de `AMADEUS_CLIENT_ID` también marcaba como resueltas las deps
   * de `AMADEUS_CLIENT_SECRET` y `AMADEUS_HOSTNAME` por compartir vendor.
   * Ahora el match exige que el `normalizeTitle(dep.title)` coincida con
   * `normalizeTitle(secret.name)` — una dep solo se vincula al secret que
   * realmente la satisface, no a otros del mismo vendor.
   *
   * Invariante: NO sobreescribe un `linkedSecretId` previo (la guarda
   * `linkedSecretId: null` en el WHERE). Si una dep ya estaba vinculada a
   * otro secret, queda intacta — el user debe desvincular manualmente
   * primero para evitar perder referencias silenciosamente.
   *
   * Implementación 2-step (en lugar de updateMany single-shot): Prisma no
   * soporta funciones custom dentro del WHERE para normalizar JS regex,
   * así que primero buscamos candidates por vendor + sin link, filtramos
   * en JS por título normalizado, y luego hacemos un updateMany por IDs.
   * Tradeoff: 2 queries en vez de 1, pero el N de candidates es chico
   * (deps de un vendor en un epic, decenas como mucho).
   */
  private async resolveAllStoryDependenciesByVendor(
    vendor: string,
    secretId: string,
    secretName: string,
  ): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const note = `Secret \`${secretName}\` registrado el ${today}`;
    const normalizedSecretName = normalizeTitle(secretName);

    // Paso 1: candidates por vendor + sin link previo. Traemos solo los
    // campos que necesitamos para el match (id + title) para no hidratar
    // toda la fila.
    const candidates = await this.prisma.storyTechnicalDependency.findMany({
      where: {
        vendor: { equals: vendor, mode: 'insensitive' },
        linkedSecretId: null,
      },
      select: { id: true, title: true },
    });

    // Paso 2: filtrar por título normalizado. Solo las deps cuyo title
    // matchea el name del secret se vinculan.
    const matchingIds = candidates
      .filter((d) => normalizeTitle(d.title) === normalizedSecretName)
      .map((d) => d.id);

    if (matchingIds.length === 0) {
      this.logger.info(
        `[resolveAllStoryDependenciesByVendor] vendor="${vendor}" secret=${secretId} (name="${secretName}") candidates=${candidates.length} matched=0 — no deps share normalizedTitle`,
      );
      return 0;
    }

    // TOCTOU guard (security-reviewer LOW#2): re-asertar `linkedSecretId: null`
    // en el WHERE del updateMany. Entre el findMany de candidates (arriba) y
    // este updateMany puede haber transcurrido tiempo en el que otra request
    // concurrent vinculó algunas de esas deps a OTRO secret. Sin la guarda
    // aquí, el `id IN (...)` sobreescribiría esos vínculos previos —
    // violando el invariante documentado "NO sobreescribe un linkedSecretId
    // previo". `result.count` puede ser < `matchingIds.length` si esto pasa,
    // y el delta es la cantidad de deps que la request concurrent vinculó
    // primero (correcto: gana el primero en escribir, pierde el segundo).
    const result = await this.prisma.storyTechnicalDependency.updateMany({
      where: { id: { in: matchingIds }, linkedSecretId: null },
      data: {
        linkedSecretId: secretId,
        status: 'resolved',
        resolutionNotes: note,
      },
    });
    if (result.count < matchingIds.length) {
      this.logger.warn(
        `[resolveAllStoryDependenciesByVendor] race detected: candidates=${candidates.length} matched=${matchingIds.length} updated=${result.count} — ${matchingIds.length - result.count} deps fueron vinculadas por una request concurrent. Comportamiento correcto.`,
      );
    } else {
      this.logger.info(
        `[resolveAllStoryDependenciesByVendor] vendor="${vendor}" secret=${secretId} (name="${secretName}") candidates=${candidates.length} matched=${matchingIds.length} updated=${result.count}`,
      );
    }
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
