'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  UserPlus,
  MoreHorizontal,
  Shield,
  UserX,
  UserCheck,
  Trash2,
  Send,
  Users,
  Crown,
  Code,
  Bug,
  Eye,
} from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import {
  UserRole,
  USER_ROLE_LABELS,
  USER_ROLE_DESCRIPTIONS,
  USER_ROLE_COLORS,
  ROLE_PERMISSIONS,
  TeamMember,
  Permission,
} from '@cenzontle/shared';

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  [UserRole.AltaGerencia]: <Crown className="h-4 w-4" />,
  [UserRole.ProductOwner]: <Users className="h-4 w-4" />,
  [UserRole.TechLead]: <Code className="h-4 w-4" />,
  [UserRole.QA]: <Bug className="h-4 w-4" />,
  [UserRole.Viewer]: <Eye className="h-4 w-4" />,
};

function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getStatusBadge(status: TeamMember['status']) {
  switch (status) {
    case 'active':
      return (
        <Badge
          variant="default"
          className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15"
        >
          Activo
        </Badge>
      );
    case 'pending':
      return (
        <Badge
          variant="default"
          className="bg-amber-500/15 text-amber-600 border-amber-500/20 hover:bg-amber-500/15"
        >
          Pendiente
        </Badge>
      );
    case 'inactive':
      return (
        <Badge
          variant="default"
          className="bg-gray-500/15 text-gray-500 border-gray-500/20 hover:bg-gray-500/15"
        >
          Inactivo
        </Badge>
      );
  }
}

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return 'Nunca';
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `Hace ${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Hace ${diffDays}d`;
}

function getRolePermissionLabels(role: UserRole): string[] {
  const labelMap: Record<string, string> = {
    'create:initiative': 'Crear Iniciativas',
    'edit:initiative': 'Editar Iniciativas',
    'delete:initiative': 'Eliminar Iniciativas',
    'create:epic': 'Crear Epicas',
    'edit:epic': 'Editar Epicas',
    'delete:epic': 'Eliminar Epicas',
    'approve:epic_po': 'VoBo PO',
    'approve:epic_tl': 'VoBo TL',
    'create:story': 'Crear Historias',
    'edit:story': 'Editar Historias',
    'delete:story': 'Eliminar Historias',
    'create:diagram': 'Crear Diagramas',
    'edit:diagram': 'Editar Diagramas',
    'create:qa_matrix': 'Crear Matriz QA',
    'edit:qa_matrix': 'Editar Matriz QA',
    'approve:qa': 'VoBo QA',
    'manage:documents': 'Documentos',
    'manage:dependencies': 'Dependencias',
    'manage:users': 'Gestionar Usuarios',
    'manage:integrations': 'Integraciones',
    'view:all': 'Ver Todo',
  };

  const permissions: string[] = ROLE_PERMISSIONS[role] ?? [];
  return permissions.map((p: string) => labelMap[p] ?? p);
}

export default function EquipoPage() {
  const { currentUser, members, dispatch, hasPermission } = useAuthContext();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>(UserRole.Viewer);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [switchingUser, setSwitchingUser] = useState(false);

  const canManageUsers = hasPermission(Permission.MANAGE_USERS);

  const filteredMembers = members.filter((m) => {
    if (filterRole !== 'all' && m.role !== filterRole) return false;
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    return true;
  });

  const handleInvite = () => {
    if (!inviteEmail || !inviteName) return;
    const newMember: TeamMember = {
      id: `user-${Date.now()}`,
      name: inviteName,
      email: inviteEmail,
      avatarUrl: '',
      role: inviteRole,
      status: 'pending',
      podIds: [],
      invitedAt: new Date().toISOString(),
      lastActiveAt: null,
    };
    dispatch({ type: 'ADD_MEMBER', payload: newMember });
    setInviteEmail('');
    setInviteName('');
    setInviteRole(UserRole.Viewer);
  };

  const handleChangeRole = (userId: string, role: UserRole) => {
    dispatch({ type: 'CHANGE_ROLE', payload: { userId, role } });
  };

  const handleDeactivate = (userId: string) => {
    dispatch({ type: 'DEACTIVATE_MEMBER', payload: userId });
  };

  const handleReactivate = (userId: string) => {
    dispatch({ type: 'REACTIVATE_MEMBER', payload: userId });
  };

  const handleRemove = (userId: string) => {
    dispatch({ type: 'REMOVE_MEMBER', payload: userId });
  };

  const handleSwitchUser = (userId: string) => {
    dispatch({ type: 'SET_CURRENT_USER', payload: userId });
    setSwitchingUser(false);
  };

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          Gestion de Equipo
        </h1>
        <p className="text-sm text-muted-foreground">
          Administra los miembros del equipo, roles y permisos de acceso.
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          {activeCount} activos
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          {pendingCount} pendientes
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-gray-400" />
          {members.length} total
        </div>
      </div>

      {/* Dev tool: switch user */}
      <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-orange-300 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-800">
        <Shield className="h-4 w-4 text-orange-500" />
        <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">
          Dev Mode — Sesion activa:
        </span>
        <Badge variant="outline" className="text-xs">
          {currentUser?.name} ({USER_ROLE_LABELS[currentUser?.role ?? UserRole.Viewer]})
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={() => setSwitchingUser(!switchingUser)}
        >
          Cambiar usuario
        </Button>
      </div>

      {switchingUser && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3 rounded-lg border bg-muted/30">
          {members
            .filter((m) => m.status === 'active')
            .map((m) => (
              <Button
                key={m.id}
                variant={m.id === currentUser?.id ? 'default' : 'outline'}
                size="sm"
                className="justify-start gap-2 h-auto py-2"
                onClick={() => handleSwitchUser(m.id)}
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-black text-white dark:bg-white dark:text-black">
                    {getInitials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-left">
                  <div className="text-xs font-medium">{m.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {USER_ROLE_LABELS[m.role]}
                  </div>
                </div>
              </Button>
            ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="members" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="members">Miembros</TabsTrigger>
          <TabsTrigger value="roles">Roles y Permisos</TabsTrigger>
        </TabsList>

        {/* === MEMBERS TAB === */}
        <TabsContent value="members" className="space-y-4">
          {/* Invite form */}
          {canManageUsers && (
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Invitar nuevo miembro
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nombre</Label>
                  <Input
                    placeholder="Nombre completo"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    placeholder="email@aeromexico.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Rol</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as UserRole)}
                  >
                    <SelectTrigger className="w-[160px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(USER_ROLE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex items-center gap-2">
                            {ROLE_ICONS[value as UserRole]}
                            {label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleInvite}
                  disabled={!inviteEmail || !inviteName}
                  className="h-9"
                >
                  <Send className="h-4 w-4 mr-1" />
                  Invitar
                </Button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-3">
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="Filtrar por rol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los roles</SelectItem>
                {Object.entries(USER_ROLE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="inactive">Inactivos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Members table */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[280px]">Miembro</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Ultima actividad</TableHead>
                  {canManageUsers && <TableHead className="w-[50px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback
                            className="text-xs font-medium"
                            style={{
                              backgroundColor: USER_ROLE_COLORS[member.role] + '20',
                              color: USER_ROLE_COLORS[member.role],
                            }}
                          >
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium text-sm flex items-center gap-1.5">
                            {member.name}
                            {member.id === currentUser?.id && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                Tu
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {canManageUsers && member.id !== currentUser?.id ? (
                        <Select
                          value={member.role}
                          onValueChange={(v) =>
                            handleChangeRole(member.id, v as UserRole)
                          }
                        >
                          <SelectTrigger className="w-[160px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(USER_ROLE_LABELS).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  <div className="flex items-center gap-2">
                                    {ROLE_ICONS[value as UserRole]}
                                    {label}
                                  </div>
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: USER_ROLE_COLORS[member.role],
                            }}
                          />
                          {USER_ROLE_LABELS[member.role]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(member.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelativeTime(member.lastActiveAt)}
                    </TableCell>
                    {canManageUsers && (
                      <TableCell>
                        {member.id !== currentUser?.id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {member.status === 'active' ? (
                                <DropdownMenuItem
                                  onClick={() => handleDeactivate(member.id)}
                                >
                                  <UserX className="h-4 w-4 mr-2" />
                                  Desactivar
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => handleReactivate(member.id)}
                                >
                                  <UserCheck className="h-4 w-4 mr-2" />
                                  Reactivar
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleRemove(member.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!canManageUsers && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Solo los usuarios con rol Alta Gerencia pueden gestionar miembros
              del equipo.
            </div>
          )}
        </TabsContent>

        {/* === ROLES TAB === */}
        <TabsContent value="roles" className="space-y-4">
          <div className="grid gap-4">
            {Object.values(UserRole).map((role) => {
              const memberCount = members.filter(
                (m) => m.role === role
              ).length;
              return (
                <div
                  key={role}
                  className="p-4 rounded-lg border bg-card"
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: USER_ROLE_COLORS[role],
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="p-2 rounded-lg"
                        style={{
                          backgroundColor: USER_ROLE_COLORS[role] + '15',
                        }}
                      >
                        <div style={{ color: USER_ROLE_COLORS[role] }}>
                          {ROLE_ICONS[role]}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-medium text-sm">
                          {USER_ROLE_LABELS[role]}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {USER_ROLE_DESCRIPTIONS[role]}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {memberCount}{' '}
                      {memberCount === 1 ? 'miembro' : 'miembros'}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {getRolePermissionLabels(role).map((label) => (
                      <Badge
                        key={label}
                        variant="secondary"
                        className="text-[10px] font-normal"
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
