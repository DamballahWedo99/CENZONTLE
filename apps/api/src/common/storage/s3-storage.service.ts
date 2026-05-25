import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Readable } from 'stream';

/**
 * Cliente S3 reusable para el backend. Compatible con AWS S3, MinIO,
 * Cloudflare R2 y cualquier API S3-compat — la única configuración
 * necesaria son las env vars `S3_*`.
 *
 * Uso típico (BrandingSettings, futuro DocumentsService):
 *   constructor(private readonly storage: S3StorageService) {}
 *   const key = `branding/logo-${uuid()}.png`;
 *   await this.storage.putObject(key, buffer, 'image/png');
 *
 * El bucket se configura via `S3_BUCKET` env var — un solo bucket compartido
 * por todos los módulos, separados por prefix (`branding/`, `documents/`,
 * etc.). Esto matchea el setup actual de docker-compose (`cenzontle-documents`)
 * y permite extender a multi-bucket más adelante sin cambiar la API.
 *
 * MinIO en dev: `forcePathStyle: true` (path-style URLs, e.g.
 * `http://localhost:9000/bucket/key`); AWS S3 usa subdomain-style por
 * defecto. La env var `S3_FORCE_PATH_STYLE` permite override explícito.
 *
 * Fail-fast en `onModuleInit`: si las env vars faltan en producción, el
 * boot del API falla con un mensaje claro — preferible a runtime errors
 * cuando un user sube un archivo.
 */

interface S3Config {
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

function readConfig(): S3Config | { missing: string[] } {
  const rawEndpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '';
  const bucket = process.env.S3_BUCKET ?? '';
  const isLocalhost = !!rawEndpoint && rawEndpoint.includes('localhost');

  // WORKAROUND CRÍTICO: Node 18+ con undici implementa Happy Eyeballs (RFC
  // 8305) — al resolver `localhost`, intenta IPv6 (`::1`) e IPv4
  // (`127.0.0.1`) en paralelo. Si MinIO escucha solo en IPv4 (default del
  // docker port mapping `9000:9000`), el connect a `::1` falla con
  // ECONNREFUSED y AWS SDK envuelve eso en un `AggregateError` con
  // `message: ""` (no propaga el sub-error). Resultado: log inútil
  // `AggregateError: <empty>` y el operador no sabe qué pasó.
  //
  // Fix: reescribir `localhost` → `127.0.0.1` ANTES de pasar al S3Client.
  // Forzamos IPv4-only y eliminamos el Happy Eyeballs racing. Esto NO
  // afecta producción (donde el endpoint es un FQDN AWS/R2/etc).
  const endpoint = rawEndpoint?.replace(/\/\/localhost(:|\/|$)/, '//127.0.0.1$1');
  const forcePathStyle =
    process.env.S3_FORCE_PATH_STYLE === 'true' || isLocalhost;

  const missing: string[] = [];
  if (!accessKeyId) missing.push('S3_ACCESS_KEY (o AWS_ACCESS_KEY_ID)');
  if (!secretAccessKey) missing.push('S3_SECRET_KEY (o AWS_SECRET_ACCESS_KEY)');
  if (!bucket) missing.push('S3_BUCKET');
  if (missing.length > 0) return { missing };

  return { endpoint, region, accessKeyId, secretAccessKey, bucket, forcePathStyle };
}

/**
 * Extrae info accionable de un error S3. Maneja específicamente
 * `AggregateError` (Node 18+ Happy Eyeballs) que viene con `message: ""`
 * — necesitamos descender en `error.errors[]` para obtener el sub-error real
 * (típicamente ECONNREFUSED, ENOTFOUND, etc.).
 */
function describeS3Error(err: unknown): {
  name: string;
  message: string;
  code: string | undefined;
  subErrors: Array<{ name: string; message: string; code?: string }> | undefined;
} {
  const e = err as Error & {
    name?: string;
    code?: string;
    errors?: Array<Error & { code?: string }>;
    $metadata?: { httpStatusCode?: number };
  };
  const isAggregate = e.name === 'AggregateError' || Array.isArray(e.errors);
  const subErrors = isAggregate && Array.isArray(e.errors)
    ? e.errors.map((sub) => ({
        name: sub.name ?? 'Unknown',
        message: sub.message ?? '(empty)',
        code: sub.code,
      }))
    : undefined;
  // Si el message principal está vacío Y hay sub-errors, sintetizamos uno
  // legible — sin esto los logs muestran literalmente "AggregateError: "
  // sin más info.
  let message = e.message ?? '';
  if (!message && subErrors && subErrors.length > 0) {
    message = subErrors.map((s) => `${s.code ?? s.name}: ${s.message}`).join(' | ');
  }
  return {
    name: e.name ?? 'Unknown',
    message: message || '(no message)',
    code: e.code,
    subErrors,
  };
}

/**
 * Convierte un sub-error técnico (ECONNREFUSED, ENOTFOUND) en hint
 * accionable para el operador. Solo devuelve algo si reconoce el código
 * — null si no hay hint mapeado (para no inventar).
 */
function hintFromS3Error(
  desc: ReturnType<typeof describeS3Error>,
  endpoint: string | undefined,
): string | null {
  const allCodes = [
    desc.code,
    ...(desc.subErrors?.map((s) => s.code) ?? []),
  ].filter(Boolean);
  if (allCodes.includes('ECONNREFUSED')) {
    return `Conexión rechazada por ${endpoint ?? 'el endpoint S3'}. ¿MinIO está corriendo? → docker compose up -d minio minio-init`;
  }
  if (allCodes.includes('ENOTFOUND') || allCodes.includes('EAI_AGAIN')) {
    return `No se pudo resolver el host del endpoint S3 (${endpoint ?? '?'}). Verifica S3_ENDPOINT y DNS.`;
  }
  if (allCodes.includes('ETIMEDOUT')) {
    return `Timeout conectando a ${endpoint ?? 'S3'}. Verifica firewall y que el puerto esté abierto.`;
  }
  if (desc.name === 'NoSuchBucket') {
    return `El bucket no existe. Créalo: docker compose up -d minio-init (en dev) o configura el bucket en AWS/R2.`;
  }
  if (desc.name === 'InvalidAccessKeyId' || desc.name === 'SignatureDoesNotMatch') {
    return `Credenciales S3 inválidas. Verifica S3_ACCESS_KEY y S3_SECRET_KEY.`;
  }
  return null;
}

@Injectable()
export class S3StorageService implements OnModuleInit {
  private client!: S3Client;
  private bucket!: string;
  private endpoint: string | undefined;

  constructor(
    @InjectPinoLogger(S3StorageService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const cfg = readConfig();
    if ('missing' in cfg) {
      // Fail-fast en producción; en dev solo loggear y dejar que las
      // operaciones tiren errores claros. Es preferible un boot exitoso
      // en dev (puedes correr la API sin MinIO si no estás tocando upload)
      // que bloquear el dev loop completo.
      const msg = `[S3StorageService] Missing env vars: ${cfg.missing.join(', ')}`;
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg + ' — REQUIRED in production.');
      }
      this.logger.warn(
        { event: 's3.config.missing', missing: cfg.missing },
        msg + ' — S3 operations will fail until configured.',
      );
      return;
    }

    this.bucket = cfg.bucket;
    this.endpoint = cfg.endpoint;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: cfg.forcePathStyle,
    });

    // Si el endpoint original era localhost y lo reescribimos a 127.0.0.1,
    // loggear el rewrite para que el operador entienda por qué los logs
    // mencionan 127.0.0.1 y no localhost.
    const rewroteLocalhost =
      process.env.S3_ENDPOINT?.includes('localhost') && cfg.endpoint?.includes('127.0.0.1');
    if (rewroteLocalhost) {
      this.logger.info(
        { event: 's3.endpoint.rewrote', from: process.env.S3_ENDPOINT, to: cfg.endpoint },
        `[S3StorageService] endpoint rewrite localhost → 127.0.0.1 (workaround Node Happy Eyeballs / undici AggregateError)`,
      );
    }

    this.logger.info(
      {
        event: 's3.client.ready',
        endpoint: cfg.endpoint ?? 'aws-default',
        bucket: cfg.bucket,
        region: cfg.region,
        forcePathStyle: cfg.forcePathStyle,
      },
      `[S3StorageService] ready — endpoint=${cfg.endpoint ?? 'aws-default'} bucket=${cfg.bucket} pathStyle=${cfg.forcePathStyle}`,
    );

    // Health check: HeadBucket valida conectividad + credenciales + bucket
    // existe — los 3 modos de fallo más comunes en un boot mal configurado.
    // No throw — un MinIO caído en dev no debe bloquear el resto de la API.
    // Solo emitimos WARN con hint accionable para que el operador lo arregle
    // ANTES del primer upload (en vez de descubrirlo cuando un user falla).
    await this.healthCheck();
  }

  private async healthCheck(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.info(
        {
          event: 's3.healthcheck.ok',
          bucket: this.bucket,
          endpoint: this.endpoint,
          latencyMs: Date.now() - startedAt,
        },
        `[S3StorageService] healthcheck OK — bucket ${this.bucket} reachable @ ${this.endpoint ?? 'aws-default'} (${Date.now() - startedAt}ms)`,
      );
    } catch (err) {
      const desc = describeS3Error(err);
      const hint = hintFromS3Error(desc, this.endpoint);
      this.logger.warn(
        {
          event: 's3.healthcheck.failed',
          bucket: this.bucket,
          endpoint: this.endpoint,
          latencyMs: Date.now() - startedAt,
          errorName: desc.name,
          errorMessage: desc.message,
          subErrors: desc.subErrors,
          hint,
        },
        `[S3StorageService] ⚠️  healthcheck FAILED — ${desc.name}: ${desc.message}` +
          (hint ? `\n[S3StorageService] 💡 ${hint}` : ''),
      );
    }
  }

  /**
   * Bucket name configurado vía env var. Lo expongo para módulos que
   * necesitan construir URLs presignadas o referencias explícitas, pero
   * la mayoría debería usar putObject/deleteObject/getObjectStream que
   * ya internamente usan este bucket.
   */
  getBucketName(): string {
    this.assertReady();
    return this.bucket;
  }

  /**
   * Sube un objeto al bucket. `key` es opaca para el caller — debe ser
   * server-generated (e.g. UUID) para evitar collisions y path traversal.
   * Si el key ya existe, se sobrescribe (S3 PutObject default behavior).
   *
   * Observabilidad: emite `s3.put.complete` con duración y bytes en éxito,
   * `s3.put.failed` con `errorName` (e.g. `NoSuchBucket`, `CredentialsError`,
   * `NetworkError`) en fallo. Permite distinguir misconfig de runtime issues.
   */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertReady();
    const startedAt = Date.now();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Sin ACL pública por default — el endpoint del controller hace
          // proxy through y maneja sus propios headers de seguridad. Esto
          // evita que un atacante encuentre la URL bruta del bucket y la
          // sirva sin nuestros CSP/nosniff.
        }),
      );
      // Success silencioso — el caller (BrandingSettingsService) emite el
      // log audit con latencia y bytes. Loggear acá duplicaría info.
    } catch (err) {
      const desc = describeS3Error(err);
      const hint = hintFromS3Error(desc, this.endpoint);
      this.logger.error(
        {
          event: 's3.put.failed',
          bucket: this.bucket,
          key,
          bytes: body.length,
          contentType,
          latencyMs: Date.now() - startedAt,
          errorName: desc.name,
          errorMessage: desc.message,
          subErrors: desc.subErrors,
          hint,
        },
        `[S3] PUT FAILED s3://${this.bucket}/${key} — ${desc.name}: ${desc.message}` +
          (hint ? ` 💡 ${hint}` : ''),
      );
      // Propagamos message + hint al cliente HTTP — el frontend muestra
      // este mensaje en el toast de error y el operador ve exactamente
      // qué pasó (en vez del antiguo "AggregateError: <empty>").
      throw new InternalServerErrorException(
        `S3 putObject falló: ${desc.name}: ${desc.message}` + (hint ? ` — ${hint}` : ''),
      );
    }
  }

  /**
   * Borra un objeto. Idempotente: si el objeto no existe, S3 devuelve
   * success igual (DeleteObject no falla en NoSuchKey). Best-effort —
   * no throw si falla porque el housekeeping no debe romper el flujo
   * principal.
   */
  async deleteObject(key: string): Promise<void> {
    this.assertReady();
    const startedAt = Date.now();
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      // Success silencioso — el caller (BrandingSettingsService) emite el
      // log audit. Loggear acá duplicaría info.
    } catch (err) {
      // Loggeamos pero NO throw — caller (BrandingSettingsService) ya hace
      // try/catch defensivo en housekeeping. WARN (no error) porque el
      // housekeeping fallido no rompe el flujo principal.
      const desc = describeS3Error(err);
      this.logger.warn(
        {
          event: 's3.delete.failed',
          bucket: this.bucket,
          key,
          latencyMs: Date.now() - startedAt,
          errorName: desc.name,
          errorMessage: desc.message,
          subErrors: desc.subErrors,
        },
        `[S3] DELETE FAILED key=${key} — ${desc.name}: ${desc.message} (best-effort, not throwing)`,
      );
    }
  }

  /**
   * Descarga un objeto como stream + metadata (Content-Type, ContentLength,
   * ETag). Caller hace `.pipe(res)` para servir el binario.
   *
   * Lanza NotFoundException si el objeto no existe — más útil que el error
   * crudo de AWS SDK que es difícil de distinguir de "credentials inválidas"
   * sin inspeccionar code.
   */
  async getObjectStream(
    key: string,
  ): Promise<{ stream: Readable; contentType: string | undefined; contentLength: number | undefined }> {
    this.assertReady();
    const startedAt = Date.now();
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const stream = res.Body as Readable | undefined;
      if (!stream) {
        this.logger.warn(
          { event: 's3.get.empty_body', bucket: this.bucket, key },
          `[S3] GET returned no body for key=${key}`,
        );
        throw new NotFoundException(`S3 object has no body: key=${key}`);
      }
      return {
        stream,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
      };
    } catch (err) {
      const errorName = (err as { name?: string }).name ?? 'Unknown';
      if (err instanceof NoSuchKey || errorName === 'NoSuchKey') {
        // 404 es esperado (asset borrado, key stale en BD) — el caller lo
        // maneja convirtiendo a HTTP 404 con fallback. No es anomalía.
        throw new NotFoundException(`S3 object not found: key=${key}`);
      }
      const desc = describeS3Error(err);
      const hint = hintFromS3Error(desc, this.endpoint);
      this.logger.error(
        {
          event: 's3.get.failed',
          bucket: this.bucket,
          key,
          latencyMs: Date.now() - startedAt,
          errorName: desc.name,
          errorMessage: desc.message,
          subErrors: desc.subErrors,
          hint,
        },
        `[S3] GET FAILED s3://${this.bucket}/${key} — ${desc.name}: ${desc.message}` +
          (hint ? ` 💡 ${hint}` : ''),
      );
      throw err;
    }
  }

  private assertReady(): void {
    if (!this.client || !this.bucket) {
      throw new InternalServerErrorException(
        'S3StorageService not configured — set S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY env vars.',
      );
    }
  }
}
