'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  GitHubConfig,
  BranchStrategy,
  LinearConfig,
  JiraConfig,
  ComputeNode,
  ConnectionStatus,
} from '@cenzontle/shared';
import {
  DEFAULT_BRANCH_STRATEGY,
  DEFAULT_FACTORY_CONFIG,
} from '@cenzontle/shared';
import {
  Github,
  GitBranch,
  BarChart3,
  TicketCheck,
  Server,
  Bot,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Loader2,
  Check,
  Wifi,
  WifiOff,
  Settings,
  ArrowLeft,
  Copy,
  Terminal,
  Users,
  BookMarked,
  ClipboardCheck,
  GripVertical,
  Save,
  Shield,
} from 'lucide-react';
import { TeamSection } from './TeamSection';
import { RolesPermissionsSection } from './RolesPermissionsSection';
import { useDefiniciones, DefinicionesProvider } from '@/context/DefinicionesContext';
import type { VaultConfig } from '@cenzontle/shared';
import { mockPods } from '@/data/mock/proyectos/pods';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsSection = 'repository' | 'branches' | 'linear' | 'jira' | 'obsidian' | 'nodes' | 'agents' | 'dod' | 'team' | 'roles';

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: typeof Github;
  group: string;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'repository', label: 'Repositorio', icon: Github, group: 'Control de código' },
  { id: 'branches', label: 'Estrategia de ramas', icon: GitBranch, group: 'Control de código' },
  { id: 'linear', label: 'Linear', icon: BarChart3, group: 'Integraciones' },
  { id: 'jira', label: 'Jira', icon: TicketCheck, group: 'Integraciones' },
  { id: 'obsidian', label: 'Obsidian Vault', icon: BookMarked, group: 'Integraciones' },
  { id: 'nodes', label: 'Nodos de cómputo', icon: Server, group: 'Infraestructura' },
  { id: 'agents', label: 'Agentes', icon: Bot, group: 'Automatización' },
  { id: 'dod', label: 'Definition of Done', icon: ClipboardCheck, group: 'Automatización' },
  { id: 'team', label: 'Equipo', icon: Users, group: 'Equipo' },
  { id: 'roles', label: 'Roles y permisos', icon: Shield, group: 'Equipo' },
];

const SIDEBAR_GROUPS = ['Control de código', 'Integraciones', 'Infraestructura', 'Automatización', 'Equipo'];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground/70">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function LabeledInput({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-muted border-border text-foreground placeholder:text-muted-foreground/70 pr-10 text-sm h-9"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors"
        aria-label={visible ? 'Hide value' : 'Show value'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium',
        status === 'connected' && 'bg-[#22C55E]/10 text-[#22C55E]',
        status === 'disconnected' && 'bg-[#5A5A6E]/10 text-muted-foreground/70',
        status === 'error' && 'bg-red-500/10 text-red-400',
      )}
    >
      {status === 'connected' ? (
        <Wifi className="h-3 w-3" />
      ) : status === 'error' ? (
        <WifiOff className="h-3 w-3" />
      ) : (
        <WifiOff className="h-3 w-3" />
      )}
      {status}
    </span>
  );
}

function SaveButton({
  saving,
  onClick,
}: {
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={saving}
      className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2"
      size="sm"
    >
      {saving ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5" />
          Guardar
        </>
      )}
    </Button>
  );
}

const inputClasses = 'bg-muted border-border text-foreground placeholder:text-muted-foreground/70 text-sm h-9';

// ---------------------------------------------------------------------------
// Section: Repository
// ---------------------------------------------------------------------------

function RepositorySection() {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [pat, setPat] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTest = () => {
    setTesting(true);
    setStatus('disconnected');
    setTimeout(() => {
      setStatus(owner && repo && pat ? 'connected' : 'error');
      setTesting(false);
    }, 1500);
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <SettingsCard
      title="Conexión GitHub"
      description="Conecta tu repositorio de GitHub para habilitar la creación automática de PRs y gestión de ramas."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label="Owner">
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="DamballahWedo99"
            className={inputClasses}
          />
        </LabeledInput>

        <LabeledInput label="Repository">
          <Input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="CENZONTLE"
            className={inputClasses}
          />
        </LabeledInput>
      </div>

      <div className="mt-4">
        <LabeledInput label="Personal Access Token">
          <PasswordField
            value={pat}
            onChange={setPat}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          />
        </LabeledInput>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={testing || (!owner && !repo && !pat)}
            className="text-muted-foreground hover:text-foreground gap-2"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            Probar conexión
          </Button>
        </div>
        <SaveButton saving={saving} onClick={handleSave} />
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Branch Strategy
// ---------------------------------------------------------------------------

function BranchStrategySection() {
  const [devBranch, setDevBranch] = useState(DEFAULT_BRANCH_STRATEGY.devBranch);
  const [mainBranch, setMainBranch] = useState(DEFAULT_BRANCH_STRATEGY.mainBranch);
  const [prefix, setPrefix] = useState(DEFAULT_BRANCH_STRATEGY.forgeBranchPrefix);
  const [autoDelete, setAutoDelete] = useState(DEFAULT_BRANCH_STRATEGY.autoDeleteForgeBranch);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <SettingsCard
      title="Configuración de ramas"
      description="Configura cómo la factory crea y gestiona las ramas de Git para los sprint batches."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label="DEV Branch">
          <Input
            value={devBranch}
            onChange={(e) => setDevBranch(e.target.value)}
            placeholder="dev"
            className={inputClasses}
          />
        </LabeledInput>

        <LabeledInput label="Main / Production Branch">
          <Input
            value={mainBranch}
            onChange={(e) => setMainBranch(e.target.value)}
            placeholder="main"
            className={inputClasses}
          />
        </LabeledInput>
      </div>

      <div className="mt-4">
        <LabeledInput label="Forge Branch Prefix">
          <Input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="forge/sprint-batch-"
            className={inputClasses}
          />
        </LabeledInput>
        <p className="mt-1.5 text-[10px] text-muted-foreground/50">
          Batch branches will be named: {prefix || 'forge/sprint-batch-'}
          <span className="text-indigo-400">{'<batch-id>'}</span>
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Checkbox
          id="auto-delete"
          checked={autoDelete}
          onCheckedChange={(checked) => setAutoDelete(checked === true)}
          className="border-border data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
        />
        <label
          htmlFor="auto-delete"
          className="text-xs text-muted-foreground cursor-pointer select-none"
        >
          Auto-delete forge branches after merge to DEV
        </label>
      </div>

      <div className="mt-5 flex justify-end">
        <SaveButton saving={saving} onClick={handleSave} />
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Linear
// ---------------------------------------------------------------------------

function LinearSection() {
  const [apiKey, setApiKey] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTest = () => {
    setTesting(true);
    setStatus('disconnected');
    setTimeout(() => {
      setStatus(apiKey && teamId ? 'connected' : 'error');
      setTesting(false);
    }, 1500);
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <SettingsCard
      title="Conexión Linear"
      description="Conecta con Linear para seguimiento de issues e integración de gestión de proyectos."
    >
      <div className="space-y-4">
        <LabeledInput label="API Key">
          <PasswordField
            value={apiKey}
            onChange={setApiKey}
            placeholder="lin_api_..."
          />
        </LabeledInput>

        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledInput label="Team Name">
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Engineering"
              className={inputClasses}
            />
          </LabeledInput>

          <LabeledInput label="Team ID">
            <Input
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="UUID"
              className={inputClasses}
            />
          </LabeledInput>
        </div>

        <LabeledInput label="Workspace Slug">
          <Input
            value={workspaceSlug}
            onChange={(e) => setWorkspaceSlug(e.target.value)}
            placeholder="my-company"
            className={inputClasses}
          />
        </LabeledInput>

        <LabeledInput label="Project Name (optional)">
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Q1 Sprint"
            className={inputClasses}
          />
        </LabeledInput>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="text-muted-foreground hover:text-foreground gap-2"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            Probar conexión
          </Button>
        </div>
        <SaveButton saving={saving} onClick={handleSave} />
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Jira
// ---------------------------------------------------------------------------

function JiraSection() {
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [domain, setDomain] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [projectName, setProjectName] = useState('');
  const [defaultIssueType, setDefaultIssueType] = useState('Story');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTest = () => {
    setTesting(true);
    setStatus('disconnected');
    setTimeout(() => {
      setStatus(email && apiToken && domain && projectKey ? 'connected' : 'error');
      setTesting(false);
    }, 1500);
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <SettingsCard
      title="Conexión Jira"
      description="Conecta con Jira para seguimiento de issues y gestión de sprints."
    >
      <div className="space-y-4">
        <LabeledInput label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={inputClasses}
          />
        </LabeledInput>

        <LabeledInput label="API Token">
          <PasswordField
            value={apiToken}
            onChange={setApiToken}
            placeholder="ATATT3x..."
          />
        </LabeledInput>

        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledInput label="Domain">
            <div className="flex items-center gap-0">
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="mycompany"
                className={cn(inputClasses, 'rounded-r-none')}
              />
              <span className="flex h-9 items-center rounded-r-md border border-l-0 border-border bg-muted px-3 text-xs text-muted-foreground/70">
                .atlassian.net
              </span>
            </div>
          </LabeledInput>

          <LabeledInput label="Project Key">
            <Input
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              placeholder="PROJ"
              className={inputClasses}
            />
          </LabeledInput>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledInput label="Project Name">
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Engineering Project"
              className={inputClasses}
            />
          </LabeledInput>

          <LabeledInput label="Default Issue Type">
            <Select value={defaultIssueType} onValueChange={setDefaultIssueType}>
              <SelectTrigger className={cn(inputClasses, 'w-full')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Story">Story</SelectItem>
                <SelectItem value="Task">Task</SelectItem>
                <SelectItem value="Bug">Bug</SelectItem>
                <SelectItem value="Sub-task">Sub-task</SelectItem>
              </SelectContent>
            </Select>
          </LabeledInput>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={testing || !apiToken}
            className="text-muted-foreground hover:text-foreground gap-2"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            Probar conexión
          </Button>
        </div>
        <SaveButton saving={saving} onClick={handleSave} />
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Obsidian Vaults
// ---------------------------------------------------------------------------

type VaultForm = { name: string; host: string; port: string; apiKey: string; vaultPath: string; allowedPodIds: string[] };

function ObsidianSection() {
  const { vaults, addVault, updateVault, removeVault } = useDefiniciones();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VaultForm>({ name: '', host: '127.0.0.1', port: '27124', apiKey: '', vaultPath: '', allowedPodIds: [] });
  const [testingId, setTestingId] = useState<string | null>(null);

  function startAdd() {
    setForm({ name: '', host: '127.0.0.1', port: '27124', apiKey: '', vaultPath: '', allowedPodIds: [] });
    setEditingId('__new__');
  }

  function startEdit(v: VaultConfig) {
    setForm({ name: v.name, host: v.host, port: v.port, apiKey: v.apiKey, vaultPath: v.vaultPath, allowedPodIds: v.allowedPodIds });
    setEditingId(v.id);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    if (editingId === '__new__') {
      addVault({
        id: `vault-${crypto.randomUUID()}`,
        name: form.name,
        host: form.host,
        port: form.port,
        protocol: 'https',
        apiKey: form.apiKey,
        vaultPath: form.vaultPath,
        allowedPodIds: form.allowedPodIds,
        status: 'disconnected',
        createdAt: new Date().toISOString(),
      });
    } else if (editingId) {
      const existing = vaults.find(v => v.id === editingId);
      if (existing) {
        updateVault({ ...existing, name: form.name, host: form.host, port: form.port, apiKey: form.apiKey, vaultPath: form.vaultPath, allowedPodIds: form.allowedPodIds });
      }
    }
    setEditingId(null);
  }

  function handleTest(vaultId: string) {
    setTestingId(vaultId);
    const v = vaults.find(vt => vt.id === vaultId);
    setTimeout(() => {
      if (v) updateVault({ ...v, status: v.apiKey && v.vaultPath ? 'connected' : 'error' });
      setTestingId(null);
    }, 1500);
  }

  return (
    <SettingsCard
      title="Obsidian Vaults"
      description="Gestiona los vaults de Obsidian conectados a través del plugin Local REST API. Cada vault aparece como opción en el selector del Vault de Definiciones."
    >
      <div className="space-y-3">
        {/* Vault list */}
        {vaults.map(v => (
          <div key={v.id} className="rounded-lg border bg-card p-3 space-y-3">
            {editingId === v.id ? (
              <VaultFormFields form={form} setForm={setForm} onSave={handleSave} onCancel={() => setEditingId(null)} />
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusDot status={v.status} />
                  <div>
                    <span className="text-sm font-medium">{v.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {v.host}:{v.port}
                    </span>
                  </div>
                  {v.allowedPodIds.length > 0 && (
                    <div className="flex items-center gap-1 ml-1">
                      {v.allowedPodIds.map(podId => {
                        const pod = mockPods.find(p => p.id === podId);
                        return pod ? (
                          <span key={podId} className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: `${pod.color}40`, color: pod.color, backgroundColor: `${pod.color}10` }}>
                            {pod.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-muted-foreground"
                    onClick={() => handleTest(v.id)}
                    disabled={testingId === v.id}
                  >
                    {testingId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                    Probar
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => startEdit(v)}>
                    <Settings className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeVault(v.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add new vault */}
        {editingId === '__new__' ? (
          <div className="rounded-lg border border-dashed bg-card p-3">
            <VaultFormFields form={form} setForm={setForm} onSave={handleSave} onCancel={() => setEditingId(null)} />
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={startAdd}>
            <Plus className="h-3.5 w-3.5" /> Agregar vault
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Requisitos:</p>
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <p>1. Instalar el plugin &ldquo;Local REST API&rdquo; en Obsidian</p>
          <p>2. Habilitar el plugin y copiar el API Key desde Settings</p>
          <p>3. Puerto por defecto: 27124 (HTTPS)</p>
        </div>
      </div>
    </SettingsCard>
  );
}

function VaultFormFields({
  form,
  setForm,
  onSave,
  onCancel,
}: {
  form: VaultForm;
  setForm: (f: VaultForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function togglePod(podId: string) {
    const next = form.allowedPodIds.includes(podId)
      ? form.allowedPodIds.filter(id => id !== podId)
      : [...form.allowedPodIds, podId];
    setForm({ ...form, allowedPodIds: next });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledInput label="Nombre del vault">
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Mi Vault" className={inputClasses} />
        </LabeledInput>
        <LabeledInput label="Vault Path">
          <Input value={form.vaultPath} onChange={e => setForm({ ...form, vaultPath: e.target.value })} placeholder="/ruta/al/vault" className={inputClasses} />
        </LabeledInput>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <LabeledInput label="Host">
          <Input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} placeholder="127.0.0.1" className={inputClasses} />
        </LabeledInput>
        <LabeledInput label="Puerto">
          <Input value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} placeholder="27124" className={inputClasses} />
        </LabeledInput>
        <LabeledInput label="API Key">
          <PasswordField value={form.apiKey} onChange={v => setForm({ ...form, apiKey: v })} placeholder="Obsidian API Key" />
        </LabeledInput>
      </div>

      {/* Pod access */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Células con acceso</label>
        <div className="flex flex-wrap gap-2">
          {mockPods.map(pod => {
            const isActive = form.allowedPodIds.includes(pod.id);
            return (
              <button
                key={pod.id}
                type="button"
                onClick={() => togglePod(pod.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all',
                  isActive
                    ? 'border-transparent shadow-sm'
                    : 'border-border/50 text-muted-foreground hover:text-foreground hover:border-border',
                )}
                style={isActive ? { backgroundColor: `${pod.color}15`, borderColor: `${pod.color}50`, color: pod.color } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pod.color, opacity: isActive ? 1 : 0.4 }} />
                {pod.name}
                {isActive && <Check className="h-3 w-3 ml-0.5" />}
              </button>
            );
          })}
        </div>
        {form.allowedPodIds.length === 0 && (
          <p className="text-[11px] text-muted-foreground mt-1.5">Sin restricción — todas las células tienen acceso.</p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={onSave} disabled={!form.name.trim()}>Guardar</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Compute Nodes
// ---------------------------------------------------------------------------

interface NodeRow {
  id: string;
  name: string;
  type: ComputeNode['type'];
  slots: number;
  status: 'online' | 'offline';
}

function ComputeNodesSection() {
  const [nodes, setNodes] = useState<NodeRow[]>([
    { id: 'node-1', name: 'MacBook Pro (local)', type: 'local', slots: 6, status: 'online' },
    { id: 'node-2', name: 'Mac Mini Office', type: 'mac-mini', slots: 8, status: 'online' },
    { id: 'node-3', name: 'AWS GPU Spot', type: 'gpu-instance', slots: 4, status: 'offline' },
  ]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const dashboardUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const workerCommand = `npx factory-worker --dashboard ${dashboardUrl} --token <YOUR_TOKEN>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(workerCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addNode = () => {
    setNodes((prev) => [
      ...prev,
      {
        id: `node-${Date.now()}`,
        name: '',
        type: 'mac-mini' as ComputeNode['type'],
        slots: 6,
        status: 'offline' as const,
      },
    ]);
  };

  const removeNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  };

  const updateNode = (id: string, field: keyof NodeRow, value: string | number) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, [field]: value } : n)),
    );
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  const typeOptions: { value: ComputeNode['type']; label: string }[] = [
    { value: 'local', label: 'Local' },
    { value: 'mac-mini', label: 'Mac Mini' },
    { value: 'cloud-vm', label: 'Cloud VM' },
    { value: 'gpu-instance', label: 'GPU Instance' },
  ];

  return (
    <SettingsCard
      title="Gestión de flota"
      description="Administra los nodos de cómputo de tu factory. Cada nodo puede ejecutar múltiples agentes concurrentes."
    >
      {/* Column headers */}
      <div className="mb-3 grid grid-cols-[1fr_140px_80px_60px_40px] items-center gap-3 px-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Name</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Type</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Slots</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Status</span>
        <span />
      </div>

      <div className="space-y-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="grid grid-cols-[1fr_140px_80px_60px_40px] items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
          >
            <Input
              value={node.name}
              onChange={(e) => updateNode(node.id, 'name', e.target.value)}
              placeholder="Node name"
              className={cn(inputClasses, 'h-8 text-xs')}
            />

            <Select
              value={node.type}
              onValueChange={(v) => updateNode(node.id, 'type', v)}
            >
              <SelectTrigger className={cn(inputClasses, 'h-8 text-xs')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="number"
              min={1}
              max={20}
              value={node.slots}
              onChange={(e) => updateNode(node.id, 'slots', parseInt(e.target.value) || 1)}
              className={cn(inputClasses, 'h-8 text-xs')}
            />

            <span
              className={cn(
                'flex items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                node.status === 'online'
                  ? 'bg-[#22C55E]/10 text-[#22C55E]'
                  : 'bg-[#5A5A6E]/10 text-muted-foreground/70',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  node.status === 'online' ? 'bg-[#22C55E]' : 'bg-[#5A5A6E]',
                )}
              />
              {node.status}
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeNode(node.id)}
              className="h-8 w-8 p-0 text-muted-foreground/70 hover:text-red-400 hover:bg-red-500/10"
              aria-label={`Remove ${node.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {nodes.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center">
          <Server className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground/70">No hay nodos de cómputo configurados</p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={addNode}
          className="text-muted-foreground hover:text-foreground gap-2"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar nodo
        </Button>
        <SaveButton saving={saving} onClick={handleSave} />
      </div>

      {/* Connect remote node command */}
      <div className="mt-5 pt-5 border-t border-border">
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Ejecuta esto en la máquina destino para conectarla
          </span>
        </div>
        <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2.5 border border-border">
          <code className="text-xs text-green-400 font-mono flex-1 truncate">
            {workerCommand}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0 text-muted-foreground/70 hover:text-foreground"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-2">
          El nodo aparecerá como &quot;offline&quot; hasta que el worker agent se conecte.
        </p>
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Agents
// ---------------------------------------------------------------------------

function AgentsSection() {
  const [maxConcurrent, setMaxConcurrent] = useState(DEFAULT_FACTORY_CONFIG.maxConcurrentAgents);
  const [maxRetries, setMaxRetries] = useState(DEFAULT_FACTORY_CONFIG.maxRetriesPerStory);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <SettingsCard
      title="Límites de agentes"
      description="Controla la concurrencia y el comportamiento de reintentos de los agentes de la factory."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label="Max Concurrent Agents">
          <Input
            type="number"
            min={1}
            max={15}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Math.min(15, Math.max(1, parseInt(e.target.value) || 1)))}
            className={inputClasses}
          />
          <p className="mt-1.5 text-[10px] text-muted-foreground/50">
            Limits the number of agents working simultaneously across all nodes (1-15)
          </p>
        </LabeledInput>

        <LabeledInput label="Max Retries per Story">
          <Input
            type="number"
            min={1}
            max={5}
            value={maxRetries}
            onChange={(e) => setMaxRetries(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
            className={inputClasses}
          />
          <p className="mt-1.5 text-[10px] text-muted-foreground/50">
            After this many review rejections, the story is escalated to a human (1-5)
          </p>
        </LabeledInput>
      </div>

      <div className="mt-5 flex justify-end">
        <SaveButton saving={saving} onClick={handleSave} />
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Definition of Done Section (with drag-and-drop reordering via @dnd-kit)
// ---------------------------------------------------------------------------

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DodCriterion {
  id: string;
  text: string;
  enabled: boolean;
  required: boolean;
}

const DEFAULT_DOD_CRITERIA: DodCriterion[] = [
  { id: 'code-written', text: 'Código escrito y funcional', enabled: true, required: true },
  { id: 'tests-passing', text: 'Tests pasando ≥ 90% cobertura', enabled: true, required: true },
  { id: 'pr-created', text: 'PR creado y aprobado', enabled: true, required: true },
  { id: 'no-errors', text: 'Sin errores de lint/typecheck', enabled: true, required: true },
  { id: 'docs-updated', text: 'Documentación actualizada', enabled: true, required: false },
  { id: 'security-scan', text: 'Scan de seguridad sin vulnerabilidades críticas', enabled: false, required: false },
  { id: 'perf-budget', text: 'Dentro del presupuesto de performance', enabled: false, required: false },
  { id: 'accessibility', text: 'Cumple WCAG 2.1 AA', enabled: false, required: false },
];

function SortableDodRow({
  criterion,
  onToggleEnabled,
  onToggleRequired,
  onRemove,
}: {
  criterion: DodCriterion;
  onToggleEnabled: () => void;
  onToggleRequired: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: criterion.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid grid-cols-[1fr_80px_80px_32px] gap-2 px-4 py-3 items-center border-b border-border last:border-b-0 bg-card',
        !criterion.enabled && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none shrink-0">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors" />
        </button>
        <span className="text-sm text-foreground truncate">{criterion.text}</span>
      </div>
      <div className="flex justify-center">
        <Checkbox checked={criterion.enabled} onCheckedChange={onToggleEnabled} />
      </div>
      <div className="flex justify-center">
        <Checkbox checked={criterion.enabled && criterion.required} disabled={!criterion.enabled} onCheckedChange={onToggleRequired} />
      </div>
      <button
        onClick={onRemove}
        className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function DodSection() {
  const [criteria, setCriteria] = useState(DEFAULT_DOD_CRITERIA);
  const [newCriterion, setNewCriterion] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCriteria((prev) => {
        const oldIndex = prev.findIndex((c) => c.id === active.id);
        const newIndex = prev.findIndex((c) => c.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  function toggleEnabled(id: string) {
    setCriteria((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
  }

  function toggleRequired(id: string) {
    setCriteria((prev) => prev.map((c) => c.id === id ? { ...c, required: !c.required } : c));
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  }

  function addCriterion() {
    if (!newCriterion.trim()) return;
    setCriteria((prev) => [...prev, { id: `custom-${Date.now()}`, text: newCriterion.trim(), enabled: true, required: false }]);
    setNewCriterion('');
  }

  const enabledCount = criteria.filter((c) => c.enabled).length;
  const requiredCount = criteria.filter((c) => c.enabled && c.required).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-border bg-card p-6">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-foreground">Definition of Done</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">Define los criterios estándar que cada agente debe cumplir antes de marcar una historia como completada. Los criterios requeridos bloquean el merge si no se cumplen.</p>
      </div>
      <div className="flex-1 flex flex-col min-h-0 gap-4">
        {/* Summary + save button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{enabledCount} criterios activos</span>
            <span className="text-border">|</span>
            <span>{requiredCount} requeridos</span>
          </div>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Save className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Guardar cambios</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Criteria list with drag-and-drop */}
        <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border overflow-hidden">
          {/* Header */}
          <div className="shrink-0 grid grid-cols-[1fr_80px_80px_32px] gap-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 border-b border-border bg-muted/30">
            <span>Criterio</span>
            <span className="text-center">Activo</span>
            <span className="text-center">Requerido</span>
            <span />
          </div>

          {/* Scrollable list */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={criteria.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {criteria.map((criterion) => (
                  <SortableDodRow
                    key={criterion.id}
                    criterion={criterion}
                    onToggleEnabled={() => toggleEnabled(criterion.id)}
                    onToggleRequired={() => toggleRequired(criterion.id)}
                    onRemove={() => removeCriterion(criterion.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Add new criterion */}
        <div className="flex items-center gap-2">
          <Input
            value={newCriterion}
            onChange={(e) => setNewCriterion(e.target.value)}
            placeholder="Agregar nuevo criterio..."
            className="flex-1 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && addCriterion()}
          />
          <Button variant="outline" size="sm" onClick={addCriterion} disabled={!newCriterion.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Agregar
          </Button>
        </div>

      </div>
    </div>
  );
}

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'repository':
      return <RepositorySection />;
    case 'branches':
      return <BranchStrategySection />;
    case 'linear':
      return <LinearSection />;
    case 'jira':
      return <JiraSection />;
    case 'obsidian':
      return <DefinicionesProvider><ObsidianSection /></DefinicionesProvider>;
    case 'nodes':
      return <ComputeNodesSection />;
    case 'agents':
      return <AgentsSection />;
    case 'dod':
      return <DodSection />;
    case 'team':
      return <TeamSection />;
    case 'roles':
      return <RolesPermissionsSection />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSection = (searchParams.get('section') as SettingsSection) || 'repository';
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);

  return (
    <div className="settings-page flex flex-col bg-background overflow-hidden h-full">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="flex h-14 items-center gap-4 px-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-muted-foreground/70 transition-colors hover:text-foreground"
            aria-label="Regresar"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <Settings className="h-4.5 w-4.5 text-indigo-400" />
            <h1 className="text-sm font-semibold text-foreground">Configuración</h1>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 w-full min-h-0">
        {/* Sidebar */}
        <nav
          className="w-60 shrink-0 overflow-y-auto border-r border-border py-6 pr-2 pl-6"
          aria-label="Settings navigation"
        >
          {SIDEBAR_GROUPS.map((group) => {
            const items = SIDEBAR_ITEMS.filter((item) => item.group === group);
            return (
              <div key={group} className="mb-5">
                <span className="mb-1.5 block px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </span>
                <ul className="space-y-0.5" role="list">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          onClick={() => setActiveSection(item.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors',
                            isActive
                              ? 'border-l-2 border-indigo-500 bg-muted text-foreground'
                              : 'border-l-2 border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Content area */}
        <main className="flex-1 min-w-0 overflow-y-auto px-8 py-8 flex flex-col">
          <SectionContent section={activeSection} />
        </main>
      </div>
    </div>
  );
}
