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
import {
  BarChart3,
  TicketCheck,
  Eye,
  EyeOff,
  Loader2,
  Unplug,
  ExternalLink,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIntegrations } from '@/context/IntegrationsContext';

// ---------------------------------------------------------------------------
// Types (aligned with @/types/integrations)
// ---------------------------------------------------------------------------

type Provider = 'linear' | 'jira';
type ConnectionStatus = 'disconnected' | 'connected' | 'testing' | 'error';

interface LinearFields {
  apiKey: string;
  teamName: string;
  teamId: string;
  workspaceSlug: string;
  projectName: string;
}

interface JiraFields {
  email: string;
  apiToken: string;
  domain: string;
  projectKey: string;
  projectName: string;
  defaultIssueType: string;
  storyPointsFieldId: string;
}

interface FieldMapping {
  storyTitle: string;
  storyDescription: string;
  storyPoints: string;
  priority: string;
  labels: string;
  epicParent: string;
  status: string;
  assignee: string;
}

const DEFAULT_LINEAR_FIELDS: LinearFields = {
  apiKey: '',
  teamName: '',
  teamId: '',
  workspaceSlug: '',
  projectName: '',
};

const DEFAULT_JIRA_FIELDS: JiraFields = {
  email: '',
  apiToken: '',
  domain: '',
  projectKey: '',
  projectName: '',
  defaultIssueType: 'Story',
  storyPointsFieldId: 'customfield_10016',
};

const LINEAR_DEFAULT_MAPPING: FieldMapping = {
  storyTitle: 'title',
  storyDescription: 'description',
  storyPoints: 'estimate',
  priority: 'priority',
  labels: 'labelIds',
  epicParent: 'parentId',
  status: 'stateId',
  assignee: 'assigneeId',
};

const JIRA_DEFAULT_MAPPING: FieldMapping = {
  storyTitle: 'summary',
  storyDescription: 'description',
  storyPoints: 'customfield_10016',
  priority: 'priority',
  labels: 'labels',
  epicParent: 'parent',
  status: 'status',
  assignee: 'assignee',
};

const FIELD_LABELS: Record<keyof FieldMapping, string> = {
  storyTitle: 'Titulo',
  storyDescription: 'Descripcion',
  storyPoints: 'Story Points',
  priority: 'Prioridad',
  labels: 'Labels',
  epicParent: 'Epica padre',
  status: 'Estado',
  assignee: 'Asignado a',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IntegrationSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  selected,
  onSelect,
}: {
  provider: Provider;
  selected: boolean;
  onSelect: () => void;
}) {
  const isLinear = provider === 'linear';
  const Icon = isLinear ? BarChart3 : TicketCheck;
  const name = isLinear ? 'Linear' : 'Jira';
  const description = isLinear
    ? 'GraphQL API — sincroniza con equipos de Linear'
    : 'REST API v3 — conecta con Jira Cloud';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-xl border p-4 cursor-pointer transition-all text-left w-full',
        'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : 'border-border opacity-60 hover:opacity-100'
      )}
      aria-pressed={selected}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            selected
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
        <div
          className={cn(
            'ml-auto h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
            selected
              ? 'border-primary bg-primary'
              : 'border-muted-foreground/40 bg-transparent'
          )}
        >
          {selected && (
            <div className="h-full w-full flex items-center justify-center">
              <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  id,
  helpText,
  helpUrl,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id: string;
  helpText?: string;
  helpUrl?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {helpText && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <p>{helpText}</p>
                {helpUrl && (
                  <a
                    href={helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1 mt-1"
                  >
                    Ver documentacion <ExternalLink className="size-3" />
                  </a>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-9"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? 'Ocultar' : 'Mostrar'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  id,
  helpText,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id: string;
  helpText?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {helpText && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <p>{helpText}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; label: string }> = {
    disconnected: { color: 'bg-muted-foreground/40', label: 'Sin conexion' },
    testing: { color: 'bg-yellow-500 animate-pulse', label: 'Probando...' },
    connected: { color: 'bg-emerald-500', label: 'Conectado' },
    error: { color: 'bg-red-500', label: 'Error' },
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

export function IntegrationSettingsDialog({
  open,
  onOpenChange,
}: IntegrationSettingsDialogProps) {
  const { dispatch } = useIntegrations();
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Provider form fields
  const [linearFields, setLinearFields] = useState<LinearFields>(DEFAULT_LINEAR_FIELDS);
  const [jiraFields, setJiraFields] = useState<JiraFields>(DEFAULT_JIRA_FIELDS);

  // Field mapping
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>(LINEAR_DEFAULT_MAPPING);

  // ---- helpers ----

  const updateLinear = useCallback(
    <K extends keyof LinearFields>(key: K, value: LinearFields[K]) => {
      setLinearFields((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateJira = useCallback(
    <K extends keyof JiraFields>(key: K, value: JiraFields[K]) => {
      setJiraFields((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateMapping = useCallback(
    <K extends keyof FieldMapping>(key: K, value: string) => {
      setFieldMapping((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSelectProvider = (provider: Provider) => {
    setSelectedProvider(provider);
    setConnectionStatus('disconnected');
    setLastSynced(null);
    setErrorMessage(null);
    setFieldMapping(
      provider === 'linear' ? LINEAR_DEFAULT_MAPPING : JIRA_DEFAULT_MAPPING
    );
  };

  const canTest = (): boolean => {
    if (!selectedProvider) return false;
    if (selectedProvider === 'linear') {
      return !!(linearFields.apiKey && linearFields.teamId);
    }
    return !!(jiraFields.email && jiraFields.apiToken && jiraFields.domain && jiraFields.projectKey);
  };

  const handleTestConnection = () => {
    if (!canTest()) return;
    setConnectionStatus('testing');
    setErrorMessage(null);

    // Simulate API call — in production this would call:
    // Linear: POST https://api.linear.app/graphql with { query: "{ viewer { id name } }" }
    // Jira: GET https://{domain}.atlassian.net/rest/api/3/myself with Basic Auth
    setTimeout(() => {
      const success = Math.random() > 0.2; // 80% success for demo
      if (success) {
        setConnectionStatus('connected');
        setLastSynced(new Date().toLocaleString('es-MX'));
      } else {
        setConnectionStatus('error');
        setErrorMessage(
          selectedProvider === 'linear'
            ? 'No se pudo autenticar con Linear. Verifica que el API Key sea valido y tenga scope "read".'
            : 'No se pudo conectar con Jira. Verifica email, API token y dominio.'
        );
      }
    }, 1500);
  };

  const handleDisconnect = () => {
    setConnectionStatus('disconnected');
    setLastSynced(null);
    setErrorMessage(null);
  };

  const handleSave = () => {
    if (selectedProvider === 'linear' && connectionStatus === 'connected') {
      dispatch({
        type: 'CONNECT_LINEAR',
        payload: {
          apiKey: linearFields.apiKey,
          config: {
            apiKey: linearFields.apiKey,
            teamId: linearFields.teamId,
            teamName: linearFields.teamName,
            workspaceSlug: linearFields.workspaceSlug,
            projectId: null,
            projectName: linearFields.projectName || null,
          },
        },
      });
      dispatch({ type: 'UPDATE_FIELD_MAPPING', payload: fieldMapping });
    } else if (selectedProvider === 'jira' && connectionStatus === 'connected') {
      dispatch({
        type: 'CONNECT_JIRA',
        payload: {
          apiToken: jiraFields.apiToken,
          config: {
            email: jiraFields.email,
            apiToken: jiraFields.apiToken,
            domain: jiraFields.domain,
            projectKey: jiraFields.projectKey,
            projectName: jiraFields.projectName,
            defaultIssueType: jiraFields.defaultIssueType,
            storyPointsFieldId: jiraFields.storyPointsFieldId,
          },
        },
      });
      dispatch({ type: 'UPDATE_FIELD_MAPPING', payload: fieldMapping });
    } else if (selectedProvider) {
      dispatch({ type: 'SET_PROVIDER', payload: selectedProvider });
    }
    onOpenChange(false);
  };

  const maskedKey = (key: string) => {
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  };

  // ---- render helpers ----

  const renderLinearForm = () => (
    <div className="space-y-3">
      <PasswordField
        id="linear-api-key"
        label="API Key"
        value={linearFields.apiKey}
        onChange={(v) => updateLinear('apiKey', v)}
        placeholder="lin_api_..."
        helpText="Genera un API key personal en Linear: Settings > Account > Security & Access > API"
      />
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput
          id="linear-team-name"
          label="Team Name"
          value={linearFields.teamName}
          onChange={(v) => updateLinear('teamName', v)}
          placeholder="Mi equipo"
          helpText="Nombre del equipo en Linear (informativo)"
        />
        <LabeledInput
          id="linear-team-id"
          label="Team ID"
          value={linearFields.teamId}
          onChange={(v) => updateLinear('teamId', v)}
          placeholder="UUID del equipo"
          helpText="UUID del equipo. Consultalo en Linear via GraphQL: { teams { nodes { id name } } }"
        />
      </div>
      <LabeledInput
        id="linear-workspace"
        label="Workspace Slug"
        value={linearFields.workspaceSlug}
        onChange={(v) => updateLinear('workspaceSlug', v)}
        placeholder="mi-empresa"
        helpText="El slug de tu workspace en la URL de Linear: linear.app/{slug}/..."
      />
      <LabeledInput
        id="linear-project"
        label={'Proyecto'}
        value={linearFields.projectName}
        onChange={(v) => updateLinear('projectName', v)}
        placeholder="Nombre del proyecto (opcional)"
      />
    </div>
  );

  const renderJiraForm = () => (
    <div className="space-y-3">
      <LabeledInput
        id="jira-email"
        label="Email"
        value={jiraFields.email}
        onChange={(v) => updateJira('email', v)}
        placeholder="usuario@empresa.com"
        helpText="El email de tu cuenta de Atlassian. Se usa junto con el API token como Basic Auth."
      />
      <PasswordField
        id="jira-api-token"
        label="API Token"
        value={jiraFields.apiToken}
        onChange={(v) => updateJira('apiToken', v)}
        placeholder="ATATT3xFfGF0..."
        helpText="Genera un token en id.atlassian.com/manage-profile/security/api-tokens"
        helpUrl="https://id.atlassian.com/manage-profile/security/api-tokens"
      />
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <label htmlFor="jira-domain" className="text-sm font-medium">
            Dominio
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <p>Solo el subdominio. Si tu Jira es https://mi-empresa.atlassian.net, escribe solo &quot;mi-empresa&quot;</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-0">
          <Input
            id="jira-domain"
            value={jiraFields.domain}
            onChange={(e) => updateJira('domain', e.target.value)}
            placeholder="mi-empresa"
            className="rounded-r-none"
          />
          <span className="inline-flex h-9 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground whitespace-nowrap">
            .atlassian.net
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput
          id="jira-project-key"
          label="Project Key"
          value={jiraFields.projectKey}
          onChange={(v) => updateJira('projectKey', v)}
          placeholder="PROJ"
          helpText="Clave del proyecto en Jira (ej: PROJ, ENG). Se encuentra en la URL de tu proyecto."
        />
        <LabeledInput
          id="jira-project-name"
          label="Nombre del proyecto"
          value={jiraFields.projectName}
          onChange={(v) => updateJira('projectName', v)}
          placeholder="Mi Proyecto"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput
          id="jira-issue-type"
          label="Issue Type"
          value={jiraFields.defaultIssueType}
          onChange={(v) => updateJira('defaultIssueType', v)}
          placeholder="Story"
          helpText="Tipo de issue por defecto al crear tarjetas: Story, Task, Bug, etc."
        />
        <LabeledInput
          id="jira-sp-field"
          label="Story Points Field ID"
          value={jiraFields.storyPointsFieldId}
          onChange={(v) => updateJira('storyPointsFieldId', v)}
          placeholder="customfield_10016"
          helpText="Jira usa un custom field para Story Points. Verifica el ID en Admin > Issues > Custom Fields."
        />
      </div>
    </div>
  );

  const isConnected = connectionStatus === 'connected';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Integraciones</DialogTitle>
          <DialogDescription>
            Conecta tu herramienta de gestion de proyectos para sincronizar epicas e historias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* ---- Provider selection ---- */}
          <section>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Proveedor
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ProviderCard
                provider="linear"
                selected={selectedProvider === 'linear'}
                onSelect={() => handleSelectProvider('linear')}
              />
              <ProviderCard
                provider="jira"
                selected={selectedProvider === 'jira'}
                onSelect={() => handleSelectProvider('jira')}
              />
            </div>
          </section>

          {/* ---- Connection form ---- */}
          {selectedProvider && (
            <section>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Credenciales
              </p>
              {selectedProvider === 'linear' ? renderLinearForm() : renderJiraForm()}
            </section>
          )}

          {/* ---- Connection status + actions ---- */}
          {selectedProvider && (
            <section className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="flex flex-col gap-1">
                <StatusIndicator status={connectionStatus} />
                {isConnected && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>
                      Clave:{' '}
                      <span className="font-mono">
                        {maskedKey(
                          selectedProvider === 'linear'
                            ? linearFields.apiKey
                            : jiraFields.apiToken
                        )}
                      </span>
                    </p>
                    {lastSynced && <p>Ultima sync: {lastSynced}</p>}
                  </div>
                )}
                {connectionStatus === 'error' && errorMessage && (
                  <p className="text-xs text-red-500 mt-1">{errorMessage}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    className="text-destructive hover:text-destructive"
                  >
                    <Unplug className="size-3.5" />
                    Desconectar
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={!canTest() || connectionStatus === 'testing'}
                  >
                    {connectionStatus === 'testing' && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    Probar conexion
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* ---- Field mapping (only when connected) ---- */}
          {isConnected && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Mapeo de campos
                </p>
                {selectedProvider === 'jira' && (
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    Story Points usa custom field ID — verificalo en Jira Admin
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Campo Interno
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Campo en {selectedProvider === 'linear' ? 'Linear' : 'Jira'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(FIELD_LABELS) as (keyof FieldMapping)[]).map(
                      (key) => (
                        <tr key={key} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 text-sm">{FIELD_LABELS[key]}</td>
                          <td className="px-4 py-1.5">
                            <Input
                              value={fieldMapping[key]}
                              onChange={(e) => updateMapping(key, e.target.value)}
                              className="h-7 text-xs font-mono"
                              aria-label={`Campo externo para ${FIELD_LABELS[key]}`}
                            />
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* ---- Footer ---- */}
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!selectedProvider}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
