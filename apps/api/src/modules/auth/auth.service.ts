import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthenticatedUser,
  ROLE_PERMISSIONS,
  TeamMember,
} from '@cenzontle/shared';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly configService: ConfigService) {}

  getProfile(user: AuthenticatedUser): TeamMember {
    return {
      id: user.sub,
      name: user.name,
      email: user.email,
      avatarUrl: user.picture || '',
      role: user.role,
      status: 'active',
      podIds: user.podIds,
      invitedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
  }

  getPermissions(user: AuthenticatedUser) {
    return ROLE_PERMISSIONS[user.role] || [];
  }

  /**
   * Verifica la contraseña actual del usuario autenticado contra Auth0
   * usando el grant "Resource Owner Password Credentials" (ROPC). Esta
   * verificación es necesaria para acciones que requieren step-up
   * authentication — p. ej. dar el Visto Bueno a una épica antes de
   * enviarla al Forge.
   *
   * Retorna `true` si la contraseña es correcta, `false` si Auth0 la
   * rechaza con `invalid_grant`. Cualquier otro error (red, configuración
   * de tenant) se propaga como ServiceUnavailableException — distinguir
   * "credenciales malas" de "endpoint caído" es importante para auditoría
   * y para no bloquear al usuario por un fallo transitorio.
   *
   * Pre-condiciones del tenant Auth0:
   *  - La aplicación M2M/Native debe tener "Password" grant habilitado.
   *  - El usuario debe vivir en una conexión tipo "Database". Para usuarios
   *    de SSO/Social Login, ROPC no funciona y este método retorna `false`
   *    con error_description="Wrong email or password" (Auth0 enmascara
   *    el caso por seguridad).
   *
   * Por qué ROPC y no MFA challenge: ROPC es síncrono, no requiere UI
   * adicional, y reusa la contraseña que el usuario ya conoce. MFA
   * challenge sería más fuerte pero exige flujo asíncrono y configuración
   * por usuario que no todos tienen.
   */
  async verifyPassword(
    user: AuthenticatedUser,
    password: string,
  ): Promise<boolean> {
    if (!password || password.length === 0) return false;

    // Step-up auth requiere que el usuario tenga email — ROPC `username`
    // no acepta `undefined`. Usuarios SSO sin email scope (e.g. Twitter
    // OAuth) caen aquí. Mensaje específico para distinguir de "Auth0 caído".
    if (!user.email) {
      throw new BadRequestException(
        'Tu cuenta no tiene email configurado. La verificación requiere autenticación por email/contraseña.',
      );
    }

    const issuerUrl = this.configService.getOrThrow<string>('AUTH0_ISSUER_URL');
    const audience = this.configService.getOrThrow<string>('AUTH0_AUDIENCE');
    const clientId = this.configService.get<string>(
      'AUTH0_M2M_CLIENT_ID',
    );
    const clientSecret = this.configService.get<string>(
      'AUTH0_M2M_CLIENT_SECRET',
    );

    if (!clientId || !clientSecret) {
      // FALLBACK DEV-ONLY — bypass de verificación de password cuando el
      // tenant de Auth0 no tiene ROPC configurado.
      //
      // Justificación: en NODE_ENV=development típicamente trabajas en local
      // sin posibilidad real de session hijack — el JWT que el user trae ya
      // es prueba suficiente de identidad para el flujo de VoBo. La step-up
      // auth tiene valor en producción (donde sí hay vectores de ataque sobre
      // sesiones activas), no en local development.
      //
      // SAFETY: NODE_ENV=production NUNCA cae en este bypass — siempre lanza
      // 503. Esto previene que un misconfigure de env vars en deploy abra un
      // hueco silencioso. El warning de aquí abajo aparece con cada VoBo en
      // dev como recordatorio para configurar Auth0 antes de shipping.
      const nodeEnv =
        this.configService.get<string>('NODE_ENV') ?? 'development';
      if (nodeEnv !== 'production') {
        this.logger.warn(
          `⚠️  [DEV BYPASS] AUTH0_M2M_CLIENT_ID/SECRET no configurados — VoBo aprobado SIN verificación de password (NODE_ENV=${nodeEnv}). Configura ROPC en Auth0 antes de deploy a producción.`,
        );
        return true;
      }
      this.logger.error(
        'AUTH0_M2M_CLIENT_ID/SECRET no configurados en producción — verifyPassword bloqueado',
      );
      throw new ServiceUnavailableException(
        'Verificación de contraseña no disponible (configuración incompleta)',
      );
    }

    // Defense-in-depth contra plaintext-over-HTTP. Si AUTH0_ISSUER_URL fue
    // mal configurada (e.g. dev con http://), abortamos antes de enviar
    // el password. Auth0 cloud sólo expone HTTPS, pero un proxy local mal
    // configurado podría romper esta garantía.
    if (!issuerUrl.startsWith('https://')) {
      this.logger.error(
        `AUTH0_ISSUER_URL no usa HTTPS (${issuerUrl.slice(0, 30)}...) — abortando verify-password para no transmitir password en cleartext`,
      );
      throw new ServiceUnavailableException(
        'Verificación de contraseña no disponible (configuración insegura)',
      );
    }

    const tokenUrl = `${issuerUrl.endsWith('/') ? issuerUrl : `${issuerUrl}/`}oauth/token`;

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'password',
          username: user.email,
          password,
          audience,
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'openid',
        }),
      });
    } catch (err) {
      this.logger.error(
        `verifyPassword fetch a Auth0 falló: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo verificar la contraseña — intenta de nuevo',
      );
    }

    if (response.status === 200) {
      // Token válido; descartamos el body — solo nos importa el OK.
      return true;
    }

    // Auth0 devuelve 401/403 para varios casos distintos:
    //   - invalid_grant: password incorrecta o conexión Database con
    //     credenciales no válidas. Esto SÍ es "password incorrecta".
    //   - unauthorized_client: el M2M no tiene grant Password habilitado.
    //   - access_denied: cuenta bloqueada por brute force, MFA requerido,
    //     usuario inactivo, etc. NO es "password incorrecta" — el user
    //     necesita mensaje específico para no asumir que tipeó mal.
    if (response.status === 401 || response.status === 403) {
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);
      const errorCode = typeof body?.error === 'string' ? body.error : '';
      if (errorCode === 'invalid_grant') return false;

      const description =
        typeof body?.error_description === 'string'
          ? body.error_description
          : 'auth failure';
      this.logger.warn(
        `verifyPassword Auth0 ${response.status} ${errorCode}: ${description}`,
      );
      // No reflejamos el mensaje crudo de Auth0 al cliente para no exponer
      // detalles internos del tenant. Mantenemos genérico.
      throw new ServiceUnavailableException(
        'Verificación de contraseña no disponible. Si tu cuenta está bloqueada o usa SSO, contacta a un administrador.',
      );
    }

    // 400/500/etc — algo está mal con el tenant o la red.
    const body = await response.text().catch(() => '');
    this.logger.warn(
      `verifyPassword retorno inesperado de Auth0 (${response.status}): ${body.slice(0, 200)}`,
    );
    throw new ServiceUnavailableException(
      'Verificación de contraseña no disponible',
    );
  }

  /**
   * Wrapper que lanza UnauthorizedException si la contraseña es incorrecta.
   * Útil para callers que prefieren control de flujo por excepción
   * (típicamente endpoints de aprobación).
   */
  async assertPasswordValid(
    user: AuthenticatedUser,
    password: string,
  ): Promise<void> {
    const ok = await this.verifyPassword(user, password);
    if (!ok) throw new UnauthorizedException('Contraseña incorrecta');
  }
}
