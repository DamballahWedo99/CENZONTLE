import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { AuthAwareThrottlerGuard } from "./common/guards/auth-aware-throttler.guard";
import { ResilientThrottlerStorage } from "./common/throttler/resilient-throttler.storage";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { S3StorageModule } from "./common/storage/s3-storage.module";
import { RedisService } from "./modules/redis/redis.service";
import { ProyectosModule } from "./modules/proyectos/proyectos.module";
import { FactoryModule } from "./modules/factory/factory.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { VaultModule } from "./modules/vault/vault.module";
import { CodeRepositoriesModule } from "./modules/code-repositories/code-repositories.module";
import { DiagramThemeSettingsModule } from "./modules/diagram-theme-settings/diagram-theme-settings.module";
import { AgentTokenSettingsModule } from "./modules/agent-token-settings/agent-token-settings.module";
import { BrandingSettingsModule } from "./modules/branding-settings/branding-settings.module";
import { ExternalSecretsModule } from "./modules/external-secrets/external-secrets.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { AgentRunRegistryModule } from "./common/services/agent-run-registry.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Logging global con nestjs-pino. Reemplaza el NestJS Logger default por
    // pino, que emite JSON estructurado nativo (parseable directo en Loki/
    // Grafana sin `| logfmt`). Es ~5x más rápido que Winston/console.log y
    // soporta object destructuring nativo:
    //   logger.info({ event, runId, context }, 'mensaje legible')
    //     → {"level":30, "time":..., "event":"...", "runId":"...", "msg":"..."}
    //
    // Diseño de la config:
    //  - dev (NODE_ENV !== 'production'): pino-pretty para tail -f legible.
    //  - prod: JSON puro a stdout. La plataforma (k8s, fly.io, render, etc.)
    //    captura stdout y lo manda al log aggregator.
    //  - level: 'debug' en dev (queremos ver todo), 'info' en prod (señal).
    //  - genReqId: cada request HTTP recibe un req-id que se propaga via
    //    AsyncLocalStorage a TODOS los logs emitidos durante el request.
    //    Permite trace cross-service ("dame todos los logs del request X").
    //  - redact: defensa en profundidad contra leak de secrets. Cualquier
    //    `req.headers.authorization`, cookies, o tokens en query params NO
    //    aparecen en stdout. Si un developer descuidado loggea `req` entero,
    //    pino redacta antes de emitir — no hay forma de bypassear esto sin
    //    cambiar el config.
    //  - serializers: shortcut para que `req`/`res` se rendericen como
    //    objetos compactos en lugar del dump entero del Express object
    //    (que incluye internals que no aportan).
    //  - customLogLevel: 4xx → warn, 5xx → error. Auto-clasifica responses
    //    para que dashboards de error rate trabajen sin custom rules.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req,res,responseTime',
                  messageFormat: '{context} {msg}',
                },
              }
            : undefined,
        genReqId: (req, res) => {
          const existing = (req.headers['x-request-id'] as string | undefined)
            ?? (req.headers['x-correlation-id'] as string | undefined);
          const id = existing ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.headers["x-worker-token"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.token',
            '*.apiKey',
            '*.anthropicApiKey',
            '*.cloneUrl', // contiene el GitHub token embebido
          ],
          censor: '[REDACTED]',
        },
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            // No incluimos headers/body/query — vienen redacted arriba y
            // típicamente son ruido en logs de aplicación.
          }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        customSuccessMessage: (req, res) => {
          return `${req.method} ${req.url} ${res.statusCode}`;
        },
        customErrorMessage: (req, res, err) => {
          return `${req.method} ${req.url} ${res.statusCode} — ${err.message}`;
        },
        // Auto-exclude health checks del log spam. Mantiene observabilidad
        // de problemas reales sin inundar de "GET /health 200" cada 10s.
        autoLogging: {
          ignore: (req) =>
            req.url === '/health' ||
            req.url === '/healthz' ||
            req.url === '/metrics',
        },
      },
    }),
    // Rate limiting global. El default protege CADA endpoint contra fan-out
    // de un mismo user/IP. Endpoints específicos sobre-escriben con un cap más
    // estricto vía @Throttle() (login, retry de stories, etc.).
    //
    // Storage: Redis (no el default in-memory). Con almacenamiento en memoria
    // cada réplica de la API lleva su propio contador → los caps se degradan a
    // "límite × N réplicas" bajo escalado horizontal. El storage en Redis
    // comparte los contadores entre réplicas, así el cap es global de verdad.
    // `ResilientThrottlerStorage` lo envuelve con fail-open: si Redis cae, el
    // throttle se desactiva (request permitido) en vez de tumbar la API —
    // mismo principio best-effort que RedisService.
    ThrottlerModule.forRootAsync({
      // RedisModule es @Global() (RedisService ya resolvería sin esto), pero lo
      // declaramos explícito: hace la dependencia visible y robusta si algún
      // día se le saca el @Global().
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }], // 60 req/min
        storage: new ResilientThrottlerStorage(
          new ThrottlerStorageRedisService(redis.rawClient),
          () => redis.isConnected,
        ),
      }),
    }),
    PrismaModule,
    RedisModule,
    S3StorageModule,
    VaultModule,
    CodeRepositoriesModule,
    AgentRunRegistryModule,
    ProyectosModule,
    FactoryModule,
    AuthModule,
    DocumentsModule,
    DiagramThemeSettingsModule,
    AgentTokenSettingsModule,
    BrandingSettingsModule,
    ExternalSecretsModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // AuthAwareThrottlerGuard prefiere `req.user.sub` sobre `req.ip` para
    // el bucket de throttle. Esto evita que múltiples users detrás del mismo
    // proxy/NAT compartan budget (un atacante DoS-eando al resto), y
    // previene bypass via IP rotation. Fallback a IP para endpoints
    // anónimos. Aplica a todas las rutas: las request pasan por
    // throttle → auth → permissions → handler.
    {
      provide: APP_GUARD,
      useClass: AuthAwareThrottlerGuard,
    },
  ],
})
export class AppModule {}
