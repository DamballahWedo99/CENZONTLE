// === RBAC Types ===

export enum UserRole {
  AltaGerencia = 'alta_gerencia',
  ProductOwner = 'product_owner',
  TechLead = 'tech_lead',
  QA = 'qa',
  Viewer = 'viewer',
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.AltaGerencia]: 'Alta Gerencia',
  [UserRole.ProductOwner]: 'Product Owner',
  [UserRole.TechLead]: 'Tech Lead',
  [UserRole.QA]: 'QA',
  [UserRole.Viewer]: 'Viewer',
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  [UserRole.AltaGerencia]: 'Puede crear iniciativas, gestionar usuarios y ver todo',
  [UserRole.ProductOwner]: 'Puede crear épicas, aprobar historias y gestionar stories',
  [UserRole.TechLead]: 'Puede crear/aprobar diagramas, definiciones técnicas y épicas',
  [UserRole.QA]: 'Puede crear/aprobar matrices QA, Gherkin y test execution',
  [UserRole.Viewer]: 'Solo lectura: dashboards, reportes y seguimiento',
};

export const USER_ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.AltaGerencia]: '#1e40af',
  [UserRole.ProductOwner]: '#3b82f6',
  [UserRole.TechLead]: '#f59e0b',
  [UserRole.QA]: '#10b981',
  [UserRole.Viewer]: '#6b7280',
};

export enum Permission {
  // Initiatives
  CREATE_INITIATIVE = 'create:initiative',
  EDIT_INITIATIVE = 'edit:initiative',
  DELETE_INITIATIVE = 'delete:initiative',

  // Epics
  CREATE_EPIC = 'create:epic',
  EDIT_EPIC = 'edit:epic',
  DELETE_EPIC = 'delete:epic',
  APPROVE_EPIC_PO = 'approve:epic_po',
  APPROVE_EPIC_TL = 'approve:epic_tl',

  // Stories
  CREATE_STORY = 'create:story',
  EDIT_STORY = 'edit:story',
  DELETE_STORY = 'delete:story',

  // Diagrams
  CREATE_DIAGRAM = 'create:diagram',
  EDIT_DIAGRAM = 'edit:diagram',

  // QA
  CREATE_QA_MATRIX = 'create:qa_matrix',
  EDIT_QA_MATRIX = 'edit:qa_matrix',
  APPROVE_QA = 'approve:qa',

  // Documents
  MANAGE_DOCUMENTS = 'manage:documents',

  // Dependencies
  MANAGE_DEPENDENCIES = 'manage:dependencies',

  // Admin
  MANAGE_USERS = 'manage:users',
  MANAGE_INTEGRATIONS = 'manage:integrations',
  MANAGE_DIAGRAM_THEME = 'manage:diagram-theme',

  // View
  VIEW_ALL = 'view:all',
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.CREATE_INITIATIVE]: 'Crear Iniciativas',
  [Permission.EDIT_INITIATIVE]: 'Editar Iniciativas',
  [Permission.DELETE_INITIATIVE]: 'Eliminar Iniciativas',
  [Permission.CREATE_EPIC]: 'Crear Épicas',
  [Permission.EDIT_EPIC]: 'Editar Épicas',
  [Permission.DELETE_EPIC]: 'Eliminar Épicas',
  [Permission.APPROVE_EPIC_PO]: 'VoBo Product Owner',
  [Permission.APPROVE_EPIC_TL]: 'VoBo Tech Lead',
  [Permission.CREATE_STORY]: 'Crear Historias',
  [Permission.EDIT_STORY]: 'Editar Historias',
  [Permission.DELETE_STORY]: 'Eliminar Historias',
  [Permission.CREATE_DIAGRAM]: 'Crear Diagramas',
  [Permission.EDIT_DIAGRAM]: 'Editar Diagramas',
  [Permission.CREATE_QA_MATRIX]: 'Crear Matriz QA',
  [Permission.EDIT_QA_MATRIX]: 'Editar Matriz QA',
  [Permission.APPROVE_QA]: 'VoBo QA',
  [Permission.MANAGE_DOCUMENTS]: 'Gestionar Documentos',
  [Permission.MANAGE_DEPENDENCIES]: 'Gestionar Dependencias',
  [Permission.MANAGE_USERS]: 'Gestionar Usuarios',
  [Permission.MANAGE_INTEGRATIONS]: 'Gestionar Integraciones',
  [Permission.MANAGE_DIAGRAM_THEME]: 'Gestionar tema de diagramas',
  [Permission.VIEW_ALL]: 'Ver Todo',
};

export interface PermissionCategory {
  label: string;
  permissions: Permission[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'Iniciativas',
    permissions: [Permission.CREATE_INITIATIVE, Permission.EDIT_INITIATIVE, Permission.DELETE_INITIATIVE],
  },
  {
    label: 'Épicas',
    permissions: [Permission.CREATE_EPIC, Permission.EDIT_EPIC, Permission.DELETE_EPIC, Permission.APPROVE_EPIC_PO, Permission.APPROVE_EPIC_TL],
  },
  {
    label: 'Historias',
    permissions: [Permission.CREATE_STORY, Permission.EDIT_STORY, Permission.DELETE_STORY],
  },
  {
    label: 'Diagramas',
    permissions: [Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM],
  },
  {
    label: 'QA',
    permissions: [Permission.CREATE_QA_MATRIX, Permission.EDIT_QA_MATRIX, Permission.APPROVE_QA],
  },
  {
    label: 'Gestión',
    permissions: [Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES, Permission.MANAGE_USERS, Permission.MANAGE_INTEGRATIONS, Permission.MANAGE_DIAGRAM_THEME],
  },
  {
    label: 'Acceso',
    permissions: [Permission.VIEW_ALL],
  },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.AltaGerencia]: [
    Permission.CREATE_INITIATIVE, Permission.EDIT_INITIATIVE, Permission.DELETE_INITIATIVE,
    Permission.CREATE_EPIC, Permission.EDIT_EPIC, Permission.DELETE_EPIC,
    Permission.CREATE_STORY, Permission.EDIT_STORY, Permission.DELETE_STORY,
    Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM,
    Permission.CREATE_QA_MATRIX, Permission.EDIT_QA_MATRIX,
    Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES,
    Permission.MANAGE_USERS, Permission.MANAGE_INTEGRATIONS, Permission.MANAGE_DIAGRAM_THEME,
    Permission.VIEW_ALL,
  ],
  [UserRole.ProductOwner]: [
    Permission.CREATE_EPIC, Permission.EDIT_EPIC,
    Permission.CREATE_STORY, Permission.EDIT_STORY, Permission.DELETE_STORY,
    Permission.APPROVE_EPIC_PO,
    Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM,
    Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES,
    Permission.VIEW_ALL,
  ],
  [UserRole.TechLead]: [
    Permission.EDIT_EPIC,
    Permission.CREATE_STORY, Permission.EDIT_STORY,
    Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM,
    Permission.APPROVE_EPIC_TL,
    Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES,
    Permission.VIEW_ALL,
  ],
  [UserRole.QA]: [
    Permission.CREATE_QA_MATRIX, Permission.EDIT_QA_MATRIX,
    Permission.APPROVE_QA,
    Permission.MANAGE_DOCUMENTS,
    Permission.VIEW_ALL,
  ],
  [UserRole.Viewer]: [
    Permission.VIEW_ALL,
  ],
};

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.AltaGerencia]: [
    Permission.CREATE_INITIATIVE, Permission.EDIT_INITIATIVE, Permission.DELETE_INITIATIVE,
    Permission.CREATE_EPIC, Permission.EDIT_EPIC, Permission.DELETE_EPIC,
    Permission.CREATE_STORY, Permission.EDIT_STORY, Permission.DELETE_STORY,
    Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM,
    Permission.CREATE_QA_MATRIX, Permission.EDIT_QA_MATRIX,
    Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES,
    Permission.MANAGE_USERS, Permission.MANAGE_INTEGRATIONS, Permission.MANAGE_DIAGRAM_THEME,
    Permission.VIEW_ALL,
  ],
  [UserRole.ProductOwner]: [
    Permission.CREATE_EPIC, Permission.EDIT_EPIC,
    Permission.CREATE_STORY, Permission.EDIT_STORY, Permission.DELETE_STORY,
    Permission.APPROVE_EPIC_PO,
    Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM,
    Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES,
    Permission.VIEW_ALL,
  ],
  [UserRole.TechLead]: [
    Permission.EDIT_EPIC,
    Permission.CREATE_STORY, Permission.EDIT_STORY,
    Permission.CREATE_DIAGRAM, Permission.EDIT_DIAGRAM,
    Permission.APPROVE_EPIC_TL,
    Permission.MANAGE_DOCUMENTS, Permission.MANAGE_DEPENDENCIES,
    Permission.VIEW_ALL,
  ],
  [UserRole.QA]: [
    Permission.CREATE_QA_MATRIX, Permission.EDIT_QA_MATRIX,
    Permission.APPROVE_QA,
    Permission.MANAGE_DOCUMENTS,
    Permission.VIEW_ALL,
  ],
  [UserRole.Viewer]: [
    Permission.VIEW_ALL,
  ],
};

export type MemberStatus = 'active' | 'pending' | 'inactive';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
  status: MemberStatus;
  podIds: string[];
  invitedAt: string;
  lastActiveAt: string | null;
}

// === Auth Types (Auth0 integration) ===

export interface JwtPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  azp?: string;
  scope?: string;
  'https://cenzontle.app/role'?: UserRole;
  'https://cenzontle.app/pod_ids'?: string[];
}

export interface AuthenticatedUser {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  role: UserRole;
  podIds: string[];
}
