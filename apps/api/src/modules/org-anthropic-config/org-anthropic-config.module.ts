import { Module } from '@nestjs/common';
import { OrgAnthropicConfigController } from './org-anthropic-config.controller';
import { OrgAnthropicConfigService } from './org-anthropic-config.service';
import { FactoryAuthzModule } from '../factory/authz/factory-authz.module';

/**
 * Módulo top-level dedicado a la gestión de la API key de Anthropic a nivel
 * de organización (singleton encriptado en `OrgAnthropicConfig`).
 *
 * Por qué top-level (par de `agent-token-settings/`, `external-secrets/`,
 * `branding-settings/`, etc.):
 *  - Es un singleton de configuración del workspace, no específico de Fleet.
 *  - Tiene 2+ consumidores en módulos distintos (FleetModule, ProyectosModule).
 *    Mantenerlo dentro de `factory/fleet/` creaba imports invertidos
 *    (`proyectos/.../generation` → `factory/fleet/org-anthropic-config`)
 *    que confunden los límites de dominio.
 *  - El patrón del proyecto coloca settings singleton en `modules/<feature>/`
 *    top-level. Ej.: `agent-token-settings/`, `branding-settings/`,
 *    `diagram-theme-settings/`.
 *
 * Cómo se resuelve la dependencia circular entre Fleet y Proyectos:
 *  - FleetModule importa ProyectosModule (ChangelogService).
 *  - ProyectosModule necesita el service de OrgAnthropicConfig en los
 *    services de generación (épicas/historias/diagramas).
 *  - Si ProyectosModule importara FleetModule → dependencia circular.
 *  - Tener este módulo top-level rompe el ciclo: FleetModule y ProyectosModule
 *    importan OrgAnthropicConfigModule directamente.
 *
 * Authz:
 *  - El controller usa `FactoryAuthzService` para gating Alta Gerencia.
 *  - Antes (cuando vivía en FleetModule) delegaba en `FleetService.assertCanManageFleet`.
 *  - Ahora se inyecta `FactoryAuthzService` directamente — rompe la dependencia
 *    inversa "config → fleet" y deja el authz como su único punto de verdad.
 *
 * Dependencias globales (no se importan explícitamente):
 *  - PrismaService (@Global PrismaModule) — para leer/escribir OrgAnthropicConfig.
 *  - CryptoService (@Global VaultModule) — para encriptar/desencriptar la API
 *    key con AES-256-GCM.
 */
@Module({
  imports: [FactoryAuthzModule],
  controllers: [OrgAnthropicConfigController],
  providers: [OrgAnthropicConfigService],
  exports: [OrgAnthropicConfigService],
})
export class OrgAnthropicConfigModule {}
