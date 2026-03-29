'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Shield,
  RotateCcw,
  Save,
  Check,
  Loader2,
  Crown,
  Users,
  Code,
  Bug,
  Eye,
  Info,
} from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import {
  UserRole,
  Permission,
  USER_ROLE_LABELS,
  USER_ROLE_COLORS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  DEFAULT_ROLE_PERMISSIONS,
} from '@cenzontle/shared';

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  [UserRole.AltaGerencia]: <Crown className="h-3.5 w-3.5" />,
  [UserRole.ProductOwner]: <Users className="h-3.5 w-3.5" />,
  [UserRole.TechLead]: <Code className="h-3.5 w-3.5" />,
  [UserRole.QA]: <Bug className="h-3.5 w-3.5" />,
  [UserRole.Viewer]: <Eye className="h-3.5 w-3.5" />,
};

const ALL_ROLES = Object.values(UserRole);

export function RolesPermissionsSection() {
  const { rolePermissions, members, dispatch, hasPermission } = useAuthContext();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canManage = hasPermission(Permission.MANAGE_USERS);

  const hasChanges = useMemo(() => {
    return ALL_ROLES.some((role) => {
      const current = [...rolePermissions[role]].sort();
      const defaults = [...DEFAULT_ROLE_PERMISSIONS[role]].sort();
      if (current.length !== defaults.length) return true;
      return current.some((p, i) => p !== defaults[i]);
    });
  }, [rolePermissions]);

  const memberCountByRole = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const role of ALL_ROLES) {
      counts[role] = members.filter((m) => m.role === role).length;
    }
    return counts;
  }, [members]);

  const togglePermission = (role: UserRole, permission: Permission) => {
    if (!canManage) return;
    const current = rolePermissions[role];
    const has = current.includes(permission);
    const next = has
      ? current.filter((p) => p !== permission)
      : [...current, permission];
    dispatch({ type: 'SET_ROLE_PERMISSIONS', payload: { role, permissions: next } });
    setSaved(false);
  };

  const toggleCategoryForRole = (role: UserRole, permissions: Permission[]) => {
    if (!canManage) return;
    const current = rolePermissions[role];
    const allEnabled = permissions.every((p) => current.includes(p));
    let next: Permission[];
    if (allEnabled) {
      next = current.filter((p) => !permissions.includes(p));
    } else {
      const toAdd = permissions.filter((p) => !current.includes(p));
      next = [...current, ...toAdd];
    }
    dispatch({ type: 'SET_ROLE_PERMISSIONS', payload: { role, permissions: next } });
    setSaved(false);
  };

  const handleReset = () => {
    dispatch({ type: 'RESET_ROLE_PERMISSIONS' });
    setSaved(false);
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
    }, 800);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Roles y Permisos
        </h1>
        <p className="text-sm text-muted-foreground">
          Configura qué acciones puede realizar cada rol dentro de la plataforma.
        </p>
      </div>

      {/* Actions bar */}
      {canManage && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                Cambios sin guardar
              </Badge>
            )}
            {saved && !hasChanges && (
              <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20">
                <Check className="h-3 w-3 mr-1" />
                Guardado
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!hasChanges}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar defaults
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Guardar cambios
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {!canManage && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed bg-muted/30">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Solo los usuarios con rol Alta Gerencia pueden modificar los permisos de roles.
          </span>
        </div>
      )}

      {/* Permission matrix */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            {/* Role headers */}
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 min-w-[200px] sticky left-0 bg-muted/30 z-10">
                  Permiso
                </th>
                {ALL_ROLES.map((role) => (
                  <th key={role} className="text-center px-3 py-3 min-w-[120px]">
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className="p-1.5 rounded-lg"
                        style={{ backgroundColor: USER_ROLE_COLORS[role] + '15' }}
                      >
                        <div style={{ color: USER_ROLE_COLORS[role] }}>
                          {ROLE_ICONS[role]}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-foreground">
                        {USER_ROLE_LABELS[role]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {memberCountByRole[role]} {memberCountByRole[role] === 1 ? 'miembro' : 'miembros'}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {PERMISSION_CATEGORIES.map((category) => (
                <CategoryBlock
                  key={category.label}
                  category={category.label}
                  permissions={category.permissions}
                  roles={ALL_ROLES}
                  rolePermissions={rolePermissions}
                  canManage={canManage}
                  onToggle={togglePermission}
                  onToggleCategory={toggleCategoryForRole}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary per role */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {ALL_ROLES.map((role) => {
          const total = Object.values(Permission).length;
          const enabled = rolePermissions[role].length;
          const pct = Math.round((enabled / total) * 100);
          return (
            <div
              key={role}
              className="p-3 rounded-lg border bg-card"
              style={{ borderLeftWidth: 3, borderLeftColor: USER_ROLE_COLORS[role] }}
            >
              <div className="text-xs font-medium text-foreground">{USER_ROLE_LABELS[role]}</div>
              <div className="text-lg font-semibold mt-1" style={{ color: USER_ROLE_COLORS[role] }}>
                {enabled}/{total}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: USER_ROLE_COLORS[role],
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{pct}% de permisos</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category block (group header + permission rows)
// ---------------------------------------------------------------------------

function CategoryBlock({
  category,
  permissions,
  roles,
  rolePermissions,
  canManage,
  onToggle,
  onToggleCategory,
}: {
  category: string;
  permissions: Permission[];
  roles: UserRole[];
  rolePermissions: Record<UserRole, Permission[]>;
  canManage: boolean;
  onToggle: (role: UserRole, permission: Permission) => void;
  onToggleCategory: (role: UserRole, permissions: Permission[]) => void;
}) {
  return (
    <>
      {/* Category header row */}
      <tr className="border-t border-border bg-muted/20">
        <td className="px-4 py-2 sticky left-0 bg-muted/20 z-10">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {category}
          </span>
        </td>
        {roles.map((role) => {
          const allEnabled = permissions.every((p) => rolePermissions[role].includes(p));
          const someEnabled = permissions.some((p) => rolePermissions[role].includes(p));
          return (
            <td key={role} className="text-center px-3 py-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={allEnabled ? true : someEnabled ? 'indeterminate' : false}
                        onCheckedChange={() => onToggleCategory(role, permissions)}
                        disabled={!canManage}
                        className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {allEnabled ? 'Desactivar' : 'Activar'} todo {category.toLowerCase()} para {USER_ROLE_LABELS[role]}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </td>
          );
        })}
      </tr>

      {/* Individual permission rows */}
      {permissions.map((permission) => (
        <tr key={permission} className="border-t border-border/50 hover:bg-muted/10 transition-colors">
          <td className="px-4 py-2.5 pl-8 sticky left-0 bg-card z-10">
            <span className="text-xs text-foreground">{PERMISSION_LABELS[permission]}</span>
          </td>
          {roles.map((role) => {
            const isEnabled = rolePermissions[role].includes(permission);
            return (
              <td key={role} className="text-center px-3 py-2.5">
                <div className="flex justify-center">
                  <Checkbox
                    checked={isEnabled}
                    onCheckedChange={() => onToggle(role, permission)}
                    disabled={!canManage}
                    className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                  />
                </div>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
