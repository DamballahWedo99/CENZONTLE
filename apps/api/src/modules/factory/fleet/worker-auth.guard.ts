import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkerTokenService } from './worker-token.service';
import { IS_WORKER_ROUTE_KEY } from './worker-route.decorator';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Guard custom que valida el header `Authorization: Bearer worker_xxx` para
 * endpoints `/factory/workers/*`.
 *
 * Por qué un guard separado del `JwtAuthGuard`:
 *  - El JwtAuthGuard valida JWT de Auth0 (humanos con sesión).
 *  - Los workers NO tienen sesión humana — solo un token Bearer estático.
 *  - Por defecto NestJS ejecuta los guards globales primero, así que las
 *    rutas worker DEBEN marcarse con `@Public()` (skipea JwtAuthGuard) Y
 *    `@WorkerRoute()` (activa este guard).
 *
 * El guard:
 *  1. Extrae token del header
 *  2. Llama `tokens.resolve(plaintext)` (SHA-256 hash + DB lookup)
 *  3. Si válido, attach `req.workerNode = { id, tokenId }` para que los
 *     controllers lo lean via decorator `@WorkerNode()`.
 *  4. Llama fire-and-forget `tokens.touchLastUsed(tokenId)`.
 */
@Injectable()
export class WorkerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: WorkerTokenService,
    @InjectPinoLogger(WorkerAuthGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isWorkerRoute = this.reflector.getAllAndOverride<boolean>(IS_WORKER_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // SECURITY (CWE-862): si el guard está registrado vía `@UseGuards(WorkerAuthGuard)`
    // pero el handler/clase NO tiene `@WorkerRoute()`, fail-closed con 401.
    // Antes el guard retornaba `true` por compat con rutas mixtas — eso permitía
    // que un dev futuro añadiera un endpoint `@Public()` sin `@WorkerRoute()` y
    // quedara 100% no autenticado (security-reviewer #3 BLOCK 2026-05-06).
    if (!isWorkerRoute) {
      this.logger.error(
        '[worker-auth] FAIL @UseGuards(WorkerAuthGuard) sin @WorkerRoute() — refusing request as fail-closed default',
      );
      throw new UnauthorizedException('Worker route misconfigured');
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      workerNode?: { id: string; tokenId: string };
    }>();

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Missing worker token');
    }
    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization header');
    }
    if (!token.startsWith('worker_')) {
      throw new UnauthorizedException('Invalid worker token format');
    }

    const resolved = await this.tokens.resolve(token);
    if (!resolved) {
      // SECURITY: log solo `worker_` (8 chars del prefijo fijo) para no
      // capturar parte del secret cuando un atacante prueba `Bearer worker_REAL_SECRET_xxx`
      // (security-reviewer #2 MEDIUM 2026-05-06).
      this.logger.warn(`[worker-auth] FAIL token rejected (invalid/revoked/expired)`);
      throw new UnauthorizedException('Invalid or revoked worker token');
    }

    // Attach al request para que controllers lo accedan via @WorkerNode()
    request.workerNode = { id: resolved.nodeId, tokenId: resolved.id };

    // Fire-and-forget: actualiza lastUsedAt sin bloquear el request.
    void this.tokens.touchLastUsed(resolved.id);

    return true;
  }
}
