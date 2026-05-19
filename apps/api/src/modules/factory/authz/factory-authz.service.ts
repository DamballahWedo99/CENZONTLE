import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole, type AuthenticatedUser } from '@cenzontle/shared';

/**
 * Authz centralizada para operaciones de gestión del Factory.
 *
 * Extraída de `FleetService.assertCanManageFleet` (architecture-reviewer WARN
 * 2026-05-13) para romper el ciclo `FleetModule ↔ DodModule`. Antes, DodModule
 * importaba FleetModule (vía forwardRef) solo para reusar este método; ahora
 * DodModule importa FactoryAuthzModule directamente — dependencia unidireccional.
 *
 * Otros consumidores (FleetController, BranchStrategyController, OrgAnthropicConfig
 * Controller) siguen llamando `FleetService.assertCanManageFleet` que delega acá
 * para preservar backwards-compat; cuando el refactor llegue a esos modulos
 * pueden cambiar a inyección directa de FactoryAuthzService.
 *
 * Política actual: solo AltaGerencia puede gestionar el factory. Mes 2+
 * podemos relajar a "Tech Lead del pod del recurso" cuando agreguemos
 * ComputeNode.podId / pod-based ACLs.
 */
@Injectable()
export class FactoryAuthzService {
  /**
   * Throw `ForbiddenException` si el user no puede gestionar el factory
   * (operaciones de Alta Gerencia: flota de cómputo, catálogo DoD,
   * estrategia de branching, configuración Anthropic por organización).
   */
  assertCanManageFleet(user: AuthenticatedUser): void {
    if (user.role !== UserRole.AltaGerencia) {
      throw new ForbiddenException(
        'Solo Alta Gerencia puede gestionar la flota de cómputo',
      );
    }
  }
}
