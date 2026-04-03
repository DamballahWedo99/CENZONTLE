import { NodeAccessConfig, AccessControlEntry, UserRole } from '@cenzontle/shared';

function ace(
  id: string,
  nodeId: string,
  principalType: 'user' | 'role',
  principalId: string,
  accessLevel: 'owner' | 'editor' | 'viewer' | 'none',
  grantedBy = 'user-1',
): AccessControlEntry {
  return {
    id,
    nodeId,
    principalType,
    principalId,
    accessLevel,
    inherited: false,
    grantedBy,
    grantedAt: '2026-01-15T10:00:00Z',
  };
}

function rootConfig(nodeId: string, entries: AccessControlEntry[]): NodeAccessConfig {
  return { nodeId, inheritFromParent: false, entries };
}

function inheritConfig(nodeId: string, entries: AccessControlEntry[] = []): NodeAccessConfig {
  return { nodeId, inheritFromParent: true, entries };
}

// Standard root access: AltaGerencia=owner, PO=editor, TL=editor, QA=viewer, Viewer=viewer
function standardRootEntries(nodeId: string, prefix: string): AccessControlEntry[] {
  return [
    ace(`${prefix}-ag`, nodeId, 'role', UserRole.AltaGerencia, 'owner'),
    ace(`${prefix}-po`, nodeId, 'role', UserRole.ProductOwner, 'editor'),
    ace(`${prefix}-tl`, nodeId, 'role', UserRole.TechLead, 'editor'),
    ace(`${prefix}-qa`, nodeId, 'role', UserRole.QA, 'viewer'),
    ace(`${prefix}-vw`, nodeId, 'role', UserRole.Viewer, 'viewer'),
  ];
}

// Restricted access: only AltaGerencia + specific roles
function restrictedRootEntries(
  nodeId: string,
  prefix: string,
  extra: { role: string; level: 'editor' | 'viewer' }[] = [],
): AccessControlEntry[] {
  return [
    ace(`${prefix}-ag`, nodeId, 'role', UserRole.AltaGerencia, 'owner'),
    ...extra.map((e, i) =>
      ace(`${prefix}-x${i}`, nodeId, 'role', e.role, e.level),
    ),
  ];
}

export const mockAccessConfig: Record<string, NodeAccessConfig> = {
  // === Standard folders (all roles have access) ===
  'folder-negocio': rootConfig('folder-negocio', standardRootEntries('folder-negocio', 'neg')),
  'folder-dominio': rootConfig('folder-dominio', standardRootEntries('folder-dominio', 'dom')),
  'folder-procesos': rootConfig('folder-procesos', standardRootEntries('folder-procesos', 'proc')),
  'folder-kpis': rootConfig('folder-kpis', standardRootEntries('folder-kpis', 'kpi')),
  'folder-canales': rootConfig('folder-canales', standardRootEntries('folder-canales', 'can')),
  'folder-flota': rootConfig('folder-flota', standardRootEntries('folder-flota', 'flt')),
  'folder-experiencia': rootConfig('folder-experiencia', standardRootEntries('folder-experiencia', 'exp')),
  'folder-rrhh': rootConfig('folder-rrhh', standardRootEntries('folder-rrhh', 'rh')),
  'folder-cargo': rootConfig('folder-cargo', standardRootEntries('folder-cargo', 'crg')),

  // === Restricted folders ===
  'folder-seguridad': rootConfig('folder-seguridad', restrictedRootEntries(
    'folder-seguridad', 'sec',
    [{ role: UserRole.TechLead, level: 'editor' }, { role: UserRole.QA, level: 'viewer' }],
  )),
  'folder-regulatorio': rootConfig('folder-regulatorio', restrictedRootEntries(
    'folder-regulatorio', 'reg',
    [{ role: UserRole.ProductOwner, level: 'viewer' }],
  )),

  // === Integraciones: standard + user override (Roberto Sánchez as owner) ===
  'folder-integraciones': rootConfig('folder-integraciones', [
    ...standardRootEntries('folder-integraciones', 'int'),
    ace('int-rob', 'folder-integraciones', 'user', 'user-4', 'owner'),
  ]),

  // === Child folders inherit by default ===
  'folder-glosario': inheritConfig('folder-glosario'),
  'folder-aeropuertos': inheritConfig('folder-aeropuertos'),
  'folder-feedback': inheritConfig('folder-feedback'),
};

export function getDefaultAccessConfig(nodeId: string): NodeAccessConfig {
  return { nodeId, inheritFromParent: true, entries: [] };
}
