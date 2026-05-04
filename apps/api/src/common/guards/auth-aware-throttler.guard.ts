import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * ThrottlerGuard que prefiere `req.user.sub` (JWT subject) sobre `req.ip`
 * cuando el request está autenticado. Razones:
 *
 *  1. **Multi-usuario detrás de proxy**: con throttler IP-based, todos los
 *     usuarios detrás del mismo NAT/CDN comparten bucket — el ataque de
 *     uno DoS-ea a los demás.
 *  2. **Bypass via IP rotation**: un atacante con muchas IPs puede saltar
 *     el throttle, mientras que un user válido pegando F5 no.
 *  3. **Per-user es la unidad real de cap**: el cost que protegemos
 *     (Anthropic API + GitHub clones) se contabiliza por user, no por IP.
 *
 * Fallback a IP cuando el request no está autenticado (anonymous endpoints
 * como `/health` si no se aplica @SkipThrottle, login form, etc.).
 */
@Injectable()
export class AuthAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    // `user` lo pobla el JwtAuthGuard cuando el request pasa auth. Como
    // ThrottlerGuard ejecuta DESPUÉS de auth (orden APP_GUARD → handler
    // guards en NestJS), `req.user` debería estar disponible cuando aplica.
    const userSub = (req as Request & { user?: { sub?: string } }).user?.sub;
    if (userSub) return `u:${userSub}`;
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
