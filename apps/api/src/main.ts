import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Logger as PinoNestLogger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { PrismaExceptionFilter } from "./common/filters/prisma-exception.filter";

async function bootstrap() {
  // `bufferLogs: true` retiene cualquier log emitido durante el bootstrap
  // hasta que `useLogger()` registre pino — sin esto, los primeros logs
  // ("Nest application starting...", módulos resolviendo, etc.) saldrían
  // por el logger default y los siguientes por pino — inconsistencia molesta
  // en tail -f.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Reemplaza el logger global (@nestjs/common Logger) por pino. Cualquier
  // `new Logger(SomeService.name)` legacy ahora sale como JSON estructurado
  // automáticamente, sin tocar los 50+ services existentes. Los services
  // nuevos pueden inyectar `PinoLogger` directamente para object destructuring
  // nativo (ver `agent-run.service.ts:logVaultLoaded`).
  app.useLogger(app.get(PinoNestLogger));

  // CRÍTICO para ThrottlerGuard: detrás de un reverse proxy (Auth0 BFF,
  // load balancer, CDN), `req.ip` por default es el IP del proxy, no del
  // cliente real. Sin trust proxy, un solo proxy IP "agrupa" a TODOS los
  // usuarios en el mismo bucket de throttle → 429 a usuarios legítimos
  // cuando el budget se consume. El throttler se vuelve un DoS amplifier
  // hacia los buenos en vez de defensa contra los malos.
  // `1` = confía solo en el primer hop (el proxy más cercano). Si hay
  // varios hops (CDN → proxy → app), ajustar a la cuenta correcta.
  app.set("trust proxy", 1);

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Shutdown hooks: sin esto, `onModuleDestroy` NO dispara en SIGINT/SIGTERM
  // (Ctrl-C), así que `PreviewModule.cleanupAll()` nunca corría al reiniciar la
  // API → los dev servers de preview (spawneados `detached`) quedaban huérfanos
  // reteniendo puertos y sirviendo 404 desde dirs borrados (bug 2026-05-28).
  // Con los hooks, Ctrl-C → onModuleDestroy → cleanupAll mata los grupos de
  // proceso. Bonus: PrismaService.$disconnect() también corre limpio.
  app.enableShutdownHooks();

  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Cenzontle API")
      .setDescription("API backend para el sistema de gestion CENZONTLE")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);

  // Bootstrap notice via pino (no console.log). Sale como JSON estructurado
  // con event key para queries de startup ("¿cuándo arrancó la última vez?").
  const bootstrapLogger = app.get(PinoNestLogger);
  bootstrapLogger.log(
    {
      event: 'app.bootstrap.ready',
      port,
      env: process.env.NODE_ENV ?? 'development',
      swaggerEnabled: process.env.NODE_ENV !== 'production',
    },
    `Cenzontle API ready on :${port}/api${process.env.NODE_ENV !== 'production' ? ` (docs: /api/docs)` : ''}`,
  );
}
bootstrap();
