import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { IS_PUBLIC_KEY } from '../decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private issuer: string;
  private audience: string;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.issuer = this.configService.getOrThrow<string>('AUTH0_ISSUER_URL');
    this.audience = this.configService.getOrThrow<string>('AUTH0_AUDIENCE');
    const issuerUrl = this.issuer.endsWith('/')
      ? this.issuer
      : `${this.issuer}/`;
    this.jwks = createRemoteJWKSet(
      new URL(`${issuerUrl}.well-known/jwks.json`),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing access token');

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });

      const claims = payload as Record<string, unknown>;
      const ns = 'https://cenzontle.app';

      const roleClaim = claims[`${ns}/role`] as string | undefined;
      const validRoles = Object.values(UserRole) as string[];
      const role =
        roleClaim && validRoles.includes(roleClaim)
          ? (roleClaim as UserRole)
          : UserRole.Viewer;

      const user: AuthenticatedUser = {
        sub: payload.sub!,
        email: (claims[`${ns}/email`] as string) || '',
        name: (claims[`${ns}/name`] as string) || '',
        picture: claims[`${ns}/picture`] as string | undefined,
        role,
        podIds: (claims[`${ns}/pod_ids`] as string[]) || [],
      };

      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private extractToken(request: {
    headers: { authorization?: string };
  }): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
