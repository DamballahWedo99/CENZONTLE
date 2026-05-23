'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  ComputeNode,
  ConnectionStatus,
} from '@cenzontle/shared';
import {
  DEFAULT_BRANCH_STRATEGY,
} from '@cenzontle/shared';
import {
  Github,
  GitBranch,
  Server,
  Brain,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Loader2,
  Check,
  CheckCircle2,
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
  Boxes,
  Zap,
  Code,
  RefreshCw,
  KeyRound,
  AlertOctagon,
  AlertTriangle,
  GitPullRequest,
  PencilLine,
} from 'lucide-react';
import { LinearIcon } from '@/components/icons/LinearIcon';
import { AnthropicIcon } from '@/components/icons/AnthropicIcon';
import { TeamSection } from './TeamSection';
import { RolesPermissionsSection } from './RolesPermissionsSection';
import { PodsSection } from './PodsSection';
import { ExternalSecretsSection } from './ExternalSecretsSection';
import { AgentTokensSection } from './AgentTokensSection';
import { AnthropicApiKeySection } from './AnthropicApiKeySection';
import { ForgeKillSwitchSection } from './ForgeKillSwitchSection';
import { GenerateTokenDialog } from './GenerateTokenDialog';
import {
  getComputeNodes,
  createComputeNode,
  updateComputeNode,
  deleteComputeNode,
  getBranchStrategy,
  updateBranchStrategy,
  getBranchGitState,
  type BranchGitStateResponse,
  type ComputeNodeResponse,
  type ComputeNodeType,
} from '@/lib/api/factory';
import { AlignDevBranchDialog } from './AlignDevBranchDialog';
import { ApiError } from '@/lib/api/client';
import {
  listDodCriteria,
  resetDodCriteriaDefaults,
  upsertDodCriteria,
} from '@/lib/api/dod';
import { UserRole, AccessLevel, USER_ROLE_LABELS, DEFAULT_ROLE_ACCESS, USER_ROLE_COLORS } from '@cenzontle/shared';
import { useAuthContext } from '@/context/AuthContext';
import {
  getLinearConfig,
  saveLinearConfig,
  testLinearConnection,
  deleteIntegrationConfig,
} from '@/lib/api/integrations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsSection = 'branches' | 'linear' | 'vault' | 'codigo' | 'external-secrets' | 'nodes' | 'kill-switch' | 'agents' | 'agent-tokens' | 'anthropic-key' | 'dod' | 'pods' | 'team' | 'roles';

interface SidebarItem {
  id: SettingsSection;
  label: string;
  // Acepta tanto iconos de lucide-react (ForwardRef) como componentes SVG
  // custom (e.g. LinearIcon brand mark). Ambos rendean con `className`.
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  // "Código" vive aquí (NO en Integraciones) porque es el control real del
  // repositorio destino del Forge: read-only por default + opt-in
  // forgeWritable para escritura. Reemplazó la tarjeta "Repositorio" mockeada.
  { id: 'codigo', label: 'Código', icon: Code, group: 'Control de código' },
  { id: 'branches', label: 'Estrategia de ramas', icon: GitBranch, group: 'Control de código' },
  { id: 'linear', label: 'Linear', icon: LinearIcon, group: 'Integraciones' },
  { id: 'vault', label: 'Vault', icon: BookMarked, group: 'Integraciones' },
  { id: 'external-secrets', label: 'Secretos externos', icon: KeyRound, group: 'Integraciones' },
  { id: 'nodes', label: 'Nodos de cómputo', icon: Server, group: 'Infraestructura' },
  { id: 'kill-switch', label: 'Kill Switch del Forge', icon: AlertOctagon, group: 'Infraestructura' },
  { id: 'agent-tokens', label: 'Tokens IA', icon: Brain, group: 'Automatización' },
  { id: 'anthropic-key', label: 'Anthropic API Key', icon: AnthropicIcon, group: 'Automatización' },
  { id: 'dod', label: 'Definition of Done', icon: ClipboardCheck, group: 'Automatización' },
  { id: 'pods', label: 'Células', icon: Boxes, group: 'Ecosistema' },
  { id: 'team', label: 'Equipo', icon: Users, group: 'Ecosistema' },
  { id: 'roles', label: 'Roles y permisos', icon: Shield, group: 'Ecosistema' },
];

const SIDEBAR_GROUPS = ['Control de código', 'Integraciones', 'Infraestructura', 'Automatización', 'Ecosistema'];

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Estado del git remote: dev y main existen + comparten historia. El
  // backend lo expone vía /factory/branch-strategy/git-state. Mostramos un
  // banner accionable cuando hay un problema arreglable (warning != null).
  const [gitState, setGitState] = useState<BranchGitStateResponse | null>(null);
  const [gitStateLoading, setGitStateLoading] = useState(false);
  const [alignDialogOpen, setAlignDialogOpen] = useState(false);

  // Carga el git state — separado del config porque toca GitHub API y puede
  // tardar 1-3s. NO bloquea el form principal: si falla, simplemente no
  // mostramos el banner (config sigue editable).
  const refreshGitState = useCallback(async () => {
    setGitStateLoading(true);
    try {
      const state = await getBranchGitState();
      setGitState(state);
    } catch {
      // Silencio — el banner solo aparece cuando tenemos data confiable.
      setGitState(null);
    } finally {
      setGitStateLoading(false);
    }
  }, []);

  // Hidrata desde el backend al montar. Si NO existe la fila aún (primer
  // arranque), el endpoint hace auto-seed con defaults — siempre devuelve
  // valores válidos, nunca null.
  useEffect(() => {
    let cancelled = false;
    getBranchStrategy()
      .then((config) => {
        if (cancelled) return;
        setDevBranch(config.devBranch);
        setMainBranch(config.mainBranch);
        setPrefix(config.forgeBranchPrefix);
        setAutoDelete(config.autoDeleteForgeBranch);
        // Después de cargar el config, validamos el git state en paralelo.
        void refreshGitState();
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          toast.error('Solo Alta Gerencia puede ver la estrategia de ramas');
        } else if (err instanceof ApiError && err.status !== 401) {
          toast.error(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshGitState]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateBranchStrategy({
        devBranch,
        mainBranch,
        forgeBranchPrefix: prefix,
        autoDeleteForgeBranch: autoDelete,
      });
      // El backend valida y normaliza — actualiza el state local con la
      // versión persistida (puede haber trim u otras transformaciones).
      setDevBranch(updated.devBranch);
      setMainBranch(updated.mainBranch);
      setPrefix(updated.forgeBranchPrefix);
      setAutoDelete(updated.autoDeleteForgeBranch);
      toast.success('Estrategia de ramas guardada');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al guardar';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      title="Configuración de ramas"
      description="Configura cómo la factory crea y gestiona las ramas de Git para los sprint batches. Modelo de 3 niveles: main ← DEV ← forge/sprint-batch-{epicId}."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando configuración...
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledInput label="DEV Branch">
              <Input
                value={devBranch}
                onChange={(e) => setDevBranch(e.target.value)}
                placeholder="dev"
                disabled={saving}
                className={inputClasses}
              />
            </LabeledInput>

            <LabeledInput label="Main / Production Branch">
              <Input
                value={mainBranch}
                onChange={(e) => setMainBranch(e.target.value)}
                placeholder="main"
                disabled={saving}
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
                disabled={saving}
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
              disabled={saving}
              className="border-border data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
            />
            <label
              htmlFor="auto-delete"
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              Auto-delete forge branches after merge to DEV
            </label>
          </div>

          {/* Validación del git state — banner amarillo si dev y main no
              comparten historia (caso típico tras setup huérfano de dev),
              banner verde si todo OK. Solo mostramos si hay code repo
              configurado (sin repo no aplica la validación). */}
          {gitState?.repoConfigured && (
            <BranchGitStatePanel
              state={gitState}
              loading={gitStateLoading}
              onRefresh={() => void refreshGitState()}
              onAlignClick={() => setAlignDialogOpen(true)}
            />
          )}

          <div className="mt-5 flex justify-end">
            <SaveButton saving={saving} onClick={() => void handleSave()} />
          </div>
        </>
      )}

      {/* Dialog de step-up auth para el align. Se monta siempre que tengamos
          state, controlado por `alignDialogOpen`. Sin esto, no podemos
          renderear el dialog porque necesita los nombres de las branches. */}
      {gitState?.repoConfigured && (
        <AlignDevBranchDialog
          open={alignDialogOpen}
          onOpenChange={setAlignDialogOpen}
          devBranch={gitState.devBranch}
          mainBranch={gitState.mainBranch}
          onAligned={() => {
            // Re-validamos el git state inmediatamente — el banner debería
            // pasar de "warning" a "OK" tras el align exitoso.
            void refreshGitState();
          }}
        />
      )}
    </SettingsCard>
  );
}

/**
 * Banner de validación del git state. Cuando dev y main NO comparten historia
 * o alguna branch falta, mostramos un mensaje accionable con botón "Alinear".
 * Cuando todo está OK, mostramos un check verde compacto para confirmar al
 * operador que el setup está sano.
 */
function BranchGitStatePanel({
  state,
  loading,
  onRefresh,
  onAlignClick,
}: {
  state: BranchGitStateResponse;
  loading: boolean;
  onRefresh: () => void;
  onAlignClick: () => void;
}) {
  if (state.warning) {
    return (
      <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1 space-y-2">
            <p className="text-xs font-medium text-amber-200">
              Problema con el git state
            </p>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              {state.warning}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-amber-200/70 font-mono">
              <span>
                {state.devBranch}: {state.devSha?.slice(0, 7) ?? '—'}
              </span>
              <span>·</span>
              <span>
                {state.mainBranch}: {state.mainSha?.slice(0, 7) ?? '—'}
              </span>
              {state.compareStatus && (
                <>
                  <span>·</span>
                  <span>compare: {state.compareStatus}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 pt-2">
              {state.canAlignDev && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onAlignClick}
                  disabled={loading}
                  className="h-7 text-[11px]"
                >
                  Alinear {state.devBranch} con {state.mainBranch}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={onRefresh}
                disabled={loading}
                className="h-7 text-[11px] text-amber-200 hover:text-amber-100"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                )}
                Re-validar
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Estado OK — banner verde con resumen del git state. Mostramos un botón
  // "Resetear dev a main" como acción manual disponible incluso cuando todo
  // está alineado: útil cuando el operador quiere descartar trabajo en dev,
  // sincronizar después de un release a main, o resolver un diverged/behind.
  // Visualmente menos prominente que el banner amarillo (sin variant="destructive"
  // explícito, color emerald-tinted) para no sugerir urgencia.
  const isIdentical = state.compareStatus === 'identical';
  const isDiverged =
    state.compareStatus === 'diverged' || state.compareStatus === 'behind';
  return (
    <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-400" />
        <div className="flex-1 space-y-2">
          <p className="text-xs font-medium text-emerald-200">
            Git state OK
          </p>
          <p className="text-[11px] text-emerald-200/80 leading-relaxed">
            <code className="font-mono">{state.devBranch}</code> y{' '}
            <code className="font-mono">{state.mainBranch}</code> comparten
            historia. El consolidated PR del Forge podrá mergearse correctamente.
            {isDiverged && (
              <>
                {' '}<span className="text-amber-200/90">
                  Nota: {state.devBranch} ha divergido de {state.mainBranch} (
                  {state.compareStatus}) — puedes resetear si quieres que
                  apunten al mismo commit.
                </span>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-emerald-200/70 font-mono">
            <span>
              {state.devBranch}: {state.devSha?.slice(0, 7) ?? '—'}
            </span>
            <span>·</span>
            <span>
              {state.mainBranch}: {state.mainSha?.slice(0, 7) ?? '—'}
            </span>
            {state.compareStatus && (
              <>
                <span>·</span>
                <span>compare: {state.compareStatus}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onAlignClick}
              disabled={loading}
              className="h-7 text-[11px] border-emerald-500/40 bg-transparent text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100"
              title={
                isIdentical
                  ? `Las branches ya apuntan al mismo commit. Resetear es no-op pero queda como audit entry.`
                  : `Force-update de ${state.devBranch} para que apunte al HEAD de ${state.mainBranch}.`
              }
            >
              Resetear {state.devBranch} a {state.mainBranch}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={loading}
              className="h-7 text-[11px] text-emerald-200 hover:text-emerald-100"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1.5" />
              )}
              Re-validar
            </Button>
          </div>
        </div>
      </div>
    </div>
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
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);
  // Two-step delete: primer click marca `confirmingDelete=true`, segundo
  // ejecuta. Mismo patrón que HistoriasList.tsx — evita un dialog modal.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Hidrata campos al montar — si no hay config (404), deja todo vacío.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await getLinearConfig();
        if (cancelled || !config) return;
        // El endpoint /integrations/linear siempre retorna metadata como LinearConfig.
        const linear = config.metadata as LinearConfig;
        setTeamId(linear.teamId ?? '');
        setTeamName(linear.teamName ?? '');
        setWorkspaceSlug(linear.workspaceSlug ?? '');
        setProjectId(linear.projectId ?? '');
        setProjectName(linear.projectName ?? '');
        setStatus(config.status);
        setMaskedKey(config.maskedKey);
        setLastTestedAt(config.lastTestedAt);
      } catch (err) {
        toast.error('No se pudo cargar la configuración Linear', {
          description: err instanceof Error ? err.message : 'Error desconocido',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTest = async () => {
    if (!teamId || !workspaceSlug || !teamName) {
      toast.error('Completa Team Name, Team ID y Workspace Slug antes de probar');
      return;
    }
    setTesting(true);
    try {
      const result = await testLinearConnection({
        ...(apiKey ? { apiKey } : {}),
        teamId,
        teamName,
        workspaceSlug,
        ...(projectId ? { projectId } : {}),
        ...(projectName ? { projectName } : {}),
      });
      if (result.ok) {
        setStatus('connected');
        const detail = result.details
          ? `${result.details.user ?? ''}${result.details.workspace ? ' @ ' + result.details.workspace : ''}`
          : 'Conexión exitosa';
        toast.success('Conexión Linear OK', { description: detail });
        if (result.updatedAt) setLastTestedAt(new Date().toISOString());
      } else {
        setStatus('error');
        toast.error('Falló la conexión Linear', {
          description: result.error ?? 'Sin detalles',
        });
      }
    } catch (err) {
      setStatus('error');
      toast.error('Error al probar conexión', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!teamId || !workspaceSlug || !teamName) {
      toast.error('Completa Team Name, Team ID y Workspace Slug');
      return;
    }
    if (!maskedKey && !apiKey) {
      toast.error('Ingresa una API Key — es obligatoria la primera vez');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveLinearConfig({
        ...(apiKey ? { apiKey } : {}),
        teamId,
        teamName,
        workspaceSlug,
        ...(projectId ? { projectId } : {}),
        ...(projectName ? { projectName } : {}),
      });
      setMaskedKey(saved.maskedKey);
      setStatus(saved.status);
      setApiKey(''); // limpiar input — el plaintext ya quedó cifrado en BD
      toast.success('Configuración Linear guardada');
    } catch (err) {
      toast.error('No se pudo guardar la configuración', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await deleteIntegrationConfig('linear');
      // Reset completo del form — la config ya no existe en BD.
      setApiKey('');
      setTeamName('');
      setTeamId('');
      setWorkspaceSlug('');
      setProjectId('');
      setProjectName('');
      setMaskedKey(null);
      setStatus('disconnected');
      setLastTestedAt(null);
      setConfirmingDelete(false);
      toast.success('Integración Linear desconectada', {
        description: 'La API key y la configuración fueron eliminadas.',
      });
    } catch (err) {
      toast.error('No se pudo desconectar Linear', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setDisconnecting(false);
    }
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
            placeholder={maskedKey ?? 'lin_api_...'}
          />
          {maskedKey && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              API key actual: <span className="font-mono">{maskedKey}</span>. Deja en
              blanco para conservarla.
            </p>
          )}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledInput label="Project ID (optional)">
            <Input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="UUID"
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
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusDot status={status} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={testing || loading || (!apiKey && !maskedKey)}
            className="text-muted-foreground hover:text-foreground gap-2"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            Probar conexión
          </Button>
          {lastTestedAt && (
            <span className="text-xs text-muted-foreground/70">
              Validado {new Date(lastTestedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Desconectar — solo si hay config persistida (maskedKey existe).
              Two-step: primer click pide confirmación inline, segundo ejecuta. */}
          {maskedKey && (
            confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-destructive font-medium">
                  ¿Eliminar configuración?
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={disconnecting}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="gap-1.5"
                >
                  {disconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Confirmar
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
                disabled={loading || saving || testing}
                className="text-muted-foreground hover:text-destructive gap-1.5"
                title="Eliminar la API key y la configuración persistida"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Desconectar
              </Button>
            )
          )}
          <SaveButton saving={saving} onClick={handleSave} />
        </div>
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Vault (GitHub-backed)
// ---------------------------------------------------------------------------

interface VaultConfigForm {
  name: string;
  owner: string;
  repo: string;
  branch: string;
  token: string;
  allowedPodIds: string[];
  roleDefaults: Record<string, string>;
}

const EMPTY_VAULT_FORM: VaultConfigForm = {
  name: '',
  owner: '',
  repo: '',
  branch: 'main',
  token: '',
  allowedPodIds: [],
  roleDefaults: Object.fromEntries(
    Object.values(UserRole)
      .filter((r) => r !== UserRole.AltaGerencia && r !== UserRole.Viewer)
      .map((r) => [r, DEFAULT_ROLE_ACCESS[r] || 'viewer']),
  ),
};

function VaultSection() {
  const [vaults, setVaults] = useState<import('@/lib/api/vault-configs').VaultConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // '__new__' para crear
  const [form, setForm] = useState<VaultConfigForm>(EMPTY_VAULT_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [apiPods, setApiPods] = useState<import('@/lib/api/pods').PodResponse[]>([]);

  useEffect(() => {
    import('@/lib/api/pods').then(({ getPods }) => getPods().then(setApiPods).catch(() => {}));
  }, []);

  const loadVaults = useCallback(async () => {
    const { getVaultConfigs } = await import('@/lib/api/vault-configs');
    try {
      const data = await getVaultConfigs();
      setVaults(data);
    } catch (err: any) {
      toast.error(`Error cargando vaults: ${err?.message ?? 'error desconocido'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleActivate = async (id: string, name: string) => {
    setBusyId(id);
    try {
      const { activateVaultConfig } = await import('@/lib/api/vault-configs');
      await activateVaultConfig(id);
      toast.success(`"${name}" es ahora el vault activo`);
      await loadVaults();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error activando vault');
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    void loadVaults();
  }, [loadVaults]);

  // Polling: si algún vault está 'cloning', refrescar cada 2s hasta que termine.
  // Mismo patrón que CodigoSection — así el badge pasa de "Clonando…" a "Listo"
  // sin intervención del usuario.
  useEffect(() => {
    const anyCloning = vaults.some((v) => v.cloneStatus === 'cloning');
    if (!anyCloning) return;
    const interval = setInterval(() => { void loadVaults(); }, 2000);
    return () => clearInterval(interval);
  }, [vaults, loadVaults]);

  const handleSync = async (id: string, name: string) => {
    setSyncing(id);
    try {
      const { syncVaultConfig } = await import('@/lib/api/vault-configs');
      const result = await syncVaultConfig(id);
      if (result.ok) {
        toast.success(`Vault "${name}" sincronizado${result.sha ? ` (${result.sha.slice(0, 7)})` : ''}`);
      } else {
        toast.error(result.message ?? 'Error sincronizando vault');
      }
      await loadVaults();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error sincronizando vault');
    } finally {
      setSyncing(null);
    }
  };

  const startCreate = () => {
    setForm({ ...EMPTY_VAULT_FORM });
    setEditingId('__new__');
  };

  const startEdit = (v: import('@/lib/api/vault-configs').VaultConfig) => {
    setForm({
      name: v.name,
      owner: v.owner,
      repo: v.repo,
      branch: v.branch,
      token: '',
      allowedPodIds: v.allowedPodIds ?? [],
      roleDefaults: {
        // Pre-populate con los valores del vault, o defaults globales si vacío
        ...Object.fromEntries(
          Object.values(UserRole)
            .filter((r) => r !== UserRole.AltaGerencia && r !== UserRole.Viewer)
            .map((r) => [r, (v.roleDefaults ?? {})[r] || DEFAULT_ROLE_ACCESS[r] || 'viewer']),
        ),
      },
    });
    setEditingId(v.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_VAULT_FORM });
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.owner.trim() || !form.repo.trim()) {
      toast.error('Nombre, owner y repo son requeridos');
      return;
    }
    if (editingId === '__new__' && !form.token.trim()) {
      toast.error('Token es requerido para crear un vault');
      return;
    }

    const { createVaultConfig, updateVaultConfig } = await import('@/lib/api/vault-configs');
    try {
      if (editingId === '__new__') {
        await createVaultConfig({
          name: form.name.trim(),
          owner: form.owner.trim(),
          repo: form.repo.trim(),
          branch: form.branch.trim() || 'main',
          token: form.token.trim(),
          allowedPodIds: form.allowedPodIds,
          roleDefaults: form.roleDefaults,
        });
        toast.success(`Vault "${form.name}" creado`);
      } else if (editingId) {
        const data: Parameters<typeof updateVaultConfig>[1] = {
          name: form.name.trim(),
          owner: form.owner.trim(),
          repo: form.repo.trim(),
          branch: form.branch.trim() || 'main',
          allowedPodIds: form.allowedPodIds,
          roleDefaults: form.roleDefaults,
        };
        if (form.token.trim()) data.token = form.token.trim();
        await updateVaultConfig(editingId, data);
        toast.success(`Vault "${form.name}" actualizado`);
      }
      cancelEdit();
      await loadVaults();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error guardando el vault');
    }
  };

  const handleTest = async (id: string) => {
    setBusyId(id);
    setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: '' } }));
    try {
      const { testVaultConfig } = await import('@/lib/api/vault-configs');
      const result = await testVaultConfig(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: err?.message ?? 'Error' } }));
      toast.error(err?.message ?? 'Error probando conexión');
    } finally {
      setBusyId(null);
      setTimeout(() => setTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      }), 5000);
    }
  };

  const requestDelete = (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;
    setBusyId(id);
    try {
      const { deleteVaultConfig } = await import('@/lib/api/vault-configs');
      await deleteVaultConfig(id);
      toast.success(`Vault "${name}" eliminado`);
      await loadVaults();
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Error eliminando vault');
      throw err; // Re-throw para que ConfirmDialog no cierre el modal
    } finally {
      setBusyId(null);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
    <SettingsCard
      title="Vault"
      description="Conecta uno o más repositorios de GitHub como vaults. Los documentos, épicas, historias e iniciativas se guardan como markdown versionado. Puedes restringir el acceso de cada vault a células específicas."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando vaults...
        </div>
      ) : (
        <div className="space-y-3">
          {/* Lista de vaults existentes */}
          {vaults.map((v) => (
            <div
              key={v.id}
              className={cn(
                'rounded-lg border bg-card p-3 space-y-3 transition-colors',
                v.isActive && 'border-primary/40 bg-primary/[0.02]',
              )}
            >
              {editingId === v.id ? (
                <VaultConfigForm
                  form={form}
                  setForm={setForm}
                  onSave={handleSave}
                  onCancel={cancelEdit}
                  isEditing
                  apiPods={apiPods}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn(
                        'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                        v.isActive ? 'bg-primary/10' : 'bg-green-500/10',
                      )}>
                        <Github className={cn('h-4 w-4', v.isActive ? 'text-primary' : 'text-green-600')} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{v.name}</span>
                          {v.isActive && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-0.5">
                              <Check className="h-2.5 w-2.5" />
                              Vinculado
                            </span>
                          )}
                          {v.cloneStatus === 'cloning' && (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Clonando…
                            </span>
                          )}
                          {v.cloneStatus === 'ready' && (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30">
                              <Check className="h-2.5 w-2.5" />
                              Clone listo
                              {v.lastSyncedSha && ` · ${v.lastSyncedSha.slice(0, 7)}`}
                            </span>
                          )}
                          {v.cloneStatus === 'error' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive cursor-help">
                                  Error de clone
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {v.lastSyncError ?? 'Error desconocido'}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {v.cloneStatus === 'stale' && (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                              Desactualizado
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {v.owner}/{v.repo}
                          <span className="font-mono ml-2">@{v.branch}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!v.isActive && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1.5"
                              onClick={() => handleActivate(v.id, v.name)}
                              disabled={busyId === v.id}
                            >
                              {busyId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                              Vincular
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px] text-center">
                            Establece este vault como fuente activa para el dashboard de Proyectos
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5 text-muted-foreground"
                            onClick={() => handleSync(v.id, v.name)}
                            disabled={syncing === v.id || v.cloneStatus === 'cloning'}
                          >
                            {syncing === v.id || v.cloneStatus === 'cloning' ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Sincronizar
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px] text-center">
                          Clona o actualiza el repositorio local. Las tools del agente (vault_glob/grep/read) leen de este clone cuando el vault está vinculado.
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1.5 text-muted-foreground"
                        onClick={() => handleTest(v.id)}
                        disabled={busyId === v.id}
                      >
                        {busyId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                        Probar
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => startEdit(v)}>
                        <Settings className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => requestDelete(v.id, v.name)}
                        disabled={busyId === v.id}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {/* Pod access badges */}
                  {v.allowedPodIds.length > 0 && (
                    <div className="flex items-center gap-1.5 ml-11">
                      {v.allowedPodIds.map(podId => {
                        const pod = apiPods.find(p => p.id === podId);
                        return pod ? (
                          <span key={podId} className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: `${pod.color}40`, color: pod.color, backgroundColor: `${pod.color}10` }}>
                            {pod.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  {v.allowedPodIds.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/60 ml-11">Todas las células tienen acceso</p>
                  )}
                  {testResults[v.id]?.message && (
                    <div className={cn(
                      'text-xs rounded px-2 py-1.5 flex items-center gap-1.5',
                      testResults[v.id].ok
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                        : 'bg-destructive/10 text-destructive',
                    )}>
                      {testResults[v.id].ok ? <Check className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                      {testResults[v.id].message}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Form para agregar nuevo */}
          {editingId === '__new__' ? (
            <div className="rounded-lg border border-dashed bg-card p-3">
              <VaultConfigForm
                form={form}
                setForm={setForm}
                onSave={handleSave}
                onCancel={cancelEdit}
                isEditing={false}
                apiPods={apiPods}
              />
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" /> Agregar vault
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Requisitos del token</p>
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <p>1. Crear un Personal Access Token en GitHub (Settings → Developer settings → Tokens)</p>
          <p>2. Scope requerido: <span className="font-mono">repo</span> (acceso completo al repositorio privado)</p>
          <p>3. Los tokens se encriptan at-rest con AES-256-GCM antes de guardarse</p>
        </div>
      </div>

      {/* Dialog de confirmación para eliminación destructiva — reemplaza el window.confirm() nativo */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        title={`Eliminar vault "${deleteTarget?.name ?? ''}"`}
        description={
          // Advertencia escalada según contexto:
          //  - Si es el último vault: las features de proyectos quedarán
          //    deshabilitadas hasta agregar un vault nuevo.
          //  - Si es el activo (pero hay otros): otro se activará automático.
          //  - Si no es activo: solo se borra la referencia.
          (() => {
            const target = vaults.find((v) => v.id === deleteTarget?.id);
            const isLast = vaults.length === 1;
            const isActive = target?.isActive ?? false;
            const base = 'Esta acción no se puede deshacer. El repositorio de GitHub NO será eliminado — solo se borra la referencia en CENZONTLE. El token encriptado se elimina permanentemente.';
            if (isLast) {
              return `${base}\n\n⚠️ ATENCIÓN: este es el ÚLTIMO vault configurado. Tras borrarlo, las funciones de proyectos (crear/editar iniciativas, épicas e historias) fallarán hasta que agregues un vault nuevo.`;
            }
            if (isActive) {
              return `${base}\n\nEste vault está vinculado como activo. Al borrarlo, el sistema activará automáticamente otro de los vaults configurados.`;
            }
            return base;
          })()
        }
        confirmText="Eliminar vault"
        cancelText="Cancelar"
        onConfirm={confirmDelete}
        destructive
      />
    </SettingsCard>
    </TooltipProvider>
  );
}

function VaultConfigForm({
  form,
  setForm,
  onSave,
  onCancel,
  isEditing,
  apiPods,
}: {
  form: VaultConfigForm;
  setForm: (f: VaultConfigForm) => void;
  onSave: () => void;
  onCancel: () => void;
  isEditing: boolean;
  apiPods: import('@/lib/api/pods').PodResponse[];
}) {
  function togglePod(podId: string) {
    const next = form.allowedPodIds.includes(podId)
      ? form.allowedPodIds.filter((id) => id !== podId)
      : [...form.allowedPodIds, podId];
    setForm({ ...form, allowedPodIds: next });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledInput label="Nombre del vault">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ej: Ecommerce Prod"
            className={inputClasses}
          />
        </LabeledInput>
        <LabeledInput label="Branch">
          <Input
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            placeholder="main"
            className={inputClasses}
          />
        </LabeledInput>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledInput label="Owner (usuario u org)">
          <Input
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
            placeholder="mi-org"
            className={inputClasses}
          />
        </LabeledInput>
        <LabeledInput label="Repositorio">
          <Input
            value={form.repo}
            onChange={(e) => setForm({ ...form, repo: e.target.value })}
            placeholder="mi-vault"
            className={inputClasses}
          />
        </LabeledInput>
      </div>
      <LabeledInput label={isEditing ? 'GitHub Token (dejar vacío para no cambiar)' : 'GitHub Token'}>
        <PasswordField
          value={form.token}
          onChange={(v) => setForm({ ...form, token: v })}
          placeholder={isEditing ? 'ghp_•••••••••• (oculto)' : 'ghp_...'}
        />
      </LabeledInput>

      {/* Selector de células con acceso */}
      {apiPods.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">Células con acceso</label>
          <div className="flex flex-wrap gap-2">
            {apiPods.map((pod) => {
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
            <p className="text-[10px] text-muted-foreground/60 mt-1.5">Sin restricción — todas las células tienen acceso.</p>
          )}
        </div>
      )}

      {/* Permisos por defecto por rol */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Permisos por defecto</label>
        <div className="rounded-lg border border-border/50 overflow-hidden text-xs">
          <div className="grid grid-cols-[1fr_repeat(3,48px)] bg-muted/30 border-b border-border/30">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rol</div>
            {(['owner', 'editor', 'viewer'] as const).map((lvl) => (
              <div key={lvl} className="text-center py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {lvl === 'owner' ? 'Admin' : lvl === 'editor' ? 'Editor' : 'Lector'}
              </div>
            ))}
          </div>
          {Object.values(UserRole)
            .filter((r) => r !== UserRole.AltaGerencia && r !== UserRole.Viewer)
            .map((role) => {
              const current = (form.roleDefaults[role] as AccessLevel) || DEFAULT_ROLE_ACCESS[role] || 'viewer';
              return (
                <div key={role} className="grid grid-cols-[1fr_repeat(3,48px)] items-center border-b border-border/20 last:border-0">
                  <div className="px-2 py-1.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: USER_ROLE_COLORS[role] }} />
                    <span className="font-medium">{USER_ROLE_LABELS[role]}</span>
                  </div>
                  {(['owner', 'editor', 'viewer'] as const).map((lvl) => (
                    <div key={lvl} className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, roleDefaults: { ...form.roleDefaults, [role]: lvl } })}
                        className={cn(
                          'w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center',
                          current === lvl ? 'border-primary bg-primary/10' : 'border-border/50 hover:border-border',
                        )}
                      >
                        {current === lvl && <Check className="h-2.5 w-2.5 text-primary" />}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={onSave}>
          {isEditing ? 'Guardar cambios' : 'Crear vault'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Código (repositorios GitHub para exploración por agentes IA)
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'hace menos de 1 min';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

function CloneStatusBadge({ repo }: { repo: import('@/lib/api/code-repositories').CodeRepository }) {
  const { cloneStatus, lastSyncedSha, lastPulledAt, lastSyncError } = repo;

  if (cloneStatus === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
        Pendiente
      </span>
    );
  }
  if (cloneStatus === 'cloning') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Clonando…
      </span>
    );
  }
  if (cloneStatus === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30">
        <Check className="h-2.5 w-2.5" />
        Listo
        {lastSyncedSha && ` · ${lastSyncedSha.slice(0, 7)}`}
        {lastPulledAt && ` · ${formatRelativeTime(lastPulledAt)}`}
      </span>
    );
  }
  if (cloneStatus === 'error') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive cursor-help">
              Error
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {lastSyncError ?? 'Error desconocido'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
      Desactualizado
    </span>
  );
}

function CodigoSection() {
  const [repos, setRepos] = useState<import('@/lib/api/code-repositories').CodeRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<import('@/lib/api/code-repositories').CodeRepository | null>(null);

  const loadRepos = useCallback(async () => {
    try {
      const { getCodeRepositories } = await import('@/lib/api/code-repositories');
      setRepos(await getCodeRepositories());
    } catch (err: any) {
      toast.error(`Error cargando repositorios: ${err?.message ?? 'error desconocido'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  // Polling: si algún repo está 'cloning', refrescar cada 2s hasta que no queden.
  useEffect(() => {
    const anyCloning = repos.some((r) => r.cloneStatus === 'cloning');
    if (!anyCloning) return;
    const interval = setInterval(loadRepos, 2000);
    return () => clearInterval(interval);
  }, [repos, loadRepos]);

  const handleToggleEnabled = async (id: string, name: string, currentlyEnabled: boolean) => {
    try {
      const { enableCodeRepository, disableCodeRepository } = await import('@/lib/api/code-repositories');
      if (currentlyEnabled) {
        await disableCodeRepository(id);
        toast.success(`"${name}" deshabilitado`);
      } else {
        await enableCodeRepository(id);
        toast.success(`"${name}" habilitado`);
      }
      await loadRepos();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error cambiando estado del repositorio');
    }
  };

  /**
   * Toggle del flag forgeWritable. Cuando activado, el Forge puede clonar,
   * commitear, pushear y abrir PRs en este repo. Opt-in defensivo: por
   * default los repos son read-only para los agentes.
   */
  const handleToggleForgeWritable = async (id: string, name: string, currentlyWritable: boolean) => {
    try {
      const { enableForgeWritable, disableForgeWritable } = await import('@/lib/api/code-repositories');
      if (currentlyWritable) {
        await disableForgeWritable(id);
        toast.success(`Escritura del Forge deshabilitada en "${name}"`);
      } else {
        await enableForgeWritable(id);
        toast.success(
          `Escritura del Forge habilitada en "${name}". El Forge ahora puede abrir PRs aquí.`,
        );
      }
      await loadRepos();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error cambiando permiso de escritura');
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const { testCodeRepository } = await import('@/lib/api/code-repositories');
      const result = await testCodeRepository(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: err?.message ?? 'Error' } }));
    } finally {
      setTesting(null);
    }
  };

  const handleSync = async (id: string) => {
    setSyncing(id);
    try {
      const { syncCodeRepository } = await import('@/lib/api/code-repositories');
      const result = await syncCodeRepository(id);
      if (result.ok) toast.success(`Sincronizado: ${result.sha?.slice(0, 7) ?? ''}`);
      else toast.error(`Error al sincronizar: ${result.message ?? 'desconocido'}`);
      await loadRepos();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al sincronizar');
    } finally {
      setSyncing(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { deleteCodeRepository } = await import('@/lib/api/code-repositories');
      await deleteCodeRepository(deleteTarget.id);
      toast.success(`Repositorio "${deleteTarget.name}" eliminado`);
      setDeleteTarget(null);
      await loadRepos();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error eliminando repositorio');
    }
  };

  return (
    <SettingsCard
      title="Código"
      description="Conecta repositorios de GitHub para que los agentes IA puedan explorar código fuente real (glob, grep, read) con ripgrep. Puedes habilitar múltiples repositorios al mismo tiempo — el agente busca en paralelo sobre todos los habilitados y puede filtrar a uno específico cuando lo necesite."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando repositorios...
        </div>
      ) : (
        <div className="space-y-3">
          {repos.map((r) => (
            <div key={r.id} className={cn(
              'rounded-lg border p-4 space-y-2',
              r.isActive ? 'border-primary/40 bg-primary/[0.02]' : 'border-border/50 bg-card/50',
            )}>
              <div className="flex items-start gap-3">
                <Github className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{r.name}</span>
                    {r.isActive ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                        <Check className="h-2.5 w-2.5" />
                        Habilitado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                        Deshabilitado
                      </span>
                    )}
                    {r.forgeWritable && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                        <PencilLine className="h-2.5 w-2.5" />
                        Forge escribe
                      </span>
                    )}
                    <CloneStatusBadge repo={r} />
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {r.owner}/{r.repo} <span className="text-muted-foreground/60">@{r.branch}</span>
                  </div>
                  {testResults[r.id] && (
                    <div className={cn(
                      'text-[11px] mt-1.5',
                      testResults[r.id].ok ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                    )}>
                      {testResults[r.id].ok ? <Wifi className="h-3 w-3 inline mr-1" /> : <WifiOff className="h-3 w-3 inline mr-1" />}
                      {testResults[r.id].message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant={r.isActive ? 'ghost' : 'default'}
                    onClick={() => handleToggleEnabled(r.id, r.name, r.isActive)}
                    className="gap-1 text-xs"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {r.isActive ? 'Deshabilitar' : 'Habilitar'}
                  </Button>
                  <Button
                    size="sm"
                    variant={r.forgeWritable ? 'ghost' : 'outline'}
                    disabled={!r.isActive}
                    onClick={() => handleToggleForgeWritable(r.id, r.name, r.forgeWritable)}
                    className={cn(
                      'gap-1 text-xs',
                      r.forgeWritable
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10',
                    )}
                    title={
                      !r.isActive
                        ? 'Habilita primero el repo (botón a la izquierda)'
                        : r.forgeWritable
                          ? 'El Forge puede commitear y abrir PRs aquí. Click para deshabilitar.'
                          : 'Click para permitir que el Forge commitee y abra PRs en este repo'
                    }
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                    {r.forgeWritable ? 'Forge: write ✓' : 'Activar Forge write'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSync(r.id)}
                    disabled={syncing === r.id || r.cloneStatus === 'cloning'}
                    className="gap-1 text-xs"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', syncing === r.id && 'animate-spin')} />
                    Sincronizar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleTest(r.id)}
                    disabled={testing === r.id}
                    className="gap-1 text-xs"
                  >
                    {testing === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                    Probar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(r.id)} className="gap-1 text-xs">
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="gap-1 text-xs text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {editingId === r.id && (
                <CodeRepositoryForm
                  existing={r}
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => {
                    setEditingId(null);
                    await loadRepos();
                  }}
                />
              )}
            </div>
          ))}

          {isCreating ? (
            <CodeRepositoryForm
              onCancel={() => setIsCreating(false)}
              onSaved={async () => {
                setIsCreating(false);
                await loadRepos();
              }}
            />
          ) : (
            <Button
              variant="outline"
              onClick={() => setIsCreating(true)}
              className="w-full gap-2 text-sm border-dashed"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar repositorio
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Eliminar repositorio "${deleteTarget?.name ?? ''}"`}
        description="Esto eliminará la configuración y el clone local. Esta acción no se puede deshacer."
        confirmText="Eliminar repositorio"
        onConfirm={handleDelete}
      />
    </SettingsCard>
  );
}

function CodeRepositoryForm({
  existing,
  onCancel,
  onSaved,
}: {
  existing?: import('@/lib/api/code-repositories').CodeRepository;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEditing = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [owner, setOwner] = useState(existing?.owner ?? '');
  const [repo, setRepo] = useState(existing?.repo ?? '');
  const [branch, setBranch] = useState(existing?.branch ?? 'main');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name || !owner || !repo) {
      toast.error('Nombre, owner y repo son requeridos');
      return;
    }
    if (!isEditing && !token) {
      toast.error('Token es requerido al crear un repositorio');
      return;
    }
    setSaving(true);
    try {
      const { createCodeRepository, updateCodeRepository } = await import('@/lib/api/code-repositories');
      if (isEditing && existing) {
        const payload: import('@/lib/api/code-repositories').UpdateCodeRepositoryInput = {
          name, owner, repo, branch,
        };
        if (token) payload.token = token;
        await updateCodeRepository(existing.id, payload);
        toast.success('Repositorio actualizado');
      } else {
        await createCodeRepository({ name, owner, repo, branch, token });
        toast.success('Repositorio creado — el clone inicial se está ejecutando en background');
      }
      await onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error guardando el repositorio');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-primary/30 bg-primary/[0.02] space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mi-backend" />
        </LabeledInput>
        <LabeledInput label="Branch">
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
        </LabeledInput>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Owner">
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="AeromexicoTech" />
        </LabeledInput>
        <LabeledInput label="Repositorio">
          <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="booking-service" />
        </LabeledInput>
      </div>
      <LabeledInput label={isEditing ? 'Nuevo token (opcional)' : 'GitHub Personal Access Token'}>
        <div className="relative">
          <Input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={isEditing ? 'Dejar vacío para mantener el actual' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </LabeledInput>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {isEditing ? 'Guardar cambios' : 'Crear repositorio'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Compute Nodes
// ---------------------------------------------------------------------------

/**
 * Sección "Gestión de flota" — conectada al backend real.
 *
 * Polling cada 5s desde `GET /factory/nodes` para mostrar status live de
 * los nodos. Cuando el user crea un nodo nuevo, se persiste inmediatamente
 * vía POST /factory/nodes (no batch save). Eliminar nodo es soft delete
 * en el backend (preserva histórico para auditoría).
 *
 * El comando hardcodeado ya no muestra `<YOUR_TOKEN>` placeholder — ahora
 * cada nodo tiene su botón "Token" que abre `GenerateTokenDialog` y muestra
 * el comando completo con plaintext one-time.
 */
function ComputeNodesSection() {
  const [nodes, setNodes] = useState<ComputeNodeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeType, setNewNodeType] = useState<ComputeNodeType>('mac_mini');
  const [newNodeSlots, setNewNodeSlots] = useState(2);
  const [tokenDialogNode, setTokenDialogNode] = useState<{ id: string; name: string } | null>(null);
  // Estado de edición inline de `totalSlots`. Solo UN nodo en edit a la vez —
  // si el user hace click en otra celda mientras edita, descartamos el edit
  // anterior y abrimos el nuevo (UX simple, sin "draft state" persistente).
  const [editingSlots, setEditingSlots] = useState<{ id: string; value: string } | null>(null);
  const [savingSlots, setSavingSlots] = useState(false);

  const fetchNodes = useCallback(async () => {
    try {
      const result = await getComputeNodes();
      setNodes(result);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        // 401 lo maneja el client wrapper redirigiendo al login. Otros
        // errores los logueamos pero no rompemos el dashboard.
        console.warn('[Fleet] failed to fetch nodes', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Hidratación inicial + polling 5s para refresh de heartbeat status.
  useEffect(() => {
    void fetchNodes();
    const interval = setInterval(() => void fetchNodes(), 5_000);
    return () => clearInterval(interval);
  }, [fetchNodes]);

  const handleCreate = async () => {
    if (!newNodeName.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createComputeNode({
        name: newNodeName.trim(),
        type: newNodeType,
        totalSlots: newNodeSlots,
      });
      setNodes((prev) => [created, ...prev]);
      setNewNodeName('');
      setNewNodeType('mac_mini');
      setNewNodeSlots(2);
      toast.success(`Nodo "${created.name}" creado. Genera un token para conectarlo.`);
      // Auto-abre el dialog de token para que el user no tenga que hacer
      // un click adicional — flow más fluido.
      setTokenDialogNode({ id: created.id, name: created.name });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al crear nodo';
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  /**
   * Guarda el nuevo `totalSlots` para un nodo. Validación: 1-32 (mismo
   * rango que el form de creación). Si el valor no cambió, evitamos el
   * round-trip al backend. Si falla, restauramos el estado previo y
   * mostramos un toast.
   */
  const handleSaveSlots = async (nodeId: string) => {
    if (!editingSlots || editingSlots.id !== nodeId) return;
    const parsed = parseInt(editingSlots.value, 10);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      setEditingSlots(null);
      return;
    }
    // Validación: rango [1, 32] como el form de creación
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 32) {
      toast.error('Slots debe ser un número entre 1 y 32');
      return;
    }
    // No-op si el valor no cambió
    if (parsed === node.totalSlots) {
      setEditingSlots(null);
      return;
    }
    setSavingSlots(true);
    try {
      const updated = await updateComputeNode(nodeId, { totalSlots: parsed });
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? updated : n)));
      toast.success(`Slots de "${node.name}" actualizado a ${parsed}`);
      setEditingSlots(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al actualizar slots';
      toast.error(message);
    } finally {
      setSavingSlots(false);
    }
  };

  const handleDelete = async (node: ComputeNodeResponse) => {
    try {
      await deleteComputeNode(node.id);
      setNodes((prev) => prev.filter((n) => n.id !== node.id));
      toast.success(`Nodo "${node.name}" retirado`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al retirar nodo';
      toast.error(message);
    }
  };

  const typeOptions: { value: ComputeNodeType; label: string }[] = [
    { value: 'local', label: 'Local' },
    { value: 'mac_mini', label: 'Mac Mini' },
    { value: 'cloud_vm', label: 'Cloud VM' },
    { value: 'gpu_instance', label: 'GPU Instance' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <SettingsCard
      title="Gestión de flota"
      description="Administra los nodos de cómputo de tu factory. Cada nodo puede ejecutar múltiples agentes concurrentes. Status se refresca cada 5s."
    >
      {loading && nodes.length === 0 ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando nodos...
        </div>
      ) : (
        <>
          {/* Column headers — alineación pixel-perfect con las filas.
              Las filas tienen `border` (1px) + `px-3` (12px) = offset 13px.
              El header replica EXACTAMENTE eso con `border border-transparent`
              + `px-3` para que el box-model sea idéntico — sin esto, el
              padding numérico nunca alinea por la diferencia del border. */}
          <div className="mb-3 grid grid-cols-[1fr_140px_80px_80px_90px_40px] items-center gap-3 border border-transparent px-3">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Name</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Type</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Slots</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 text-center">Status</span>
            {/* Header TOKEN: replicamos la estructura visual del botón
                "Generar" de cada fila (ml-auto + flex + gap-1 + px-2 +
                placeholder del icon) para que el texto del header se
                alinee EXACTAMENTE con el texto del botón debajo. */}
            <span className="ml-auto inline-flex items-center gap-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              <span aria-hidden="true" className="inline-block h-3 w-3" />
              Token
            </span>
            <span />
          </div>

          <div className="space-y-2">
            {nodes.map((node) => (
              <div
                key={node.id}
                className="grid grid-cols-[1fr_140px_80px_80px_90px_40px] items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs font-medium truncate">{node.name}</span>
                  {node.os && (
                    <span className="text-[10px] text-muted-foreground/60 truncate">
                      {node.os}
                    </span>
                  )}
                </div>

                <span className="text-xs text-muted-foreground capitalize">
                  {node.type.replace('_', ' ')}
                </span>

                {/* Slots editable inline. Click en el número → input;
                    Enter o blur → save vía PATCH /factory/nodes/:id;
                    Escape → cancela sin save. */}
                {editingSlots?.id === node.id ? (
                  <Input
                    type="number"
                    min={1}
                    max={32}
                    autoFocus
                    value={editingSlots.value}
                    onChange={(e) => setEditingSlots({ id: node.id, value: e.target.value })}
                    onBlur={() => void handleSaveSlots(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleSaveSlots(node.id);
                      } else if (e.key === 'Escape') {
                        setEditingSlots(null);
                      }
                    }}
                    disabled={savingSlots}
                    className={cn(inputClasses, 'h-7 w-14 text-xs tabular-nums')}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingSlots({ id: node.id, value: String(node.totalSlots) })}
                    className="text-xs tabular-nums text-left hover:bg-muted/50 rounded px-1 py-0.5 -mx-1 transition-colors"
                    aria-label={`Editar slots de ${node.name}`}
                  >
                    {node.totalSlots}
                  </button>
                )}

                <span
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    node.effectiveStatus === 'online'
                      ? 'bg-[#22C55E]/10 text-[#22C55E]'
                      : node.effectiveStatus === 'degraded'
                        ? 'bg-amber-500/10 text-amber-500'
                        : 'bg-[#5A5A6E]/10 text-muted-foreground/70',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      node.effectiveStatus === 'online'
                        ? 'bg-[#22C55E]'
                        : node.effectiveStatus === 'degraded'
                          ? 'bg-amber-500'
                          : 'bg-[#5A5A6E]',
                    )}
                  />
                  {node.effectiveStatus}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTokenDialogNode({ id: node.id, name: node.name })}
                  className="h-7 px-2 text-[11px] gap-1 ml-auto text-muted-foreground hover:text-foreground"
                >
                  <Terminal className="h-3 w-3" />
                  Generar
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(node)}
                  className="h-8 w-8 p-0 text-muted-foreground/70 hover:text-red-400 hover:bg-red-500/10"
                  aria-label={`Retirar ${node.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {nodes.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center">
              <Server className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground/70">
                No hay nodos de cómputo configurados. Crea el primero abajo.
              </p>
            </div>
          )}

          {/* Crear nuevo nodo — formulario inline alineado a las mismas
              columnas que las filas de nodos (1fr / 140 / 80 / 80 / 90 / 40).
              El botón "Crear nodo" abarca las últimas 2 columnas (status +
              token + delete) para tener espacio cómodo sin texto cortado. */}
          <div className="mt-5 pt-5 border-t border-border">
            <div className="grid grid-cols-[1fr_140px_80px_80px_90px_40px] items-center gap-3 border border-transparent px-3">
              <Input
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder="Nombre del nodo (ej: MacBook Pro Sala Pods)"
                className={cn(inputClasses, 'h-8 text-xs')}
                disabled={creating}
              />
              <Select
                value={newNodeType}
                onValueChange={(v) => setNewNodeType(v as ComputeNodeType)}
                disabled={creating}
              >
                <SelectTrigger className={cn(inputClasses, 'h-8 w-full text-xs')}>
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
                max={32}
                value={newNodeSlots}
                onChange={(e) => setNewNodeSlots(Math.max(1, Math.min(32, parseInt(e.target.value) || 1)))}
                className={cn(inputClasses, 'h-8 text-xs')}
                disabled={creating}
              />
              <Button
                size="sm"
                onClick={() => void handleCreate()}
                disabled={!newNodeName.trim() || creating}
                className="col-span-3 gap-1.5"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Crear nodo
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-2 px-4">
              Después de crear el nodo, genera un token y ejecuta{' '}
              <code className="font-mono text-foreground/70">factory-worker register</code> en la
              máquina destino para conectarla.
            </p>
          </div>
        </>
      )}

      {/* Modal generador de token (one-time) */}
      <GenerateTokenDialog
        open={tokenDialogNode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTokenDialogNode(null);
            void fetchNodes();
          }
        }}
        nodeId={tokenDialogNode?.id ?? null}
        nodeName={tokenDialogNode?.name ?? ''}
      />
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

// Tipo local del row del DodSection. Mantiene paridad con el shape del
// API (`@/lib/api/dod`) — text+description son los campos del operador,
// el resto son metadata para persistir.
interface DodCriterion {
  id: string;
  /** Kind estable solo en criterios estándar; null para custom. */
  kind: string | null;
  text: string;
  /** Descripción larga inyectada en el prompt del agente. REQUERIDA — todos
   *  los criterios deben tener descripción para dar contexto al agente. */
  description: string;
  position: number;
}

function SortableDodRow({
  criterion,
  onEdit,
  onRemove,
}: {
  criterion: DodCriterion;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: criterion.id,
  });

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
      className="grid grid-cols-[1fr_auto] gap-2 px-4 py-3 items-center border-b border-border last:border-b-0 bg-card"
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none shrink-0"
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors" />
        </button>
        <span className="flex-1 min-w-0 text-sm text-foreground truncate">{criterion.text}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
          title="Editar criterio"
        >
          <PencilLine className="h-3 w-3" />
        </button>
        <button
          onClick={onRemove}
          className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Borrar criterio"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function DodSection() {
  const [criteria, setCriteria] = useState<DodCriterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Dialog modal usado para AMBOS create y edit. Se reusa el mismo
  // componente porque el shape es idéntico: inputs para text + description.
  //   - Create: `creatingNew = true`, `editingItemId = null` → submit agrega al array
  //   - Edit:   `editingItemId !== null` → submit actualiza el existing
  // Solo uno de los dos modos puede estar activo a la vez.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const isDialogOpen = creatingNew || editingItemId !== null;
  // Confirm dialog para "Restaurar defaults". Es action server-side (POST
  // que pisa los criterios estándar y reordena custom). El dialog usa el
  // ConfirmDialog del repo que maneja el busy state internamente.
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Carga inicial desde el backend. Todo lo que está en la lista es activo
  // por construcción (los campos `enabled`/`required` se eliminaron en
  // migration 20260512 — eran scaffolding sin UI).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listDodCriteria();
        if (!cancelled) {
          setCriteria(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recalcula `position` para reflejar el orden actual del array. El
  // backend lo guarda y la UI lo respeta al rehidratar.
  function reindexPositions(arr: DodCriterion[]): DodCriterion[] {
    return arr.map((c, i) => ({ ...c, position: i }));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCriteria((prev) => {
        const oldIndex = prev.findIndex((c) => c.id === active.id);
        const newIndex = prev.findIndex((c) => c.id === over.id);
        return reindexPositions(arrayMove(prev, oldIndex, newIndex));
      });
      setDirty(true);
    }
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => reindexPositions(prev.filter((c) => c.id !== id)));
    if (editingItemId === id) {
      // Si el row borrado estaba siendo editado, cerrar el dialog.
      cancelDialog();
    }
    setDirty(true);
  }

  function startEdit(c: DodCriterion) {
    setEditingItemId(c.id);
    setCreatingNew(false);
    setDraftText(c.text);
    setDraftDescription(c.description ?? '');
  }

  function startCreate() {
    setCreatingNew(true);
    setEditingItemId(null);
    setDraftText('');
    setDraftDescription('');
  }

  /**
   * Submit del dialog. Decide qué hacer según el modo:
   *   - editingItemId !== null → actualiza el existing
   *   - creatingNew              → agrega al final del array
   * Ambos campos (text y description) son REQUERIDOS — si cualquiera
   * queda vacío tras trim, no hace nada y mantiene el dialog abierto
   * (el botón confirm está disabled visualmente igual, pero validamos
   * acá por defensa contra teclado/scripts).
   */
  function commitDialog() {
    const trimmedText = draftText.trim();
    const trimmedDescription = draftDescription.trim();
    if (trimmedText.length === 0 || trimmedDescription.length === 0) return;

    if (editingItemId !== null) {
      setCriteria((prev) =>
        prev.map((c) =>
          c.id === editingItemId
            ? { ...c, text: trimmedText, description: trimmedDescription }
            : c,
        ),
      );
    } else if (creatingNew) {
      setCriteria((prev) => [
        ...prev,
        {
          id: `custom-${Date.now()}`,
          kind: null,
          text: trimmedText,
          description: trimmedDescription,
          position: prev.length,
        },
      ]);
    }
    cancelDialog();
    setDirty(true);
  }

  function cancelDialog() {
    setEditingItemId(null);
    setCreatingNew(false);
    setDraftText('');
    setDraftDescription('');
  }

  async function handleResetDefaults() {
    // Llamado por el ConfirmDialog. Si falla, lanzamos para que el dialog
    // se quede abierto y el operador vea el toast/error y pueda reintentar.
    setError(null);
    try {
      const result = await resetDodCriteriaDefaults();
      // Actualizamos state local con los criterios canónicos. dirty=false
      // porque el reset YA persistió server-side; lo que está en pantalla
      // matchea exactamente lo que está en DB.
      setCriteria(result);
      setDirty(false);
      // Si había algo siendo editado o creando, cerrar el dialog (su id
      // pudo haberse invalidado por el reset).
      cancelDialog();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // El modelo no expone toggles — todo lo guardado es activo por
      // construcción. Los campos `enabled`/`required` se eliminaron en
      // migration 20260512 por ser scaffolding sin UI.
      const result = await upsertDodCriteria(
        criteria.map((c) => ({
          kind: c.kind,
          text: c.text,
          description: c.description,
          position: c.position,
        })),
      );
      setCriteria(result);
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-border bg-card p-6">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-foreground">Definition of Done</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">Define los criterios que cada agente debe cumplir antes de marcar una historia como completada. Todos los criterios listados son requeridos y bloquean el merge si no se cumplen.</p>
      </div>
      <div className="flex-1 flex flex-col min-h-0 gap-4">
        {/* Summary + save button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{criteria.length} {criteria.length === 1 ? 'criterio' : 'criterios'}</span>
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-[11px] text-red-400 max-w-xs truncate" title={error}>
                Error: {error}
              </span>
            )}
            {dirty && !saving && !error && (
              <span className="text-[11px] text-amber-400">Cambios sin guardar</span>
            )}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={startCreate}
                    disabled={loading || saving}
                    className="flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  Agregar nuevo criterio
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setResetDialogOpen(true)}
                    disabled={loading || saving}
                    className="flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  Restaurar criterios estándar (preserva los custom)
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSave}
                    disabled={!dirty || saving || loading}
                    className="flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  {saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Sin cambios'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Criteria list with drag-and-drop */}
        <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border overflow-hidden">
          {/* Header */}
          <div className="shrink-0 grid grid-cols-[1fr_32px] gap-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 border-b border-border bg-muted/30">
            <span>Criterio</span>
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
                    onEdit={() => startEdit(criterion)}
                    onRemove={() => removeCriterion(criterion.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>

      </div>

      {/* Dialog usado para AMBOS create y edit. El title/botón cambian según
          el modo. Aplica al state local (marca dirty) — el persist al backend
          ocurre al apretar Save de toda la lista, no aquí. */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) cancelDialog();
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {creatingNew ? 'Agregar criterio' : 'Editar criterio'}
            </DialogTitle>
            <DialogDescription>
              El texto aparece en la lista del DoD. La descripción se inyecta en el prompt del agente para darle contexto sobre qué se espera de este criterio.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="dod-edit-text">
                Criterio
              </label>
              <Input
                id="dod-edit-text"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                maxLength={500}
                className="text-sm"
                placeholder="Ej. Tests pasando ≥ 90% cobertura"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    commitDialog();
                  }
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="dod-edit-description"
              >
                Descripción <span className="text-muted-foreground/50">(requerida, para el agente)</span>
              </label>
              <textarea
                id="dod-edit-description"
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                maxLength={2000}
                rows={6}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[120px]"
                placeholder="Detalles del criterio que el agente leerá en el prompt — qué se espera, cómo verificar, qué evitar."
              />
              <span className="text-[10px] text-muted-foreground/60 text-right">
                {draftDescription.length}/2000
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={cancelDialog}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={commitDialog}
              disabled={
                draftText.trim().length === 0 || draftDescription.trim().length === 0
              }
            >
              {creatingNew ? 'Agregar' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog para "Restaurar defaults". Acción destructiva
          — pisa las ediciones del operador a los criterios estándar. Los
          custom (kind=null) sobreviven. Behavior server-side: persiste
          inmediatamente, no necesita Save posterior. */}
      <ConfirmDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        title="Restaurar criterios estándar"
        description="Esto pisará text y descripción de los 7 criterios estándar (Código escrito, Cumple criterios de aceptación, Tests pasando, Sin errores, Sin vulnerabilidades de seguridad, PR creado, Documentación) con sus valores originales basados en estándares de industria (Atlassian, Scrum.org, Codacy, DORA). Tus criterios custom NO se afectan — sobreviven al final de la lista. Esta acción se aplica inmediatamente."
        confirmText="Restaurar"
        onConfirm={handleResetDefaults}
        destructive
      />
    </div>
  );
}

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'branches':
      return <BranchStrategySection />;
    case 'linear':
      return <LinearSection />;
    case 'vault':
      return <VaultSection />;
    case 'codigo':
      return <CodigoSection />;
    case 'external-secrets':
      return <ExternalSecretsSection />;
    case 'nodes':
      return <ComputeNodesSection />;
    case 'kill-switch':
      return <ForgeKillSwitchSection />;
    case 'agent-tokens':
      return <AgentTokensSection />;
    case 'anthropic-key':
      return <AnthropicApiKeySection />;
    case 'dod':
      return <DodSection />;
    case 'pods':
      return <PodsSection />;
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
  const { hasRole, isLoading } = useAuthContext();
  // Default section: 'codigo' es la primera del sidebar (Control de código).
  // Antes era 'repository' que ya no existe (la tarjeta mockeada se eliminó).
  const initialSection = (searchParams.get('section') as SettingsSection) || 'codigo';
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);

  // Redirect como efecto, no durante render — evita ReferenceError: location is not defined
  // en SSR cuando el contexto aún no está hidratado.
  //
  // CRÍTICO: esperar a que `isLoading=false` antes de evaluar autorización.
  // Si refrescamos la página, durante la hidratación de Auth0 el currentUser
  // es null y `hasRole(AltaGerencia)` retorna false → el effect dispararía
  // el redirect a /factory antes de que la auth termine de cargar. El gate
  // de `isLoading` previene esa race condition (bug 2026-05-06).
  const authorized = hasRole(UserRole.AltaGerencia);
  useEffect(() => {
    if (isLoading) return;
    if (!authorized) router.replace('/factory');
  }, [authorized, isLoading, router]);

  // Durante loading: render null (sin redirect aún). Solo bloqueamos cuando
  // ya sabemos con certeza que el user no está autorizado.
  if (isLoading) return null;
  if (!authorized) return null;

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
            const items = SIDEBAR_ITEMS.filter((item) => item.group === group)
              .filter((item) => {
                if (item.group === 'Ecosistema' && !hasRole(UserRole.AltaGerencia)) return false;
                return true;
              });
            if (items.length === 0) return null;
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
