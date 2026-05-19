import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUser, ROLE_PERMISSIONS, Permission } from '@cenzontle/shared';
import { VaultConfigService } from '../vault-config.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

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
  constructor(private readonly vaultConfigs: VaultConfigService,
    @InjectPinoLogger(VaultAccessGuard.name) private readonly logger: PinoLogger,
  ) {}

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

    // Resolver el TARGET vault: si el request lleva `?vaultId=`, los checks
    // se aplican contra ESE vault (modo browse) — si no, contra el activo.
    // Sin esto, un user autorizado para el activo podría pasar otro vaultId
    // en query y operar (read/write/delete) sobre un vault al que su pod
    // no pertenece. CWE-639 BOLA — fix de security-reviewer HIGH 2026-05-04.
    const requestedVaultId = (request.query?.vaultId ??
      request.body?.vaultId) as string | undefined;

    let target: { allowedPodIds: string[]; roleDefaults: Record<string, string> };
    if (requestedVaultId) {
      try {
        target = await this.vaultConfigs.findOne(requestedVaultId);
      } catch {
        // findOne lanza NotFoundException — re-lanzamos como Forbidden para
        // no filtrar la existencia/no-existencia del vault a clientes no
        // autorizados (information disclosure secundaria).
        throw new ForbiddenException(
          'No tienes acceso a este vault o el vault no existe.',
        );
      }
    } else {
      const vaults = await this.vaultConfigs.findAll();
      const active = vaults.find((v) => v.isActive);
      if (!active) {
        throw new ForbiddenException(
          'No hay vault activo configurado. Contacta a un administrador.',
        );
      }
      target = active;
    }

    // Check 1: allowedPodIds — si está configurado, el usuario debe estar en
    // un pod permitido del TARGET vault.
    if (target.allowedPodIds.length > 0) {
      const hasAllowedPod = user.podIds.some((pid) =>
        target.allowedPodIds.includes(pid),
      );
      if (!hasAllowedPod) {
        this.logger.warn(
          `[vault-access] Denied: user=${user.sub} role=${user.role} podCount=${user.podIds.length} allowedPodCount=${target.allowedPodIds.length} requestedVaultId=${requestedVaultId ?? 'active'}`,
        );
        throw new ForbiddenException(
          'No tienes acceso a este vault. Tu pod no está en la lista de pods permitidos.',
        );
      }
    }

    // Check 2: roleDefaults — deny-by-default cuando el mapa está configurado
    // en el TARGET vault. Si roleDefaults tiene entradas, el rol del usuario
    // debe tener un nivel explícitamente permitido (owner/editor/viewer).
    // Roles ausentes o con valor 'none' son denegados.
    const roleKeys = Object.keys(target.roleDefaults);
    if (roleKeys.length > 0) {
      const roleDefault = target.roleDefaults[user.role];
      if (!ALLOWED_ACCESS_LEVELS.has(roleDefault)) {
        this.logger.warn(
          `[vault-access] Denied: user=${user.sub} role=${user.role} roleDefault=${roleDefault ?? 'undefined'} requestedVaultId=${requestedVaultId ?? 'active'}`,
        );
        throw new ForbiddenException(
          'Tu rol no tiene acceso configurado para este vault.',
        );
      }
    }

    return true;
  }
}
