'use client';

import { useState, useCallback } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Eye,
  EyeOff,
  Loader2,
  Github,
  GitBranch,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  GitHubConfig,
  BranchStrategy,
  FactoryConfig,
} from '@cenzontle/shared';
import { DEFAULT_FACTORY_CONFIG, DEFAULT_BRANCH_STRATEGY } from '@cenzontle/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

interface FactorySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted border border-border">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  id,
  type = 'text',
  min,
  max,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  id: string;
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground mb-1.5 block">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        className="bg-muted border-border text-foreground placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground mb-1.5 block">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-9 bg-muted border-border text-foreground placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? 'Ocultar token' : 'Mostrar token'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; label: string }> = {
    idle: { color: 'bg-[#4A4A5A]', label: 'Sin probar' },
    testing: { color: 'bg-yellow-500 animate-pulse', label: 'Probando...' },
    success: { color: 'bg-emerald-500', label: 'Conectado' },
    error: { color: 'bg-red-500', label: 'Error de conexion' },
  };

  const { color, label } = config[status];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('h-2 w-2 rounded-full shrink-0', color)} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FactorySettingsDialog({
  open,
  onOpenChange,
}: FactorySettingsDialogProps) {
  // Local form state matching the shared FactoryConfig shape
  const [github, setGitHub] = useState<GitHubConfig>({
    owner: '',
    repo: '',
    personalAccessToken: '',
  });
  const [branches, setBranches] = useState<BranchStrategy>({
    ...DEFAULT_BRANCH_STRATEGY,
  });
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(
    DEFAULT_FACTORY_CONFIG.maxConcurrentAgents
  );
  const [maxRetriesPerStory, setMaxRetriesPerStory] = useState(
    DEFAULT_FACTORY_CONFIG.maxRetriesPerStory
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---- updaters ----

  const updateGitHub = useCallback(
    <K extends keyof GitHubConfig>(key: K, value: GitHubConfig[K]) => {
      setGitHub((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateBranches = useCallback(
    <K extends keyof BranchStrategy>(key: K, value: BranchStrategy[K]) => {
      setBranches((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // ---- actions ----

  const canTest = (): boolean => {
    return !!(github.owner && github.repo && github.personalAccessToken);
  };

  const handleTestConnection = () => {
    if (!canTest()) return;
    setConnectionStatus('testing');
    setErrorMessage(null);

    // Simulate GitHub API call -- in production this would call:
    // GET https://api.github.com/repos/{owner}/{repo} with Authorization: Bearer {PAT}
    setTimeout(() => {
      const success = Math.random() > 0.2;
      if (success) {
        setConnectionStatus('success');
      } else {
        setConnectionStatus('error');
        setErrorMessage(
          'No se pudo conectar con GitHub. Verifica que el owner, repositorio y token sean correctos y que el token tenga permisos de repo.'
        );
      }
    }, 1500);
  };

  const handleSave = () => {
    // For now, just close the dialog. Context integration comes later.
    onOpenChange(false);
  };

  const handleCancel = () => {
    setGitHub({ owner: '', repo: '', personalAccessToken: '' });
    setBranches({ ...DEFAULT_BRANCH_STRATEGY });
    setMaxConcurrentAgents(DEFAULT_FACTORY_CONFIG.maxConcurrentAgents);
    setMaxRetriesPerStory(DEFAULT_FACTORY_CONFIG.maxRetriesPerStory);
    setConnectionStatus('idle');
    setErrorMessage(null);
    onOpenChange(false);
  };

  // ---- render ----

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-2xl max-h-[85vh] overflow-y-auto',
          'bg-card border-border text-foreground'
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">Factory Settings</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Configura el repositorio, estrategia de ramas y limites de agentes para la
            Software Factory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* ---- Section 1: Repository ---- */}
          <section>
            <SectionHeader icon={Github} title="Repository" />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput
                  id="gh-owner"
                  label="Owner"
                  value={github.owner}
                  onChange={(v) => updateGitHub('owner', v)}
                  placeholder="mi-organizacion"
                />
                <LabeledInput
                  id="gh-repo"
                  label="Repository"
                  value={github.repo}
                  onChange={(v) => updateGitHub('repo', v)}
                  placeholder="mi-repositorio"
                />
              </div>
              <PasswordField
                id="gh-pat"
                label="Personal Access Token"
                value={github.personalAccessToken}
                onChange={(v) => updateGitHub('personalAccessToken', v)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              />

              {/* Connection status bar */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
                <div className="flex flex-col gap-1">
                  <StatusIndicator status={connectionStatus} />
                  {connectionStatus === 'error' && errorMessage && (
                    <p className="text-xs text-red-400 mt-1">{errorMessage}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={!canTest() || connectionStatus === 'testing'}
                  className="border-border text-foreground hover:bg-border shrink-0"
                >
                  {connectionStatus === 'testing' && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  Probar conexion
                </Button>
              </div>
            </div>
          </section>

          {/* ---- Section 2: Branch Strategy ---- */}
          <section>
            <SectionHeader icon={GitBranch} title="Branch Strategy" />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput
                  id="branch-dev"
                  label="DEV Branch"
                  value={branches.devBranch}
                  onChange={(v) => updateBranches('devBranch', v)}
                  placeholder="dev"
                />
                <LabeledInput
                  id="branch-main"
                  label="Main / Production Branch"
                  value={branches.mainBranch}
                  onChange={(v) => updateBranches('mainBranch', v)}
                  placeholder="main"
                />
              </div>
              <LabeledInput
                id="branch-prefix"
                label="Forge Branch Prefix"
                value={branches.forgeBranchPrefix}
                onChange={(v) => updateBranches('forgeBranchPrefix', v)}
                placeholder="forge/sprint-batch-"
              />
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="auto-delete"
                  checked={branches.autoDeleteForgeBranch}
                  onCheckedChange={(checked) =>
                    updateBranches('autoDeleteForgeBranch', checked === true)
                  }
                  className="border-border data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                />
                <label
                  htmlFor="auto-delete"
                  className="text-sm text-foreground cursor-pointer select-none"
                >
                  Eliminar ramas forge automaticamente despues del merge
                </label>
              </div>
            </div>
          </section>

          {/* ---- Section 3: Agent Configuration ---- */}
          <section>
            <SectionHeader icon={Bot} title="Agent Configuration" />
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput
                id="max-agents"
                label="Max Concurrent Agents"
                type="number"
                value={maxConcurrentAgents}
                onChange={(v) => {
                  const n = Math.min(15, Math.max(1, parseInt(v, 10) || 1));
                  setMaxConcurrentAgents(n);
                }}
                placeholder="6"
                min={1}
                max={15}
              />
              <LabeledInput
                id="max-retries"
                label="Max Retries per Story"
                type="number"
                value={maxRetriesPerStory}
                onChange={(v) => {
                  const n = Math.min(5, Math.max(1, parseInt(v, 10) || 1));
                  setMaxRetriesPerStory(n);
                }}
                placeholder="3"
                min={1}
                max={5}
              />
            </div>
          </section>
        </div>

        {/* ---- Footer ---- */}
        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="border-border text-foreground hover:bg-border"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
