'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
  Loader2,
} from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import {
  UserRole,
  USER_ROLE_LABELS,
  USER_ROLE_DESCRIPTIONS,
  USER_ROLE_COLORS,
  TeamMember,
  Permission,
} from '@cenzontle/shared';

interface TeamManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
      return <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15">Activo</Badge>;
    case 'pending':
      return <Badge variant="default" className="bg-amber-500/15 text-amber-600 border-amber-500/20 hover:bg-amber-500/15">Pendiente</Badge>;
    case 'inactive':
      return <Badge variant="default" className="bg-gray-500/15 text-gray-500 border-gray-500/20 hover:bg-gray-500/15">Inactivo</Badge>;
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

export function TeamManagementDialog({ open, onOpenChange }: TeamManagementDialogProps) {
  const {
    currentUser,
    members,
    hasPermission,
    handleInvite: ctxInvite,
    handleChangeRole: ctxChangeRole,
    handleDeactivate: ctxDeactivate,
    handleReactivate: ctxReactivate,
    handleRemove: ctxRemove,
  } = useAuthContext();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>(UserRole.Viewer);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [saving, setSaving] = useState(false);
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canManageUsers = hasPermission(Permission.MANAGE_USERS);

  const filteredMembers = members.filter((m) => {
    if (filterRole !== 'all' && m.role !== filterRole) return false;
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    return true;
  });

  const handleInvite = async () => {
    if (!inviteEmail || !inviteName || saving) return;
    setSaving(true);
    try {
      await ctxInvite(inviteEmail, inviteName, inviteRole);
      setInviteEmail('');
      setInviteName('');
      setInviteRole(UserRole.Viewer);
      toast.success('Usuario invitado. Se envio un email para establecer contrasena.');
    } catch {
      toast.error('Error al invitar usuario. Verifica que el email no este registrado.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeRole = async (userId: string, role: UserRole) => {
    try {
      await ctxChangeRole(userId, role);
      toast.success(`Rol actualizado a ${USER_ROLE_LABELS[role]}`);
    } catch {
      toast.error('Error al cambiar rol');
    }
  };

  const handleDeactivate = async (userId: string) => {
    try {
      await ctxDeactivate(userId);
      toast.success('Usuario desactivado');
    } catch {
      toast.error('Error al desactivar usuario');
    }
  };

  const handleReactivate = async (userId: string) => {
    try {
      await ctxReactivate(userId);
      toast.success('Usuario reactivado');
    } catch {
      toast.error('Error al reactivar usuario');
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await ctxRemove(userId);
      toast.success('Usuario eliminado');
    } catch {
      toast.error('Error al eliminar usuario');
    }
  };

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Users className="h-5 w-5" />
            Gestión de Equipo
          </DialogTitle>
          <DialogDescription>
            Administra los miembros del equipo, roles y permisos de acceso.
          </DialogDescription>
        </DialogHeader>

        {/* Stats bar */}
        <div className="flex gap-4 mb-2">
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

        <Tabs defaultValue="members" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
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
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
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
                      placeholder="email@cenzontle.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rol</Label>
                    <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
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
                    <SelectItem key={value} value={value}>{label}</SelectItem>
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
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">Tu</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{member.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManageUsers && member.id !== currentUser?.id ? (
                          <Select
                            value={member.role}
                            onValueChange={(v) => handleChangeRole(member.id, v as UserRole)}
                          >
                            <SelectTrigger className="w-[160px] h-8 text-xs">
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
                        ) : (
                          <div className="flex items-center gap-2 text-sm">
                            <div
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: USER_ROLE_COLORS[member.role] }}
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
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {member.status === 'active' ? (
                                  <DropdownMenuItem onClick={() => handleDeactivate(member.id)}>
                                    <UserX className="h-4 w-4 mr-2" />
                                    Desactivar
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => handleReactivate(member.id)}>
                                    <UserCheck className="h-4 w-4 mr-2" />
                                    Reactivar
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => setDeletingMember(member)}
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
                Solo los usuarios con rol Alta Gerencia pueden gestionar miembros del equipo.
              </div>
            )}
          </TabsContent>

          {/* === ROLES TAB === */}
          <TabsContent value="roles" className="space-y-4">
            <div className="grid gap-4">
              {Object.values(UserRole).map((role) => {
                const memberCount = members.filter((m) => m.role === role).length;
                return (
                  <div
                    key={role}
                    className="p-4 rounded-lg border bg-card"
                    style={{ borderLeftWidth: 4, borderLeftColor: USER_ROLE_COLORS[role] }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="p-2 rounded-lg"
                          style={{ backgroundColor: USER_ROLE_COLORS[role] + '15' }}
                        >
                          <div style={{ color: USER_ROLE_COLORS[role] }}>
                            {ROLE_ICONS[role]}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm">{USER_ROLE_LABELS[role]}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {USER_ROLE_DESCRIPTIONS[role]}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {memberCount} {memberCount === 1 ? 'miembro' : 'miembros'}
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
      </DialogContent>

      {/* Confirmacion de eliminacion */}
      <Dialog open={!!deletingMember} onOpenChange={(o) => !o && setDeletingMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar usuario</DialogTitle>
            <DialogDescription>
              Esta accion eliminara permanentemente a <strong>{deletingMember?.name}</strong> ({deletingMember?.email}) del sistema. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button variant="outline" onClick={() => setDeletingMember(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={async () => {
                if (!deletingMember) return;
                setDeleting(true);
                try {
                  await handleRemove(deletingMember.id);
                  setDeletingMember(null);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
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

  const { ROLE_PERMISSIONS } = require('@cenzontle/shared');
  const permissions: string[] = ROLE_PERMISSIONS[role] ?? [];
  return permissions.map((p: string) => labelMap[p] ?? p);
}
