import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthenticatedUser, ROLE_PERMISSIONS, Permission } from '@cenzontle/shared';
import { VaultConfigService } from '../vault-config.service';

const ALLOWED_ACCESS_LEVELS = new Set(['owner', 'editor', 'viewer']);

/**
 * Guard que enforcea access control server-side para endpoints de lectura del vault.
 *
 * Verifica dos condiciones contra el vault activo:
 * 1. allowedPodIds — si no está vacío, el usuario debe pertenecer a al menos un pod permitido.
 * 2. roleDefaults — deny-by-default: si el mapa está configurado y el rol del usuario
 *    no tiene un nivel permitido (owner/editor/viewer), se deniega el acceso.
 *
 * Usuarios con MANAGE_INTEGRATIONS siempre pasan (admins del vault).
 */
@Injectable()
export class VaultAccessGuard implements CanActivate {
  private readonly logger = new Logger(VaultAccessGuard.name);

  constructor(private readonly vaultConfigs: VaultConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    // Admins del vault siempre tienen acceso
    const userPermissions = ROLE_PERMISSIONS[user.role] || [];
    if (userPermissions.includes(Permission.MANAGE_INTEGRATIONS)) {
      return true;
    }

    // Obtener el vault activo (sin token — solo metadata pública)
    const vaults = await this.vaultConfigs.findAll();
    const active = vaults.find((v) => v.isActive);
    if (!active) {
      throw new ForbiddenException(
        'No hay vault activo configurado. Contacta a un administrador.',
      );
    }

    // Check 1: allowedPodIds — si está configurado, el usuario debe estar en un pod permitido
    if (active.allowedPodIds.length > 0) {
      const hasAllowedPod = user.podIds.some((pid) =>
        active.allowedPodIds.includes(pid),
      );
      if (!hasAllowedPod) {
        this.logger.warn(
          `[vault-access] Denied: user=${user.sub} role=${user.role} podCount=${user.podIds.length} allowedPodCount=${active.allowedPodIds.length}`,
        );
        throw new ForbiddenException(
          'No tienes acceso a este vault. Tu pod no está en la lista de pods permitidos.',
        );
      }
    }

    // Check 2: roleDefaults — deny-by-default cuando el mapa está configurado.
    // Si roleDefaults tiene entradas, el rol del usuario debe tener un nivel
    // explícitamente permitido (owner/editor/viewer). Roles ausentes o con
    // valor 'none' son denegados.
    const roleKeys = Object.keys(active.roleDefaults);
    if (roleKeys.length > 0) {
      const roleDefault = active.roleDefaults[user.role];
      if (!ALLOWED_ACCESS_LEVELS.has(roleDefault)) {
        this.logger.warn(
          `[vault-access] Denied: user=${user.sub} role=${user.role} roleDefault=${roleDefault ?? 'undefined'}`,
        );
        throw new ForbiddenException(
          'Tu rol no tiene acceso configurado para este vault.',
        );
      }
    }

    return true;
  }
}
