'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { ComputeNode } from '@/types/factory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Server,
  Plus,
  Cpu,
  Monitor,
  Cloud,
  Laptop,
  Trash2,
  Wifi,
  WifiOff,
  Clock,
  HardDrive,
  MapPin,
  X,
  Check,
  Copy,
} from 'lucide-react';

const typeConfig: Record<ComputeNode['type'], { label: string; icon: typeof Laptop; color: string }> = {
  local: { label: 'Local Machine', icon: Laptop, color: '#3B82F6' },
  'mac-mini': { label: 'Mac Mini', icon: Cpu, color: '#22C55E' },
  'cloud-vm': { label: 'Cloud VM', icon: Cloud, color: '#A855F7' },
  'gpu-instance': { label: 'GPU Instance', icon: HardDrive, color: '#F59E0B' },
  other: { label: 'Other', icon: Server, color: '#6B7280' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NodeCard({ node, onRemove }: { node: ComputeNode; onRemove: (id: string) => void }) {
  const cfg = typeConfig[node.type];
  const Icon = cfg.icon;
  const isOnline = node.status === 'online';
  const StatusIcon = isOnline ? Wifi : WifiOff;

  return (
    <div className={cn(
      'rounded-xl border bg-[#141419] p-5 transition-all',
      isOnline ? 'border-[#2A2A35]' : 'border-red-500/20 opacity-60',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${cfg.color}15` }}
          >
            <Icon className="h-5 w-5" style={{ color: cfg.color }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[#EDEDF0]">{node.name}</h3>
              {node.type === 'local' && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                  THIS MACHINE
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#5A5A6E]">{cfg.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={cn(
            'flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full',
            isOnline ? 'bg-[#22C55E]/10 text-[#22C55E]' : 'bg-red-500/10 text-red-400',
          )}>
            <StatusIcon className="h-3 w-3" />
            {node.status}
          </span>
          {node.type !== 'local' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-[#5A5A6E] hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onRemove(node.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Monitor className="h-3.5 w-3.5 text-[#5A5A6E]" />
          <span className="text-[#8B8B9A] truncate">{node.os}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-[#5A5A6E]" />
          <span className="text-[#8B8B9A]">{node.location}</span>
        </div>
        <div className="flex items-center gap-2">
          <Wifi className="h-3.5 w-3.5 text-[#5A5A6E]" />
          <span className="text-[#8B8B9A] font-mono">{node.ip}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-[#5A5A6E]" />
          <span className="text-[#8B8B9A]">Heartbeat {timeAgo(node.lastHeartbeat)}</span>
        </div>
      </div>

      {/* Capacity */}
      <div className="mt-4 pt-3 border-t border-[#2A2A35]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#5A5A6E]">Agent Slots</span>
          <span className="text-[10px] font-mono text-[#8B8B9A]">
            {node.agents.length}/{node.totalSlots} used
          </span>
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: node.totalSlots }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-2.5 flex-1 rounded-sm transition-colors',
                i < node.agents.length ? 'bg-[#3B82F6]' : 'bg-[#2A2A35]',
              )}
            />
          ))}
        </div>
      </div>

      {/* Added date */}
      <div className="mt-3 text-[10px] text-[#3A3A45]">
        Added {new Date(node.addedAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function AddNodeForm({ onAdd, onCancel }: { onAdd: (node: ComputeNode) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ComputeNode['type']>('mac-mini');
  const [ip, setIp] = useState('');
  const [location, setLocation] = useState('');
  const [slots, setSlots] = useState('6');
  const [copied, setCopied] = useState(false);

  const workerCommand = `npx factory-worker --dashboard ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'} --name "${name || 'New Node'}"`;

  const handleCopy = () => {
    navigator.clipboard.writeText(workerCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const node: ComputeNode = {
      id: `node-${Date.now()}`,
      name: name.trim(),
      type,
      os: type === 'mac-mini' ? 'macOS (Apple Silicon)' : type === 'cloud-vm' ? 'Linux (x86_64)' : 'Unknown',
      location: location.trim() || 'Remote',
      ip: ip.trim() || 'pending...',
      status: 'offline',
      totalSlots: parseInt(slots) || 6,
      agents: [],
      addedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };
    onAdd(node);
  };

  return (
    <div className="rounded-xl border border-[#3B82F6]/30 bg-[#141419] p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-[#EDEDF0]">Add Compute Node</h3>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[#5A5A6E]" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[10px] text-[#8B8B9A] uppercase tracking-wider mb-1.5 block">Name</label>
          <Input
            placeholder="e.g., Mac Mini Office"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-[#0A0A0F] border-[#2A2A35] text-[#EDEDF0] text-sm h-9"
          />
        </div>
        <div>
          <label className="text-[10px] text-[#8B8B9A] uppercase tracking-wider mb-1.5 block">Type</label>
          <Select value={type} onValueChange={(v) => setType(v as ComputeNode['type'])}>
            <SelectTrigger className="bg-[#0A0A0F] border-[#2A2A35] text-[#EDEDF0] text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mac-mini">Mac Mini</SelectItem>
              <SelectItem value="cloud-vm">Cloud VM</SelectItem>
              <SelectItem value="gpu-instance">GPU Instance</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] text-[#8B8B9A] uppercase tracking-wider mb-1.5 block">IP / Hostname</label>
          <Input
            placeholder="e.g., 100.64.0.5 or mac-mini-1.local"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="bg-[#0A0A0F] border-[#2A2A35] text-[#EDEDF0] text-sm h-9"
          />
        </div>
        <div>
          <label className="text-[10px] text-[#8B8B9A] uppercase tracking-wider mb-1.5 block">Location</label>
          <Input
            placeholder="e.g., Office, Home, AWS"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="bg-[#0A0A0F] border-[#2A2A35] text-[#EDEDF0] text-sm h-9"
          />
        </div>
        <div>
          <label className="text-[10px] text-[#8B8B9A] uppercase tracking-wider mb-1.5 block">Max Agent Slots</label>
          <Input
            type="number"
            min="1"
            max="20"
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            className="bg-[#0A0A0F] border-[#2A2A35] text-[#EDEDF0] text-sm h-9"
          />
        </div>
      </div>

      {/* Worker install command */}
      <div className="mt-5 pt-4 border-t border-[#2A2A35]">
        <p className="text-[10px] text-[#8B8B9A] uppercase tracking-wider mb-2">
          Run this on the target machine to connect it:
        </p>
        <div className="flex items-center gap-2 bg-[#0A0A0F] rounded-lg px-3 py-2 border border-[#2A2A35]">
          <code className="text-xs text-green-400 font-mono flex-1 truncate">{workerCommand}</code>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 shrink-0 text-[#5A5A6E] hover:text-[#EDEDF0]"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-[10px] text-[#3A3A45] mt-2">
          The node will appear as &quot;offline&quot; until the worker agent connects.
        </p>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-[#8B8B9A]">
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!name.trim()} className="bg-[#3B82F6] hover:bg-[#3B82F6]/80 text-white">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Node
        </Button>
      </div>
    </div>
  );
}

export function ComputeNodes() {
  const { state } = useFactory();
  const [showForm, setShowForm] = useState(false);
  const [nodes, setNodes] = useState<ComputeNode[]>(state.factory.resourcePool?.nodes ?? []);

  const handleAdd = (node: ComputeNode) => {
    setNodes((prev) => [...prev, node]);
    setShowForm(false);
  };

  const handleRemove = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  };

  const totalSlots = nodes.reduce((s, n) => s + n.totalSlots, 0);
  const usedSlots = nodes.reduce((s, n) => s + n.agents.length, 0);
  const onlineCount = nodes.filter((n) => n.status === 'online').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
            <Server className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-[#EDEDF0] font-semibold text-base">Compute Nodes</h2>
            <p className="text-[#8B8B9A] text-xs">
              {nodes.length} node{nodes.length !== 1 ? 's' : ''} registered · {onlineCount} online · {totalSlots} total slots
            </p>
          </div>
        </div>

        {!showForm && (
          <Button
            onClick={() => setShowForm(true)}
            className="bg-[#3B82F6] hover:bg-[#3B82F6]/80 text-white gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Node
          </Button>
        )}
      </div>

      {/* Capacity summary */}
      <div className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[#8B8B9A]">Total Factory Capacity</span>
          <span className="text-xs font-mono text-[#5A5A6E]">{usedSlots}/{totalSlots} slots active</span>
        </div>
        <div className="h-3 rounded-full bg-[#2A2A35] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              usedSlots / totalSlots < 0.5 ? 'bg-[#3B82F6]' : usedSlots / totalSlots < 0.8 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]',
            )}
            style={{ width: totalSlots > 0 ? `${(usedSlots / totalSlots) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <AddNodeForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {/* Node cards */}
      {nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A35] bg-[#141419] p-12 text-center">
          <Server className="h-10 w-10 text-[#3A3A45] mx-auto mb-3" />
          <p className="text-sm text-[#8B8B9A] mb-1">No compute nodes registered</p>
          <p className="text-xs text-[#5A5A6E] mb-4">Add your local machine to get started</p>
          <Button onClick={() => setShowForm(true)} className="bg-[#3B82F6] hover:bg-[#3B82F6]/80 text-white gap-2">
            <Plus className="h-4 w-4" />
            Add Your Machine
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}
