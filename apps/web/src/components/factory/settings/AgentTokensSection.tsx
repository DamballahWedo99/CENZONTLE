'use client';

import { useEffect, useState } from 'react';
import {
  Loader2,
  Check,
  AlertCircle,
  Lightbulb,
  Code2,
  TestTube2,
  Layers,
  Workflow,
  RotateCcw,
  Cpu,
  FolderKanban,
  MessageSquare,
} from 'lucide-react';
import {
  AGENT_DESCRIPTORS,
  AGENT_EFFORT_LEVELS,
  AGENT_EFFORT_LABELS,
  AGENT_EFFORT_DESCRIPTIONS,
  AGENT_TOKEN_BOUNDS,
  DEFAULT_AGENT_TOKEN_SETTINGS,
  PROJECT_AGENT_MODEL_LABELS,
  type AgentEffortLevel,
  type AgentKey,
  type AgentTokenSettings,
  type ForgeWorkerEffortLevel,
  type ForgeWorkerModel,
  type ProjectAgentModel,
} from '@cenzontle/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getAgentTokenSettings, updateAgentTokenSettings } from '@/lib/api/agent-token-settings';
import { getAnthropicModels, type AnthropicModelOption } from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';
import { ForgeWorkerSection } from './ForgeWorkerSection';

type EditableSettings = Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'>;

/**
 * Parsea un valor de input numérico (max_tokens) de forma segura.
 * `Number()` maneja notación científica/decimales; `Math.floor` trunca; clamp por bounds.
 */
function parseTokenInput(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// Iconos distintivos por agente (mejora la legibilidad de la lista — el user
// reconoce cada agente por su rol antes de leer el label).
const AGENT_ICON: Record<AgentKey, typeof Lightbulb> = {
  storyPo: Lightbulb,
  storyTl: Code2,
  storyQa: TestTube2,
  epic: Layers,
  diagram: Workflow,
  assistant: MessageSquare,
};

// Color accent por agente — tinte sutil para el icono del header de cada card.
const AGENT_ACCENT: Record<AgentKey, string> = {
  storyPo: 'text-amber-500 dark:text-amber-400',
  storyTl: 'text-blue-500 dark:text-blue-400',
  storyQa: 'text-emerald-500 dark:text-emerald-400',
  epic: 'text-violet-500 dark:text-violet-400',
  diagram: 'text-fuchsia-500 dark:text-fuchsia-400',
  assistant: 'text-cyan-500 dark:text-cyan-400',
};

// Etiqueta corta para los segment buttons del effort. Las descripciones largas
// viven en el tooltip (title=) para no inflar el botón.
const EFFORT_SHORT: Record<AgentEffortLevel, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};

/**
 * Sección Agentes IA · Tokens. Permite a Alta Gerencia ajustar
 * `effort` (esfuerzo del adaptive thinking) y `max_tokens` por agente sin
 * redeploy. Cambios se reflejan en runs nuevos en ≤30s (TTL del cache server).
 */
export function AgentTokensSection() {
  const [settings, setSettings] = useState<EditableSettings>(DEFAULT_AGENT_TOKEN_SETTINGS);
  // Nota: removí el state `updatedAt` cuando moví las tabs al header (donde
  // vivía la fecha). La API sigue devolviendo el campo; lo descartamos al
  // destructurar el response. Si se vuelve a necesitar (audit trail, log
  // visible), re-introducir el useState aquí.

  // Controlled tabs — necesario para renderizar el header dinámicamente
  // según la tab activa. Sin esto, no podemos leer el `value` actual desde
  // el componente padre (Radix mantiene su propio state interno).
  const [activeTab, setActiveTab] = useState<'proyectos' | 'factory'>('proyectos');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRecently, setSavedRecently] = useState(false);
  // Catálogo de modelos para los selectores por agente (curado + verificado
  // en vivo). Vacío = aún cargando o falló; el selector cae a mostrar solo el
  // valor persistido (siempre seleccionable) en ese caso.
  const [modelOptions, setModelOptions] = useState<AnthropicModelOption[]>([]);

  useEffect(() => {
    if (!savedRecently) return;
    const timer = setTimeout(() => setSavedRecently(false), 4000);
    return () => clearTimeout(timer);
  }, [savedRecently]);

  useEffect(() => {
    let cancelled = false;
    getAgentTokenSettings()
      .then((s) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { updatedAt: _ua, updatedBy: _ub, ...editable } = s;
        // Merge sobre los defaults: si una API stale/parcial omite un campo
        // (ej. `dodMaxAttempts`), cae a su default en vez de quedar undefined.
        // Así los controles —pills, switches— SIEMPRE reflejan un valor
        // válido (la pill "1" del DoD queda prendida por defecto).
        setSettings({ ...DEFAULT_AGENT_TOKEN_SETTINGS, ...editable });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Error cargando configuración');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Catálogo de modelos para los selectores (best-effort — no bloquea la UI
  // de tokens si falla; los selectores caen al valor persistido).
  useEffect(() => {
    let cancelled = false;
    getAnthropicModels()
      .then((res) => {
        if (!cancelled) setModelOptions(res.models);
      })
      .catch(() => {
        /* selector degrada al valor persistido */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleField = (
    field: keyof EditableSettings,
    value: number | AgentEffortLevel | ProjectAgentModel,
  ) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSavedRecently(false);
  };

  const handleToggle = (field: keyof EditableSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSavedRecently(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAgentTokenSettings(settings);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { updatedAt: _ua, updatedBy: _ub, ...editable } = updated;
      // Merge sobre defaults — ver el fetch inicial: un campo omitido por la
      // API cae a su default en vez de quedar undefined.
      setSettings({ ...DEFAULT_AGENT_TOKEN_SETTINGS, ...editable });
      setSavedRecently(true);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Error guardando configuración';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULT_AGENT_TOKEN_SETTINGS);
    setSavedRecently(false);
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando configuración…
      </div>
    );
  }

  // Agrupa agentes por dominio para layout en secciones colapsadas mentalmente.
  // Los 3 agentes de "Historias" comparten contexto, separarlos visualmente
  // de Épicas/Diagramas reduce el "wall of cards" del diseño anterior.
  const storyAgents = AGENT_DESCRIPTORS.filter((d) => d.key.startsWith('story'));
  const standaloneAgents = AGENT_DESCRIPTORS.filter((d) => d.key === 'epic' || d.key === 'diagram');
  const assistantAgents = AGENT_DESCRIPTORS.filter((d) => d.key === 'assistant');

  return (
    <div className="space-y-6">
      {/* Tabs: Proyectos (agentes story-gen/epic/diagram) vs Factory (coder
          agent del Forge — CLI claude). El TabsList vive en el header a la
          derecha (en lugar de la fecha legacy) para que el switch entre tabs
          esté visualmente alineado con el título de la sección. */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'proyectos' | 'factory')}
        className="w-full"
      >
        {/* Header — título dinámico según la tab activa. Cada tab tiene su
            propia identidad visual (icono + título + descripción) para que
            el operador sepa de qué sección está mirando los settings.
            Las tabs viven a la derecha del header (donde antes estaba
            `updatedAt`, ahora removido). */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-border/60">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-lg bg-primary/10 p-2 shrink-0">
              {activeTab === 'proyectos' ? (
                <FolderKanban className="h-4 w-4 text-primary" />
              ) : (
                <Cpu className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              {activeTab === 'proyectos' ? (
                <>
                  <h3 className="text-sm font-semibold text-foreground">
                    Agentes de Proyectos · Generación con IA
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Configurá el nivel de razonamiento y presupuesto de tokens de los
                    agentes IA que generan historias (PO → TL → QA), épicas y diagramas
                    del proyecto. Los cambios aplican a generaciones nuevas en ≤30s, sin
                    redeploy.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-foreground">
                    Agentes del Forge · Coder + Verifier
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Configurá modelo y extended thinking del agente que escribe el código
                    (coder) y del que revisa el Definition of Done (verifier). Ambos
                    invocan el Claude Code CLI. Los cambios aplican al próximo claim-story
                    del worker (≤30s).
                  </p>
                </>
              )}
            </div>
          </div>
          <TabsList className="grid grid-cols-2 w-[240px] shrink-0">
            <TabsTrigger value="proyectos">Proyectos</TabsTrigger>
            <TabsTrigger value="factory">Factory</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="proyectos" className="mt-6 space-y-6">
          {/* Grupo: Historias (3 agentes secuenciales) */}
          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Historias
              </h4>
              <span className="text-[10px] text-muted-foreground/60">
                Pipeline secuencial PO → TL → QA
              </span>
            </div>
            <div className="space-y-2.5">
              {storyAgents.map((desc) => (
                <AgentCard
                  key={desc.key}
                  desc={desc}
                  models={modelOptions}
                  modelValue={settings[desc.modelField] as ProjectAgentModel}
                  effortValue={settings[desc.effortField] as AgentEffortLevel}
                  maxTokensValue={settings[desc.maxTokensField] as number}
                  enabledValue={settings[desc.enabledField] as boolean}
                  onModelChange={(v) => handleField(desc.modelField, v)}
                  onEffortChange={(v) => handleField(desc.effortField, v)}
                  onMaxTokensChange={(v) => handleField(desc.maxTokensField, v)}
                  onEnabledChange={(v) => handleToggle(desc.enabledField, v)}
                />
              ))}
            </div>
          </section>

          {/* Grupo: Generación standalone (Épicas + Diagramas) */}
          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Generación standalone
              </h4>
              <span className="text-[10px] text-muted-foreground/60">
                Agentes one-shot
              </span>
            </div>
            <div className="space-y-2.5">
              {standaloneAgents.map((desc) => (
                <AgentCard
                  key={desc.key}
                  desc={desc}
                  models={modelOptions}
                  modelValue={settings[desc.modelField] as ProjectAgentModel}
                  effortValue={settings[desc.effortField] as AgentEffortLevel}
                  maxTokensValue={settings[desc.maxTokensField] as number}
                  enabledValue={settings[desc.enabledField] as boolean}
                  onModelChange={(v) => handleField(desc.modelField, v)}
                  onEffortChange={(v) => handleField(desc.effortField, v)}
                  onMaxTokensChange={(v) => handleField(desc.maxTokensField, v)}
                  onEnabledChange={(v) => handleToggle(desc.enabledField, v)}
                />
              ))}
            </div>
          </section>

          {/* Grupo: Asistente de edición (chatbot lateral, conversacional) */}
          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Asistente
              </h4>
              <span className="text-[10px] text-muted-foreground/60">
                Chat lateral de edición (multiturno)
              </span>
            </div>
            <div className="space-y-2.5">
              {assistantAgents.map((desc) => (
                <AgentCard
                  key={desc.key}
                  desc={desc}
                  models={modelOptions}
                  modelValue={settings[desc.modelField] as ProjectAgentModel}
                  effortValue={settings[desc.effortField] as AgentEffortLevel}
                  maxTokensValue={settings[desc.maxTokensField] as number}
                  enabledValue={settings[desc.enabledField] as boolean}
                  onModelChange={(v) => handleField(desc.modelField, v)}
                  onEffortChange={(v) => handleField(desc.effortField, v)}
                  onMaxTokensChange={(v) => handleField(desc.maxTokensField, v)}
                  onEnabledChange={(v) => handleToggle(desc.enabledField, v)}
                />
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="factory" className="mt-6">
          <ForgeWorkerSection
            // Coder agent
            model={settings.forgeWorkerModel as ForgeWorkerModel}
            effort={settings.forgeWorkerEffort as ForgeWorkerEffortLevel}
            onModelChange={(v) => {
              setSettings((prev) => ({ ...prev, forgeWorkerModel: v }));
              setSavedRecently(false);
            }}
            onEffortChange={(v) => {
              setSettings((prev) => ({ ...prev, forgeWorkerEffort: v }));
              setSavedRecently(false);
            }}
            // DoD verifier
            dodVerifierModel={settings.dodVerifierModel as ForgeWorkerModel}
            dodVerifierEffort={settings.dodVerifierEffort as ForgeWorkerEffortLevel}
            onDodVerifierModelChange={(v) => {
              setSettings((prev) => ({ ...prev, dodVerifierModel: v }));
              setSavedRecently(false);
            }}
            onDodVerifierEffortChange={(v) => {
              setSettings((prev) => ({ ...prev, dodVerifierEffort: v }));
              setSavedRecently(false);
            }}
            // DoD retry loop
            dodMaxAttempts={settings.dodMaxAttempts}
            onDodMaxAttemptsChange={(v) => {
              setSettings((prev) => ({ ...prev, dodMaxAttempts: v }));
              setSavedRecently(false);
            }}
            // Max run duration del worker (timeout wall-clock)
            forgeWorkerMaxRunDurationMs={settings.forgeWorkerMaxRunDurationMs}
            onForgeWorkerMaxRunDurationMsChange={(v) => {
              setSettings((prev) => ({ ...prev, forgeWorkerMaxRunDurationMs: v }));
              setSavedRecently(false);
            }}
          />
        </TabsContent>
      </Tabs>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Footer sticky-ish con CTAs claros, theme-coherente. */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/60">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResetDefaults}
          disabled={saving}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restablecer defaults
        </Button>

        <div className="flex items-center gap-3">
          {savedRecently && (
            <span className="text-xs text-emerald-500 dark:text-emerald-400 flex items-center gap-1 animate-in fade-in slide-in-from-right-1">
              <Check className="h-3.5 w-3.5" /> Guardado
            </span>
          )}
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Guardar cambios
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────

interface AgentCardProps {
  desc: (typeof AGENT_DESCRIPTORS)[number];
  models: AnthropicModelOption[];
  modelValue: ProjectAgentModel;
  effortValue: AgentEffortLevel;
  maxTokensValue: number;
  enabledValue: boolean;
  onModelChange: (value: ProjectAgentModel) => void;
  onEffortChange: (value: AgentEffortLevel) => void;
  onMaxTokensChange: (value: number) => void;
  onEnabledChange: (value: boolean) => void;
}

function AgentCard({
  desc,
  models,
  modelValue,
  effortValue,
  maxTokensValue,
  enabledValue,
  onModelChange,
  onEffortChange,
  onMaxTokensChange,
  onEnabledChange,
}: AgentCardProps) {
  const Icon = AGENT_ICON[desc.key];
  const accent = AGENT_ACCENT[desc.key];

  // Opciones del selector: compatibles con agentes (adaptive thinking + effort)
  // y disponibles para la key de la org. Si la verificación en vivo dejó la
  // lista vacía (p.ej. key scoped a otra org → todos availableInApi:false),
  // caemos a TODOS los compatibles del catálogo: bloquear la edición es peor
  // que ofrecer una opción que el backend igual re-valida por whitelist. El
  // valor persistido SIEMPRE se incluye como fallback (más abajo) aunque el
  // catálogo no haya cargado — así el Select nunca queda sin opciones.
  const compatibleModels = models.filter((m) => m.agentCompatible);
  const liveAvailable = compatibleModels.filter((m) => m.availableInApi !== false);
  const selectableModels = liveAvailable.length > 0 ? liveAvailable : compatibleModels;
  const noneLiveAvailable = compatibleModels.length > 0 && liveAvailable.length === 0;
  const modelLabel = (id: string): string =>
    models.find((m) => m.id === id)?.displayName ??
    PROJECT_AGENT_MODEL_LABELS[id as ProjectAgentModel] ??
    id;
  const tokensPct = Math.round(
    ((maxTokensValue - AGENT_TOKEN_BOUNDS.maxTokens.min) /
      (AGENT_TOKEN_BOUNDS.maxTokens.max - AGENT_TOKEN_BOUNDS.maxTokens.min)) * 100,
  );

  return (
    <div
      className={`group rounded-xl border bg-card transition-all ${
        enabledValue
          ? 'border-border hover:border-border/80 hover:shadow-sm'
          : 'border-border/40 bg-muted/20'
      }`}
    >
      {/* Header: icono + label + toggle */}
      <div className="flex items-start gap-3 p-4">
        <div className={`rounded-lg bg-background border border-border/60 p-2 shrink-0 ${enabledValue ? '' : 'opacity-50'}`}>
          <Icon className={`h-4 w-4 ${accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h5 className={`text-sm font-semibold leading-tight ${enabledValue ? 'text-foreground' : 'text-muted-foreground'}`}>
                {desc.label}
              </h5>
              <p className="mt-0.5 text-xs text-muted-foreground/80 line-clamp-2">
                {desc.description}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] font-medium uppercase tracking-wider ${
                  enabledValue ? 'text-emerald-500 dark:text-emerald-400' : 'text-muted-foreground/50'
                }`}
              >
                {enabledValue ? 'Thinking on' : 'Thinking off'}
              </span>
              <Switch
                checked={enabledValue}
                onCheckedChange={onEnabledChange}
                aria-label={`Activar/desactivar thinking de ${desc.label}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Selector de modelo Claude del agente */}
      <div className="border-t border-border/40 px-4 py-3">
        <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Modelo
        </label>
        <Select value={modelValue} onValueChange={(v) => onModelChange(v as ProjectAgentModel)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue>{modelLabel(modelValue)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {selectableModels.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-sm">
                <span className="flex items-center gap-2">
                  <span>{m.displayName}</span>
                  {m.recommended && (
                    <span className="text-[10px] text-muted-foreground">· recomendado</span>
                  )}
                  {m.legacy && (
                    <span className="text-[10px] text-muted-foreground/60">· gen. anterior</span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    ${m.pricing.inputPerMTok}/${m.pricing.outputPerMTok} MTok
                  </span>
                </span>
              </SelectItem>
            ))}
            {/* Fallback: si el modelo persistido no está en el catálogo
                cargado, igual lo ofrecemos para que el Select no quede vacío. */}
            {!selectableModels.some((m) => m.id === modelValue) && (
              <SelectItem value={modelValue} className="text-sm">
                {modelLabel(modelValue)}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {noneLiveAvailable && (
          <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-500">
            La API key de la organización no reporta disponibilidad para estos modelos —
            mostrando el catálogo completo. Verifica la key si la selección falla.
          </p>
        )}
      </div>

      {/* Body: effort segmented + max_tokens con barra de utilización */}
      <div className="border-t border-border/40 px-4 py-3">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-end">
          {/* Effort: segmented buttons */}
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Effort
            </label>
            <div
              role="radiogroup"
              aria-label={`Effort de ${desc.label}`}
              className={`inline-flex rounded-lg border border-border bg-background p-0.5 ${
                enabledValue ? '' : 'opacity-50 pointer-events-none'
              }`}
            >
              {AGENT_EFFORT_LEVELS.map((level) => {
                const selected = effortValue === level;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onEffortChange(level)}
                    title={AGENT_EFFORT_DESCRIPTIONS[level]}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      selected
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {EFFORT_SHORT[level]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/60">
              {AGENT_EFFORT_LABELS[effortValue]} — {AGENT_EFFORT_DESCRIPTIONS[effortValue]}
            </p>
          </div>

          {/* Max tokens: input numérico + barra de utilización del bound */}
          <div className="sm:min-w-[180px]">
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Max tokens
            </label>
            <Input
              type="number"
              min={AGENT_TOKEN_BOUNDS.maxTokens.min}
              max={AGENT_TOKEN_BOUNDS.maxTokens.max}
              step={1000}
              value={maxTokensValue}
              onChange={(e) =>
                onMaxTokensChange(
                  parseTokenInput(
                    e.target.value,
                    AGENT_TOKEN_BOUNDS.maxTokens.min,
                    AGENT_TOKEN_BOUNDS.maxTokens.max,
                  ),
                )
              }
              className="h-9 text-sm font-mono tabular-nums"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary/60 transition-all"
                  style={{ width: `${tokensPct}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
                {tokensPct}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
