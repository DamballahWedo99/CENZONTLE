'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
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
  Search,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthContext } from '@/context/AuthContext';
import { getPods, type PodResponse } from '@/lib/api/pods';
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

export function TeamSection() {
  const {
    currentUser,
    members,
    hasPermission,
    handleInvite: ctxInvite,
    handleChangeRole: ctxChangeRole,
    handleChangePods: ctxChangePods,
    handleDeactivate: ctxDeactivate,
    handleReactivate: ctxReactivate,
    handleRemove: ctxRemove,
  } = useAuthContext();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>(UserRole.ProductOwner);
  const [invitePod, setInvitePod] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPod, setFilterPod] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pods, setPods] = useState<PodResponse[]>([]);

  useEffect(() => {
    getPods().then(setPods).catch(() => {});
  }, []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const inviteSchema = z.object({
    name: z.string().min(2, 'Minimo 2 caracteres').max(100, 'Maximo 100 caracteres'),
    email: z.string().email('Email invalido'),
    role: z.nativeEnum(UserRole),
  });

  const canManageUsers = hasPermission(Permission.MANAGE_USERS);

  const filteredMembers = members.filter((m) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
    }
    if (filterRole !== 'all' && m.role !== filterRole) return false;
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    if (filterPod !== 'all' && !m.podIds.includes(filterPod)) return false;
    return true;
  });

  const selectableMembers = filteredMembers.filter((m) => m.id !== currentUser?.id);
  const allSelected = selectableMembers.length > 0 && selectableMembers.every((m) => selectedIds.has(m.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableMembers.map((m) => m.id)));
    }
  };

  const handleBulkDeactivate = async () => {
    if (selectedIds.size === 0) return;
    setBulkAction(true);
    try {
      await Promise.all([...selectedIds].map((id) => ctxDeactivate(id)));
      toast.success(`${selectedIds.size} usuario(s) desactivado(s)`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Error al desactivar usuarios');
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkAction(true);
    try {
      await Promise.all([...selectedIds].map((id) => ctxRemove(id)));
      toast.success(`${selectedIds.size} usuario(s) eliminado(s)`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Error al eliminar usuarios');
    } finally {
      setBulkAction(false);
    }
  };

  const handleInvite = async (): Promise<boolean> => {
    const result = inviteSchema.safeParse({ name: inviteName, email: inviteEmail, role: inviteRole });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        fieldErrors[issue.path[0] as string] = issue.message;
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    if (saving) return false;
    setSaving(true);
    try {
      await ctxInvite(inviteEmail, inviteName, inviteRole, invitePod ? [invitePod] : []);
      setInviteEmail('');
      setInviteName('');
      setInviteRole(UserRole.ProductOwner);
      setInvitePod('');
      toast.success('Usuario invitado. Se envio un email para establecer contrasena.');
      return true;
    } catch {
      toast.error('Error al invitar usuario. Verifica que el email no este registrado.');
      return false;
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

  // Sentinel value para el SelectItem "Sin célula". El componente Select de
  // Radix no acepta value="" — necesita un string truthy. Usamos este token
  // y lo traducimos a array vacío al llamar al backend (= unset pod).
  const NO_POD_VALUE = '__none__';

  const handleChangePod = async (userId: string, podValue: string) => {
    const podIds = podValue === NO_POD_VALUE ? [] : [podValue];
    const podLabel = podValue === NO_POD_VALUE
      ? 'sin célula'
      : pods.find((p) => p.id === podValue)?.name ?? 'célula desconocida';
    try {
      await ctxChangePods(userId, podIds);
      toast.success(`Usuario asignado a ${podLabel}`);
    } catch {
      toast.error('Error al asignar célula');
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
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            Gestion de Equipo
          </h1>
          <p className="text-sm text-muted-foreground">
            Administra los miembros del equipo, roles y permisos de acceso.
          </p>
        </div>
      </div>

      {/* Busqueda + Filtros + Agregar */}
      <div className="flex items-center gap-3 mt-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar usuario..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-[280px] pl-8 text-xs"
          />
        </div>
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
        <Select value={filterPod} onValueChange={setFilterPod}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Filtrar por célula" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las células</SelectItem>
            {pods.map((pod) => (
              <SelectItem key={pod.id} value={pod.id}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pod.color }} />
                  {pod.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManageUsers && (
          <Button
            size="sm"
            className="gap-2 ml-auto"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" /> Agregar usuario
          </Button>
        )}
      </div>

      {/* Acciones en lote */}
      {canManageUsers && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mt-3 p-2.5 rounded-lg border bg-muted/50">
          <span className="text-xs font-medium">{selectedIds.size} seleccionado(s)</span>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleBulkDeactivate} disabled={bulkAction}>
            {bulkAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
            Desactivar
          </Button>
          <Button variant="destructive" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setDeletingMember({ id: 'bulk', name: `${selectedIds.size} usuarios`, email: '' } as TeamMember)} disabled={bulkAction}>
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={() => setSelectedIds(new Set())}>
            Cancelar
          </Button>
        </div>
      )}

      {/* Tabla de miembros */}
      <div className="rounded-lg border mt-4 bg-gray-50/50 dark:bg-zinc-900/50 shadow-sm flex-1 min-h-0 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {canManageUsers && (
                <TableHead className="w-[40px]">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
              )}
              <TableHead className="w-[280px]">Miembro</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Célula</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Última actividad</TableHead>
              {canManageUsers && <TableHead className="w-[50px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.map((member) => (
              <TableRow key={member.id} className={selectedIds.has(member.id) ? 'bg-muted/50' : ''}>
                {canManageUsers && (
                  <TableCell>
                    <div title={member.id === currentUser?.id ? 'No puedes seleccionarte a ti mismo' : undefined}>
                      <Checkbox
                        checked={selectedIds.has(member.id)}
                        onCheckedChange={() => toggleSelect(member.id)}
                        disabled={member.id === currentUser?.id}
                      />
                    </div>
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs font-medium" style={{ backgroundColor: USER_ROLE_COLORS[member.role] + '20', color: USER_ROLE_COLORS[member.role] }}>
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm flex items-center gap-1.5">
                        {member.name}
                        {member.id === currentUser?.id && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Tú</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{member.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {canManageUsers && member.id !== currentUser?.id ? (
                    <Select value={member.role} onValueChange={(v) => handleChangeRole(member.id, v as UserRole)}>
                      <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(USER_ROLE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            <div className="flex items-center gap-2">{ROLE_ICONS[value as UserRole]}{label}</div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 text-sm">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: USER_ROLE_COLORS[member.role] }} />
                      {USER_ROLE_LABELS[member.role]}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {canManageUsers && member.id !== currentUser?.id ? (
                    <Select
                      value={member.podIds[0] ?? NO_POD_VALUE}
                      onValueChange={(v) => handleChangePod(member.id, v)}
                    >
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue placeholder="Sin célula" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_POD_VALUE}>
                          <span className="text-muted-foreground">Sin célula</span>
                        </SelectItem>
                        {pods.map((pod) => (
                          <SelectItem key={pod.id} value={pod.id}>
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pod.color }} />
                              {pod.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    (() => {
                      const pod = pods.find((p) => member.podIds.includes(p.id));
                      return pod ? (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pod.color }} />
                          {pod.name}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      );
                    })()
                  )}
                </TableCell>
                <TableCell>{getStatusBadge(member.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatRelativeTime(member.lastActiveAt)}</TableCell>
                {canManageUsers && (
                  <TableCell>
                    {member.id !== currentUser?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {member.status === 'active' ? (
                            <DropdownMenuItem onClick={() => handleDeactivate(member.id)}><UserX className="h-4 w-4 mr-2" />Desactivar</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleReactivate(member.id)}><UserCheck className="h-4 w-4 mr-2" />Reactivar</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setDeletingMember(member)} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4 mr-2" />Eliminar</DropdownMenuItem>
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

      {/* Modal invitar nuevo miembro */}
      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open) { setInviteOpen(false); setInviteName(''); setInviteEmail(''); setInviteRole(UserRole.ProductOwner); setInvitePod(''); setErrors({}); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <UserPlus className="h-5 w-5" />
              Invitar nuevo miembro
            </DialogTitle>
            <DialogDescription>
              El usuario recibira un email para establecer su contrasena.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-normal">Nombre</Label>
              <Input placeholder="Nombre completo" value={inviteName} onChange={(e) => { setInviteName(e.target.value); setErrors((prev) => ({ ...prev, name: '' })); }} className={errors.name ? 'border-destructive' : ''} />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-normal">Email</Label>
              <Input type="email" placeholder="email@cenzontle.com" value={inviteEmail} onChange={(e) => { setInviteEmail(e.target.value); setErrors((prev) => ({ ...prev, email: '' })); }} className={errors.email ? 'border-destructive' : ''} />
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-normal">Rol</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(USER_ROLE_LABELS)
                      .filter(([value]) => value !== UserRole.Viewer)
                      .map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <div className="flex items-center gap-2">{ROLE_ICONS[value as UserRole]}{label}</div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-normal">Célula</Label>
                <Select value={invitePod} onValueChange={setInvitePod}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar célula" /></SelectTrigger>
                  <SelectContent>
                    {pods.map((pod) => (
                      <SelectItem key={pod.id} value={pod.id}>
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pod.color }} />
                          {pod.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="border-t mt-2 pt-4">
            <DialogFooter className="gap-3">
              <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={saving}>
                Cancelar
              </Button>
            <Button
              disabled={!inviteEmail || !inviteName || saving}
              onClick={async () => {
                const ok = await handleInvite();
                if (ok) setInviteOpen(false);
              }}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {saving ? 'Invitando...' : 'Invitar'}
            </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmacion de eliminacion */}
      <Dialog open={!!deletingMember} onOpenChange={(open) => !open && setDeletingMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar {deletingMember?.id === 'bulk' ? 'usuarios' : 'usuario'}</DialogTitle>
            <DialogDescription>
              {deletingMember?.id === 'bulk'
                ? `Esta accion eliminara permanentemente ${selectedIds.size} usuario(s) del sistema. No se puede deshacer.`
                : <>Esta accion eliminara permanentemente a <strong>{deletingMember?.name}</strong> ({deletingMember?.email}) del sistema. No se puede deshacer.</>
              }
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
                  if (deletingMember.id === 'bulk') {
                    await handleBulkDelete();
                  } else {
                    await handleRemove(deletingMember.id);
                  }
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
    </div>
  );
}
