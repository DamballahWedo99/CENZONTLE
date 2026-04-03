'use client';

import React, { useState } from 'react';
import { UserPlus, Users, User, X } from 'lucide-react';
import {
  AccessLevel,
  AccessControlEntry,
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_COLORS,
  ACCESS_LEVEL_HIERARCHY,
  UserRole,
  USER_ROLE_LABELS,
  TeamMember,
} from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AddAccessPanelProps {
  nodeId: string;
  nodeName: string;
  maxLevel: AccessLevel;
  existingRoles: string[];
  existingUsers: string[];
  members: TeamMember[];
  currentUserId: string;
  onAdd: (entry: AccessControlEntry) => void;
  onClose: () => void;
}

const LEVELS: AccessLevel[] = ['owner', 'editor', 'viewer', 'none'];

export function AddAccessPanel({
  nodeId,
  nodeName,
  maxLevel,
  existingRoles,
  existingUsers,
  members,
  currentUserId,
  onAdd,
  onClose,
}: AddAccessPanelProps) {
  const [principalType, setPrincipalType] = useState<'role' | 'user'>('role');
  const [selectedPrincipal, setSelectedPrincipal] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<AccessLevel>('viewer');

  const maxHierarchy = ACCESS_LEVEL_HIERARCHY[maxLevel];
  const allRoles = Object.values(UserRole);
  const availableRoles = allRoles.filter(r => !existingRoles.includes(r));
  const availableUsers = members.filter(
    m => m.status === 'active' && !existingUsers.includes(m.id) && m.id !== currentUserId,
  );

  function handleSubmit() {
    if (!selectedPrincipal) return;
    if (ACCESS_LEVEL_HIERARCHY[selectedLevel] > maxHierarchy) return;

    const entry: AccessControlEntry = {
      id: `ace-${crypto.randomUUID()}`,
      nodeId,
      principalType,
      principalId: selectedPrincipal,
      accessLevel: selectedLevel,
      inherited: false,
      grantedBy: currentUserId,
      grantedAt: new Date().toISOString(),
    };
    onAdd(entry);
    setSelectedPrincipal('');
    setSelectedLevel('viewer');
    onClose();
  }

  function handleTypeChange(type: 'role' | 'user') {
    setPrincipalType(type);
    setSelectedPrincipal('');
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium flex items-center gap-1.5">
          <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
          Agregar acceso
        </h4>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Type toggle */}
      <div className="flex gap-1.5">
        <Button
          variant={principalType === 'role' ? 'secondary' : 'ghost'}
          size="sm"
          className="flex-1 gap-1.5 h-7 text-xs"
          onClick={() => handleTypeChange('role')}
        >
          <Users className="h-3 w-3" /> Rol
        </Button>
        <Button
          variant={principalType === 'user' ? 'secondary' : 'ghost'}
          size="sm"
          className="flex-1 gap-1.5 h-7 text-xs"
          onClick={() => handleTypeChange('user')}
        >
          <User className="h-3 w-3" /> Usuario
        </Button>
      </div>

      {/* Principal + Level selects */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={selectedPrincipal} onValueChange={setSelectedPrincipal}>
            <SelectTrigger size="sm" className="w-full h-8 text-xs">
              <SelectValue placeholder={principalType === 'role' ? 'Seleccionar rol...' : 'Seleccionar usuario...'} />
            </SelectTrigger>
            <SelectContent position="popper">
              {principalType === 'role'
                ? availableRoles.map(role => (
                    <SelectItem key={role} value={role}>
                      {USER_ROLE_LABELS[role]}
                    </SelectItem>
                  ))
                : availableUsers.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[110px]">
          <Select value={selectedLevel} onValueChange={v => setSelectedLevel(v as AccessLevel)}>
            <SelectTrigger size="sm" className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {LEVELS.map(level => (
                <SelectItem
                  key={level}
                  value={level}
                  disabled={ACCESS_LEVEL_HIERARCHY[level] > maxHierarchy}
                >
                  <span style={{ color: ACCESS_LEVEL_COLORS[level] }}>
                    {ACCESS_LEVEL_LABELS[level]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {principalType === 'role' && availableRoles.length === 0 && (
        <p className="text-xs text-muted-foreground">Todos los roles ya configurados.</p>
      )}
      {principalType === 'user' && availableUsers.length === 0 && (
        <p className="text-xs text-muted-foreground">Todos los usuarios ya configurados.</p>
      )}

      {/* Submit */}
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        disabled={!selectedPrincipal || ACCESS_LEVEL_HIERARCHY[selectedLevel] > maxHierarchy}
        onClick={handleSubmit}
      >
        Agregar
      </Button>
    </div>
  );
}
