import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  type BrandingAssetType,
  BRANDING_ASSET_CONSTRAINTS,
  type BrandingSettings as BrandingSettingsPublic,
  DEFAULT_BRANDING_SETTINGS,
} from '@cenzontle/shared';
import { randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../../common/storage/s3-storage.service';

const SINGLETON_ID = 'singleton';

/**
 * Cache TTL del row singleton. 15s — más corto que agent-token-settings
 * (30s) porque cuando un admin sube un logo nuevo quiere verlo en la
 * sidebar de inmediato. 15s mantiene el balance: refresh rápido sin
 * machacar PG con cada request del sidebar.
 */
const CACHE_TTL_MS = 15_000;

/**
 * Prefix dentro del bucket S3 — aísla los assets de branding del resto de
 * documentos del bucket compartido (`cenzontle-documents` en dev). El
 * nombre del bucket viene de `S3_BUCKET` y lo maneja el S3StorageService.
 */
const BRANDING_KEY_PREFIX = 'branding/';

/**
 * Extensiones permitidas por mimetype. Sin SVG por la decisión documentada
 * en `BRANDING_ASSET_CONSTRAINTS` (vector XSS). Si en el futuro se añade un
 * formato al allowlist, AÑADIR aquí también — fallthrough levanta error,
 * NO usa `originalname` como fallback (defense in depth contra spoofing).
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

/**
 * Mapping entre BrandingAssetType (público, usado en URLs) y los campos
 * Prisma. Centralizado aquí para que controller y service compartan la misma
 * proyección — sin esto, un typo en un campo no fallaría a compilación
 * pero corrompería el singleton.
 */
const ASSET_KEY_FIELDS: Record<
  BrandingAssetType,
  'logoStorageKey' | 'logoCollapsedStorageKey' | 'faviconStorageKey'
> = {
  logo: 'logoStorageKey',
  logoCollapsed: 'logoCollapsedStorageKey',
  favicon: 'faviconStorageKey',
};

/**
 * Path PUBLIC del proxy del frontend que sirve los binarios. Construido en
 * runtime (NO persistido en BD) — un refactor de la ruta del frontend NO
 * requiere migración de datos, y un refactor del bucket S3 (cambio de
 * nombre, migración a R2, etc.) tampoco.
 */
function publicUrlFor(assetType: BrandingAssetType, cacheBuster: string): string {
  return `/api/branding/asset/${assetType}?v=${cacheBuster}`;
}

@Injectable()
export class BrandingSettingsService {
  private cached: { value: BrandingSettingsPublic; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    @InjectPinoLogger(BrandingSettingsService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Lee la configuración pública (cached). Auto-inicializa el singleton si
   * no existe. Llamado tanto por el endpoint público GET (layout SSR) como
   * por la UI de settings.
   *
   * Observabilidad (solo error path en prod). El success path es de altísima
   * frecuencia (cada navigation a una página server hace 1 GET por SSR
   * `cache:'no-store'`); loggear cada hit/miss inflaría los logs sin valor
   * de audit. Operador puede activar `LOG_LEVEL=debug` temporalmente para
   * trackear cache hit rate o latency spikes hacia Postgres.
   */
  async get(): Promise<BrandingSettingsPublic> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const startedAt = Date.now();
    try {
      const row = await this.prisma.brandingSettings.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID },
        update: {},
      });
      const value = this.toPublic(row);
      this.cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      this.logger.debug(
        {
          event: 'branding.get',
          cacheHit: false,
          dbLatencyMs: Date.now() - startedAt,
        },
        `[branding] GET cache miss → DB upsert (${Date.now() - startedAt}ms)`,
      );
      return value;
    } catch (err) {
      const errorObj = err as Error & { code?: string };
      this.logger.error(
        {
          event: 'branding.get.failed',
          errorName: errorObj.name,
          errorCode: errorObj.code,
          errorMessage: errorObj.message,
          dbLatencyMs: Date.now() - startedAt,
          stack: errorObj.stack?.split('\n').slice(0, 5).join('\n'),
        },
        `[branding] GET FAILED — ${errorObj.name}: ${errorObj.message} (code=${errorObj.code ?? 'none'})`,
      );
      throw err;
    }
  }

  /**
   * Update parcial de campos NO-binarios (companyName). Para subir/borrar
   * assets binarios usar `uploadAsset` / `removeAsset`.
   */
  async update(
    patch: { companyName?: string },
    updatedBy: string | null,
  ): Promise<BrandingSettingsPublic> {
    const trimmed: { companyName?: string } = {};
    if (patch.companyName !== undefined) {
      const value = patch.companyName.trim();
      if (value.length === 0) {
        throw new BadRequestException('companyName no puede estar vacío');
      }
      trimmed.companyName = value;
    }

    const startedAt = Date.now();
    let row;
    try {
      row = await this.prisma.brandingSettings.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, ...trimmed },
        update: { ...trimmed, updatedBy: updatedBy ?? null },
      });
    } catch (err) {
      this.logger.error(
        {
          event: 'branding.update.failed',
          userId: updatedBy ?? 'anon',
          fields: Object.keys(trimmed),
          errorCode: (err as { code?: string }).code,
          errorMessage: (err as Error).message,
          dbLatencyMs: Date.now() - startedAt,
        },
        `[branding] PATCH FAILED by=${updatedBy ?? 'anon'} — ${(err as Error).message}`,
      );
      throw err;
    }
    this.invalidateCache();
    // Audit log único (mutación admin) — combina received + applied en una
    // sola línea. Incluye fields, latencia y valor aplicado para forensics.
    this.logger.info(
      {
        event: 'branding.update',
        userId: updatedBy ?? 'anon',
        fields: Object.keys(trimmed),
        dbLatencyMs: Date.now() - startedAt,
        appliedCompanyName: row.companyName,
      },
      `[branding] PATCH by=${updatedBy ?? 'anon'} fields=[${Object.keys(trimmed).join(',')}] (${Date.now() - startedAt}ms) company="${row.companyName}"`,
    );
    return this.toPublic(row);
  }

  /**
   * Sube un asset binario al bucket S3 y actualiza el singleton con la
   * storage key resultante. Borra el objeto previo del bucket si existía.
   *
   * SECURITY:
   *  - Mimetype contra allowlist (SVG excluido — vector XSS)
   *  - Magic bytes contra mimetype declarado (defensa contra spoofing)
   *  - Empty/too-small file rejected
   *  - Extension SOLO desde mimetype validado (no del originalname)
   *  - S3 key generada server-side con randomUUID — path traversal imposible
   *
   * CONCURRENCY: leer el storage key anterior + escribir el nuevo se
   * serializan en una transacción `Serializable`. El objeto viejo se
   * borra DESPUÉS de commitear — si el commit falla, el objeto nuevo
   * subido al bucket se limpia para no dejar huérfano.
   */
  async uploadAsset(
    assetType: BrandingAssetType,
    file: Express.Multer.File,
    updatedBy: string | null,
  ): Promise<BrandingSettingsPublic> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.size === 0 || file.size < BRANDING_ASSET_CONSTRAINTS.minFileSizeBytes) {
      throw new BadRequestException('El archivo está vacío o es demasiado pequeño');
    }
    if (file.size > BRANDING_ASSET_CONSTRAINTS.maxFileSizeBytes) {
      throw new BadRequestException(
        `Archivo excede el tamaño máximo de ${BRANDING_ASSET_CONSTRAINTS.maxFileSizeBytes / 1024 / 1024}MB`,
      );
    }
    const accepted = BRANDING_ASSET_CONSTRAINTS.acceptedMimeTypes as readonly string[];
    if (!accepted.includes(file.mimetype)) {
      throw new BadRequestException(
        `Mimetype no aceptado: ${file.mimetype}. Acepta: ${accepted.join(', ')}`,
      );
    }
    if (!validateMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        'Los bytes del archivo no coinciden con el mimetype declarado',
      );
    }
    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      // Defense in depth: si alguien añade un mimetype al allowlist y olvida
      // MIME_TO_EXT, rechazamos en lugar de derivar del filename del cliente.
      throw new BadRequestException(`No hay extensión definida para mimetype: ${file.mimetype}`);
    }

    const keyField = ASSET_KEY_FIELDS[assetType];
    const storageKey = `${BRANDING_KEY_PREFIX}${assetType}-${randomUUID()}${ext}`;
    const uploadStartedAt = Date.now();
    const s3StartedAt = Date.now();
    try {
      await this.storage.putObject(storageKey, file.buffer, file.mimetype);
    } catch (err) {
      this.logger.error(
        {
          event: 'branding.upload.s3_failed',
          assetType,
          userId: updatedBy ?? 'anon',
          storageKey,
          bucket: this.storage.getBucketName(),
          s3LatencyMs: Date.now() - s3StartedAt,
          errorMessage: (err as Error).message,
        },
        `[branding] UPLOAD S3 FAILED type=${assetType} key=${storageKey} — ${(err as Error).message}`,
      );
      throw err;
    }
    const s3LatencyMs = Date.now() - s3StartedAt;

    let previousKey: string | null;
    const dbStartedAt = Date.now();
    try {
      previousKey = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.brandingSettings.findUnique({
            where: { id: SINGLETON_ID },
            select: { [keyField]: true },
          });
          const old = (existing as { [k: string]: string | null } | null)?.[keyField] ?? null;

          await tx.brandingSettings.upsert({
            where: { id: SINGLETON_ID },
            create: {
              id: SINGLETON_ID,
              [keyField]: storageKey,
              updatedBy,
            },
            update: {
              [keyField]: storageKey,
              updatedBy,
            },
          });
          return old;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // Si la transacción falla, el objeto nuevo subido a S3 queda
      // huérfano — lo limpiamos para no acumular basura en el bucket.
      await this.storage.deleteObject(storageKey);
      const code = (err as { code?: string })?.code;
      this.logger.error(
        {
          event: 'branding.upload.db_failed',
          assetType,
          userId: updatedBy ?? 'anon',
          storageKey,
          orphanCleanupAttempted: true,
          dbLatencyMs: Date.now() - dbStartedAt,
          errorCode: code,
          errorMessage: (err as Error).message,
        },
        `[branding] UPLOAD DB FAILED type=${assetType} key=${storageKey} code=${code ?? 'none'} — orphan cleanup attempted`,
      );
      if (code === 'P2034') {
        throw new BadRequestException(
          'Conflicto de concurrencia al guardar — otro admin actualizó el branding al mismo tiempo. Reintenta.',
        );
      }
      throw err;
    }
    const dbLatencyMs = Date.now() - dbStartedAt;

    // Cleanup del objeto anterior — solo tras commit exitoso. deleteObject
    // es best-effort: errores se loggean dentro del S3StorageService pero
    // no fallan el request (el row ya apunta al objeto correcto).
    if (previousKey && previousKey !== storageKey) {
      await this.storage.deleteObject(previousKey);
    }

    this.invalidateCache();
    const totalLatencyMs = Date.now() - uploadStartedAt;
    // Audit log único (mutación admin con asset binario). Latencias en
    // breakdown (s3/db/total) son útiles para diagnosticar regresiones de
    // performance — un upload >5s usualmente indica S3 con presión.
    this.logger.info(
      {
        event: 'branding.upload',
        assetType,
        userId: updatedBy ?? 'anon',
        size: file.size,
        mimetype: file.mimetype,
        bucket: this.storage.getBucketName(),
        storageKey,
        previousCleaned: !!previousKey && previousKey !== storageKey,
        s3LatencyMs,
        dbLatencyMs,
        totalLatencyMs,
      },
      `[branding] UPLOAD type=${assetType} by=${updatedBy ?? 'anon'} size=${file.size}B total=${totalLatencyMs}ms (s3=${s3LatencyMs}ms db=${dbLatencyMs}ms) ${previousKey ? 'replaced previous' : 'first upload'}`,
    );
    return this.get();
  }

  /**
   * Borra un asset (vuelve al fallback estático del frontend). Idempotente:
   * si ya no hay asset configurado, no hace nada (no escribe en DB, no
   * intenta deleteObject).
   *
   * CONCURRENCY: la lectura del key actual + el nulling del campo se hacen
   * dentro de una transacción `Serializable`. Sin esto, un DELETE
   * concurrente con un UPLOAD podría perder la subida nueva (TOCTOU): el
   * DELETE leería el key viejo fuera de transacción, después el UPLOAD
   * commitearía el key nuevo, y el DELETE sobreescribiría con null —
   * lost update del UPLOAD + objeto huérfano en bucket.
   */
  async removeAsset(
    assetType: BrandingAssetType,
    updatedBy: string | null,
  ): Promise<BrandingSettingsPublic> {
    const keyField = ASSET_KEY_FIELDS[assetType];

    let keyToDelete: string | null;
    try {
      keyToDelete = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.brandingSettings.findUnique({
            where: { id: SINGLETON_ID },
            select: { [keyField]: true },
          });
          const currentKey = (existing as { [k: string]: string | null } | null)?.[keyField] ?? null;

          if (currentKey === null) {
            // Idempotencia dentro de transacción — nada que tocar, abortamos
            // el path de escritura y devolvemos null para skip del delete.
            return null;
          }

          await tx.brandingSettings.upsert({
            where: { id: SINGLETON_ID },
            create: { id: SINGLETON_ID },
            update: {
              [keyField]: null,
              updatedBy,
            },
          });
          return currentKey;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2034') {
        throw new BadRequestException(
          'Conflicto de concurrencia al borrar — otro admin actualizó el branding al mismo tiempo. Reintenta.',
        );
      }
      throw err;
    }

    if (keyToDelete === null) {
      // Estado ya estaba limpio — no-op intencional, no loggeamos (no es ni
      // mutación ni anomalía). Operador puede ver el DELETE entrante en el
      // log HTTP de pino (200, ms) si necesita correlacionar.
      return this.get();
    }

    const s3StartedAt = Date.now();
    await this.storage.deleteObject(keyToDelete);

    this.invalidateCache();
    // Audit log único (mutación admin que efectivamente borró un asset).
    this.logger.info(
      {
        event: 'branding.delete_asset',
        assetType,
        userId: updatedBy ?? 'anon',
        bucket: this.storage.getBucketName(),
        storageKey: keyToDelete,
        s3LatencyMs: Date.now() - s3StartedAt,
      },
      `[branding] DELETE type=${assetType} by=${updatedBy ?? 'anon'} (s3=${Date.now() - s3StartedAt}ms)`,
    );
    return this.get();
  }

  /**
   * Devuelve un stream legible del objeto S3 + su mimetype para que el
   * controller lo pipe al response. Null ⇒ asset no configurado (frontend
   * debe usar fallback).
   *
   * Observabilidad: el success path es silencioso (este endpoint sirve cada
   * favicon load — sería N×100 logs/min). Solo loggeamos la ANOMALÍA: la BD
   * apunta a un key que ya no existe en el bucket (inconsistencia por
   * borrado out-of-band). En ese caso devolvemos null y el frontend cae al
   * fallback — UX no se rompe, pero el operador querrá investigar.
   */
  async getAssetObject(
    assetType: BrandingAssetType,
  ): Promise<{ stream: Readable; mimetype: string } | null> {
    const keyField = ASSET_KEY_FIELDS[assetType];
    const key = await this.readStorageKey(keyField);
    if (!key) return null;
    const startedAt = Date.now();
    try {
      const { stream, contentType } = await this.storage.getObjectStream(key);
      const mimetype = contentType ?? this.extToMime(extractExt(key));
      return { stream, mimetype };
    } catch (err) {
      this.logger.warn(
        {
          event: 'branding.asset_missing_in_bucket',
          assetType,
          storageKey: key,
          bucket: this.storage.getBucketName(),
          s3LatencyMs: Date.now() - startedAt,
          errorName: (err as Error).name,
          errorMessage: (err as Error).message,
        },
        `[branding] ASSET MISSING in S3 (DB→Bucket inconsistency): key=${key} type=${assetType} — falling back to static`,
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────

  /**
   * Lee el storage key (path interno en bucket) de un asset directo de DB.
   * Devuelve null si el row no existe o si el campo es null.
   *
   * No usa el cache porque los storage keys no están en el shape público y
   * cambian con cada upload — sirve la verdad de DB cada vez.
   */
  private async readStorageKey(
    field: 'logoStorageKey' | 'logoCollapsedStorageKey' | 'faviconStorageKey',
  ): Promise<string | null> {
    const row = await this.prisma.brandingSettings.findUnique({
      where: { id: SINGLETON_ID },
      select: { [field]: true },
    });
    if (!row) return null;
    const value = (row as { [K in typeof field]?: string | null })[field];
    return value ?? null;
  }

  private invalidateCache(): void {
    this.cached = null;
  }

  private extToMime(ext: string): string {
    const reverse: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
    };
    return reverse[ext.toLowerCase()] ?? 'application/octet-stream';
  }

  /**
   * Convierte el row Prisma al shape público que ve el cliente. Las URLs
   * (logoUrl, logoCollapsedUrl, faviconUrl) se CONSTRUYEN aquí desde el
   * storageKey + updatedAt (cache buster) — la BD nunca persiste el URL
   * literal. Esto evita acoplamiento de la capa de datos al routing del
   * frontend Y al backend de storage (un cambio de bucket S3 no migra datos).
   */
  private toPublic(row: {
    companyName: string;
    logoStorageKey: string | null;
    logoCollapsedStorageKey: string | null;
    faviconStorageKey: string | null;
    updatedAt: Date;
    updatedBy: string | null;
  }): BrandingSettingsPublic {
    // Cache buster derivado del updatedAt — estable mientras no haya cambios
    // (browser puede cachear el asset eficientemente) y cambia exactamente
    // cuando el admin sube uno nuevo (browser invalida sin reload manual).
    const buster = row.updatedAt.getTime().toString();
    return {
      companyName: row.companyName || DEFAULT_BRANDING_SETTINGS.companyName,
      logoUrl: row.logoStorageKey ? publicUrlFor('logo', buster) : null,
      logoCollapsedUrl: row.logoCollapsedStorageKey
        ? publicUrlFor('logoCollapsed', buster)
        : null,
      faviconUrl: row.faviconStorageKey ? publicUrlFor('favicon', buster) : null,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  }
}

/**
 * Extrae la extensión (con punto) de una S3 key — defensiva para el caso
 * donde la key no la tenga (no debería pasar porque la generamos server-side
 * con extensión válida, pero defense in depth).
 */
function extractExt(key: string): string {
  const idx = key.lastIndexOf('.');
  return idx >= 0 ? key.slice(idx) : '';
}

/**
 * Valida que los primeros bytes del buffer coincidan con la signature
 * conocida del mimetype declarado. Defensa contra MIME spoofing.
 *
 * Para WebP necesitamos chequear "RIFF" en bytes 0-3 Y "WEBP" en bytes 8-11
 * porque el formato RIFF es genérico (también lo usan WAV, AVI). Sin la
 * doble validación, un .wav con `Content-Type: image/webp` pasaría.
 */
function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  const candidates = BRANDING_ASSET_CONSTRAINTS.magicBytes[mimetype];
  if (!candidates) return false;
  const matchesSomeHeader = candidates.some((expected) => {
    if (buffer.length < expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (buffer[i] !== expected[i]) return false;
    }
    return true;
  });
  if (!matchesSomeHeader) return false;
  if (mimetype === 'image/webp') {
    if (buffer.length < 12) return false;
    if (
      buffer[8] !== 0x57 ||
      buffer[9] !== 0x45 ||
      buffer[10] !== 0x42 ||
      buffer[11] !== 0x50
    ) {
      return false;
    }
  }
  return true;
}
