'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Folder, FileText, Link2, Eye, UserPlus, X, Check,
  Crown, Pencil, BookOpen, Ban, Search,
} from 'lucide-react';
import { useDefiniciones, getEffectiveAccess } from '@/context/DefinicionesContext';
import { useAuthContext } from '@/context/AuthContext';
import { DefinicionNode } from '@/types/definiciones';
import {
  AccessLevel,
  AccessControlEntry,
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_COLORS,
  ACCESS_LEVEL_HIERARCHY,
  UserRole,
  USER_ROLE_LABELS,
  USER_ROLE_COLORS,
  TeamMember,
} from '@cenzontle/shared';
import { Button } from '@/components/ui/button';

interface AccessPanelProps {
  node: DefinicionNode;
  parentNode: DefinicionNode | null;
}

const LEVELS: AccessLevel[] = ['owner', 'editor', 'viewer', 'none'];

const LEVEL_ICONS: Record<AccessLevel, React.ElementType> = {
  owner: Crown,
  editor: Pencil,
  viewer: BookOpen,
  none: Ban,
};

export function AccessPanel({ node, parentNode }: AccessPanelProps) {
  const {
    state,
    accessConfig,
    getEffectiveAccessForNode,
    setInheritance,
    addAccess,
    updateAccess,
    removeAccess,
  } = useDefiniciones();
  const { currentUser, members } = useAuthContext();
  const [showPreview, setShowPreview] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const userSearchRef = useRef<HTMLInputElement>(null);

  const config = accessConfig[node.id];
  const inheritFromParent = config?.inheritFromParent ?? true;
  const directEntries = config?.entries ?? [];
  const isRoot = !parentNode;

  const roleEntries = directEntries.filter(e => e.principalType === 'role');
  const userEntries = directEntries.filter(e => e.principalType === 'user');
  const existingUserIds = userEntries.map(e => e.principalId);

  const parentMaxLevel: AccessLevel = isRoot ? 'owner' : (
    currentUser
      ? getEffectiveAccess(currentUser.id, currentUser.role, parentNode.id, state.tree, state.accessConfig).level
      : 'none'
  );
  const maxHierarchy = ACCESS_LEVEL_HIERARCHY[parentMaxLevel];

  const effectiveCurrent = getEffectiveAccessForNode(node.id);

  const effectivePreview = useMemo(() => {
    if (!showPreview) return [];
    return members
      .filter(m => m.status === 'active')
      .map(m => ({
        member: m,
        ...getEffectiveAccess(m.id, m.role, node.id, state.tree, state.accessConfig),
      }))
      .sort((a, b) => ACCESS_LEVEL_HIERARCHY[b.level] - ACCESS_LEVEL_HIERARCHY[a.level]);
  }, [showPreview, members, node.id, state.tree, state.accessConfig]);

  const availableUsers = useMemo(() => {
    const base = members.filter(
      m => m.status === 'active' && !existingUserIds.includes(m.id) && m.id !== currentUser?.id,
    );
    if (!userSearch.trim()) return base;
    const q = userSearch.toLowerCase();
    return base.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [members, existingUserIds, currentUser?.id, userSearch]);

  // === Handlers ===

  function getRoleLevel(role: UserRole): AccessLevel {
    const entry = roleEntries.find(e => e.principalId === role);
    return entry?.accessLevel ?? 'viewer';
  }

  function getUserLevel(userId: string): AccessLevel | null {
    const entry = userEntries.find(e => e.principalId === userId);
    return entry?.accessLevel ?? null;
  }

  function handleRoleChange(role: UserRole, level: AccessLevel) {
    if (!currentUser) return;
    const existing = roleEntries.find(e => e.principalId === role);
    if (existing) {
      updateAccess(existing.id, node.id, level);
    } else {
      addAccess({
        id: `ace-${crypto.randomUUID()}`,
        nodeId: node.id,
        principalType: 'role',
        principalId: role,
        accessLevel: level,
        inherited: false,
        grantedBy: currentUser.id,
        grantedAt: new Date().toISOString(),
      });
    }
  }

  function handleUserChange(userId: string, level: AccessLevel) {
    if (!currentUser) return;
    const existing = userEntries.find(e => e.principalId === userId);
    if (existing) {
      updateAccess(existing.id, node.id, level);
    } else {
      addAccess({
        id: `ace-${crypto.randomUUID()}`,
        nodeId: node.id,
        principalType: 'user',
        principalId: userId,
        accessLevel: level,
        inherited: false,
        grantedBy: currentUser.id,
        grantedAt: new Date().toISOString(),
      });
    }
  }

  function handleRemoveUser(userId: string) {
    const entry = userEntries.find(e => e.principalId === userId);
    if (entry) removeAccess(entry.id, node.id);
  }

  function handleAddUser(userId: string) {
    if (!userId || !currentUser) return;
    handleUserChange(userId, 'viewer');
    setUserSearch('');
    setAddingUser(false);
  }

  function getMemberName(userId: string): string {
    return members.find(m => m.id === userId)?.name ?? userId;
  }

  function getSourceNodeName(sourceNodeId?: string): string | undefined {
    if (!sourceNodeId) return undefined;
    return findNodeInTree(state.tree, sourceNodeId)?.name;
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-muted/50 border border-border/50">
          {node.type === 'folder'
            ? <Folder className="h-4 w-4 text-muted-foreground" />
            : <FileText className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{node.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
              style={{
                backgroundColor: `${ACCESS_LEVEL_COLORS[effectiveCurrent.level]}10`,
                borderColor: `${ACCESS_LEVEL_COLORS[effectiveCurrent.level]}30`,
                color: ACCESS_LEVEL_COLORS[effectiveCurrent.level],
              }}
            >
              {ACCESS_LEVEL_LABELS[effectiveCurrent.level]}
            </span>
            {effectiveCurrent.source === 'inherited' && effectiveCurrent.sourceNodeId && (
              <span className="text-[11px] text-muted-foreground">
                via {getSourceNodeName(effectiveCurrent.sourceNodeId) ?? 'padre'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Inheritance toggle */}
      {!isRoot && (
        <div className="rounded-xl border border-border/70 p-3.5 bg-muted/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Herencia del padre</span>
            </div>
            <button
              onClick={() => setInheritance(node.id, !inheritFromParent)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${inheritFromParent ? 'bg-primary' : 'bg-muted-foreground/30'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${inheritFromParent ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {inheritFromParent && parentNode && (
            <p className="text-xs text-muted-foreground mt-2 ml-6">
              Heredando de &ldquo;{parentNode.name}&rdquo;
            </p>
          )}
        </div>
      )}

      {/* === PERMISSION MATRIX === */}
      <div className="space-y-2">
        <div className="rounded-xl border border-border/70 overflow-hidden bg-card">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_repeat(4,56px)] border-b border-border/50 bg-muted/30">
            <div className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-end">
              Matriz de Permisos
            </div>
            {LEVELS.map(level => {
              const Icon = LEVEL_ICONS[level];
              return (
                <div key={level} className="flex flex-col items-center justify-center py-2.5 gap-1">
                  <Icon className="h-3 w-3" style={{ color: ACCESS_LEVEL_COLORS[level] }} />
                  <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: ACCESS_LEVEL_COLORS[level] }}>
                    {level === 'owner' ? 'Dueño' : level === 'editor' ? 'Editor' : level === 'viewer' ? 'Lector' : 'Ninguno'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Role rows */}
          <div className="divide-y divide-border/30">
            {Object.values(UserRole).filter(r => r !== UserRole.AltaGerencia).map(role => {
              const currentLevel = getRoleLevel(role);
              const roleColor = USER_ROLE_COLORS[role];
              return (
                <div key={role} className="grid grid-cols-[1fr_repeat(4,56px)] items-center hover:bg-muted/20 transition-colors">
                  <div className="px-3 py-2 flex items-center gap-2.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: roleColor }}
                    />
                    <span className="text-xs font-medium truncate">{USER_ROLE_LABELS[role]}</span>
                  </div>
                  {LEVELS.map(level => {
                    const isSelected = currentLevel === level;
                    const isDisabled = ACCESS_LEVEL_HIERARCHY[level] > maxHierarchy;
                    const color = ACCESS_LEVEL_COLORS[level];
                    return (
                      <div key={level} className="flex items-center justify-center py-2">
                        <button
                          disabled={isDisabled}
                          onClick={() => handleRoleChange(role, level)}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                            ${isDisabled ? 'opacity-20 cursor-not-allowed border-border' : 'cursor-pointer hover:scale-110'}
                            ${isSelected ? 'border-transparent shadow-sm' : 'border-border/50 hover:border-current'}
                          `}
                          style={isSelected ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
                        >
                          {isSelected && <Check className="h-3 w-3" style={{ color }} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* User overrides section */}
          {(userEntries.length > 0 || addingUser) && (
            <>
              <div className="border-t border-border/50 bg-muted/20 px-3 py-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Overrides de usuario
                </span>
              </div>
              <div className="divide-y divide-border/30">
                {userEntries.map(entry => {
                  const member = members.find(m => m.id === entry.principalId);
                  const initials = member?.name.split(' ').map(w => w[0]).join('').slice(0, 2) ?? '??';
                  return (
                    <div key={entry.id} className="grid grid-cols-[1fr_repeat(4,56px)] items-center group hover:bg-muted/20 transition-colors">
                      <div className="px-3 py-2 flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
                          {initials}
                        </span>
                        <span className="text-xs font-medium truncate flex-1">{member?.name ?? entry.principalId}</span>
                        <button
                          onClick={() => handleRemoveUser(entry.principalId)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {LEVELS.map(level => {
                        const isSelected = entry.accessLevel === level;
                        const isDisabled = ACCESS_LEVEL_HIERARCHY[level] > maxHierarchy;
                        const color = ACCESS_LEVEL_COLORS[level];
                        return (
                          <div key={level} className="flex items-center justify-center py-2">
                            <button
                              disabled={isDisabled}
                              onClick={() => handleUserChange(entry.principalId, level)}
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                                ${isDisabled ? 'opacity-20 cursor-not-allowed border-border' : 'cursor-pointer hover:scale-110'}
                                ${isSelected ? 'border-transparent shadow-sm' : 'border-border/50 hover:border-current'}
                              `}
                              style={isSelected ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
                            >
                              {isSelected && <Check className="h-3 w-3" style={{ color }} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Add user row */}
          <div className="border-t border-border/50">
            {addingUser ? (
              <div className="px-1 py-1.5">
                <div className="flex items-center gap-1.5 px-2 pb-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      ref={userSearchRef}
                      type="text"
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      placeholder="Buscar usuario..."
                      className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-border bg-background outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                      autoFocus
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => { setAddingUser(false); setUserSearch(''); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="max-h-36 overflow-y-auto">
                  {availableUsers.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground px-3 py-2">Sin resultados</p>
                  ) : (
                    availableUsers.map(user => {
                      const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2);
                      return (
                        <button
                          key={user.id}
                          onClick={() => handleAddUser(user.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/40 transition-colors rounded-sm"
                        >
                          <span className="w-5 h-5 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
                            {initials}
                          </span>
                          <span className="truncate">{user.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{USER_ROLE_LABELS[user.role]}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingUser(true)}
                className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center gap-2"
              >
                <UserPlus className="h-3 w-3" /> Agregar usuario...
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Effective access preview */}
      <div className="space-y-2">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          {showPreview ? 'Ocultar' : 'Ver'} acceso efectivo
        </button>
        {showPreview && (
          <div className="rounded-xl border border-border/70 overflow-hidden bg-card">
            <div className="grid grid-cols-[1fr_80px_70px] bg-muted/30 border-b border-border/50 px-3 py-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Usuario</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Nivel</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Fuente</span>
            </div>
            <div className="divide-y divide-border/30">
              {effectivePreview.map(({ member, level, source }) => (
                <div key={member.id} className="grid grid-cols-[1fr_80px_70px] items-center px-3 py-2 hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
                      {member.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs truncate block">{member.name}</span>
                      <span className="text-[10px] text-muted-foreground">{USER_ROLE_LABELS[member.role]}</span>
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-medium px-1.5 py-0.5 rounded-full border w-fit"
                    style={{
                      backgroundColor: `${ACCESS_LEVEL_COLORS[level]}10`,
                      borderColor: `${ACCESS_LEVEL_COLORS[level]}30`,
                      color: ACCESS_LEVEL_COLORS[level],
                    }}
                  >
                    {ACCESS_LEVEL_LABELS[level]}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-right">
                    {source === 'direct' ? 'directo' : source === 'role' ? 'por rol' : 'heredado'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function findNodeInTree(nodes: DefinicionNode[], id: string): DefinicionNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
