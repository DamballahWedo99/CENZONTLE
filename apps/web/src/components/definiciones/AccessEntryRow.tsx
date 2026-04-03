'use client';

import React from 'react';
import { Trash2, Users, User } from 'lucide-react';
import {
  AccessLevel,
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_COLORS,
  ACCESS_LEVEL_HIERARCHY,
  UserRole,
  USER_ROLE_LABELS,
  USER_ROLE_COLORS,
} from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AccessEntryRowProps {
  principalType: 'user' | 'role';
  principalId: string;
  principalName: string;
  accessLevel: AccessLevel;
  inherited: boolean;
  inheritedFromName?: string;
  maxLevel?: AccessLevel;
  onChangeLevel: (level: AccessLevel) => void;
  onRemove: () => void;
}

const LEVELS: AccessLevel[] = ['owner', 'editor', 'viewer', 'none'];

export function AccessEntryRow({
  principalType,
  principalId,
  principalName,
  accessLevel,
  inherited,
  inheritedFromName,
  maxLevel = 'owner',
  onChangeLevel,
  onRemove,
}: AccessEntryRowProps) {
  const isRole = principalType === 'role';
  const roleColor = isRole ? USER_ROLE_COLORS[principalId as UserRole] ?? '#6b7280' : undefined;
  const maxHierarchy = ACCESS_LEVEL_HIERARCHY[maxLevel];

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 group transition-colors">
      {/* Avatar / Icon */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
        style={{
          backgroundColor: isRole ? `${roleColor}20` : '#3b82f620',
          color: isRole ? roleColor : '#3b82f6',
        }}
      >
        {isRole ? <Users className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
      </div>

      {/* Name + badge */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {isRole ? USER_ROLE_LABELS[principalId as UserRole] ?? principalId : principalName}
        </div>
        {inherited && inheritedFromName && (
          <div className="text-xs text-muted-foreground truncate">
            Heredado de {inheritedFromName}
          </div>
        )}
      </div>

      {/* Level select */}
      <Select
        value={accessLevel}
        onValueChange={v => onChangeLevel(v as AccessLevel)}
        disabled={inherited}
      >
        <SelectTrigger
          size="sm"
          className="w-[120px] h-7 text-xs"
          style={{ color: ACCESS_LEVEL_COLORS[accessLevel] }}
        >
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

      {/* Remove button */}
      {!inherited && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
