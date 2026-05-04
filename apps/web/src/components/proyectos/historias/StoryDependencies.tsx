'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  KeyRound,
  Server,
  Database,
  Link2,
  Users,
  BookOpen,
  GitBranch,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { ReadOnlyMarkdown } from '@/components/shared/tiptap/ReadOnlyMarkdown';
import { SectionTiptapEditor } from './editor/SectionTiptapEditor';
import { Checkbox } from '@/components/ui/checkbox';
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
  getStoryDependencies,
  createStoryDependency,
  updateStoryDependency,
  deleteStoryDependency,
  type StoryTechnicalDependency,
  type StoryTechnicalDependencyCategory,
  type StoryTechnicalDependencySeverity,
  type CreateStoryDependencyInput,
} from '@/lib/api/story-dependencies';
import { CreateExternalSecretInlineForm } from '@/components/secrets/CreateExternalSecretInlineForm';

/**
 * Convierte un título humano (ej "Stripe API Key") al name UPPER_SNAKE_CASE
 * que el dialog de secrets requiere (ej "STRIPE_API_KEY"). El user puede
 * editar el name luego en el dialog si no le gusta el sugerido.
 */
function titleToSecretName(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove accents
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'X_$1'); // names should start with letter
}

// ── Categories config (coherente con EpicDependencies + provider Linear) ──

const CATEGORY_CONFIG: Record<
  StoryTechnicalDependencyCategory,
  { label: string; icon: typeof Server; description: string; accent: string }
> = {
  secrets: {
    label: 'Secrets y credenciales',
    icon: KeyRound,
    description: 'API keys, tokens y credenciales que el sistema no puede generar.',
    accent: 'text-amber-600 dark:text-amber-400',
  },
  apis: {
    label: 'APIs e integraciones',
    icon: Server,
    description: 'APIs de terceros, endpoints externos.',
    accent: 'text-blue-600 dark:text-blue-400',
  },
  testing: {
    label: 'Testing y datos',
    icon: Database,
    description: 'Fixtures, mocks, datasets necesarios para QA.',
    accent: 'text-cyan-600 dark:text-cyan-400',
  },
  services: {
    label: 'Servicios técnicos',
    icon: Link2,
    description: 'Servicios internos, infraestructura, dependencias arquitectónicas.',
    accent: 'text-teal-600 dark:text-teal-400',
  },
  teams: {
    label: 'Equipos y cross-team',
    icon: Users,
    description: 'Coordinación con otros equipos o personas.',
    accent: 'text-violet-600 dark:text-violet-400',
  },
  knowledge: {
    label: 'Conocimiento',
    icon: BookOpen,
    description: 'Documentación, decisiones de arquitectura, contexto.',
    accent: 'text-fuchsia-600 dark:text-fuchsia-400',
  },
  other: {
    label: 'Otras',
    icon: GitBranch,
    description: 'Dependencias sin categoría específica.',
    accent: 'text-slate-600 dark:text-slate-400',
  },
};

const CATEGORY_ORDER: StoryTechnicalDependencyCategory[] = [
  'secrets',
  'apis',
  'testing',
  'services',
  'teams',
  'knowledge',
  'other',
];

const SEVERITY_BADGE: Record<StoryTechnicalDependencySeverity, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const emptyForm: CreateStoryDependencyInput = {
  title: '',
  description: '',
  category: 'apis',
  severity: 'medium',
  source: 'manual',
  vendor: '',
  requiresCredential: false,
  isBlocking: false,
  mdContent: '',
};

interface Props {
  storyId: string;
}

export function StoryDependencies({ storyId }: Props) {
  const [deps, setDeps] = useState<StoryTechnicalDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateStoryDependencyInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [focusedDepId, setFocusedDepId] = useState<string | null>(null);
  // Cuando el usuario hace click en "Resolver con secret" sobre una dep que
  // requiere credencial, abrimos el dialog compartido con el contexto pre-
  // llenado de esa dep (name derivado del title, vendor/description, sourceDependencyId).
  const [secretDialogContext, setSecretDialogContext] = useState<StoryTechnicalDependency | null>(null);
  // Set de deps expandidas (mostrando mdContent rico). Click en card toggle.
  // Si la URL trae ?dep=X, esa dep arranca expandida automáticamente para que
  // el deep-link desde el rollup del epic abra directo el detalle.
  const [expandedDeps, setExpandedDeps] = useState<Set<string>>(new Set());
  const searchParams = useSearchParams();
  const toggleExpanded = (depId: string) => {
    setExpandedDeps((prev) => {
      const next = new Set(prev);
      if (next.has(depId)) next.delete(depId);
      else next.add(depId);
      return next;
    });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getStoryDependencies(storyId);
      setDeps(result);
    } catch (err) {
      toast.error('No se pudieron cargar las dependencias', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep-link: si la URL trae `?dep=<id>`, después de cargar las deps hacer
  // scroll a la card correspondiente, aplicar highlight temporal (3s) Y
  // expandir el detalle (mdContent rico) automáticamente.
  useEffect(() => {
    if (loading) return;
    const targetId = searchParams.get('dep');
    if (!targetId) return;
    const node = document.getElementById(`dep-${targetId}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusedDepId(targetId);
    setExpandedDeps((prev) => new Set(prev).add(targetId));
    const t = setTimeout(() => setFocusedDepId(null), 3000);
    return () => clearTimeout(t);
  }, [loading, searchParams, deps]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIsCreating(true);
  };

  // Edit inline (no dialog): activa el modo edit en la card y popula el form
  // con todos los campos incluyendo mdContent. La card se renderiza con
  // SectionTiptapEditor para editar el markdown rico, igual que el editor de
  // historias (`EditableSection` + `SectionTiptapEditor`).
  const openEdit = (dep: StoryTechnicalDependency) => {
    setEditingId(dep.id);
    setForm({
      title: dep.title,
      description: dep.description,
      category: dep.category,
      severity: dep.severity,
      source: dep.source,
      vendor: dep.vendor ?? '',
      requiresCredential: dep.requiresCredential,
      isBlocking: dep.isBlocking,
      mdContent: dep.mdContent ?? '',
    });
    // Auto-expandir la dep que se va a editar para preservar contexto visual.
    setExpandedDeps((prev) => new Set(prev).add(dep.id));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('El título es obligatorio');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateStoryDependency(storyId, editingId, form);
        toast.success('Dependencia actualizada');
        setEditingId(null);
        setForm(emptyForm);
      } else {
        await createStoryDependency(storyId, form);
        toast.success('Dependencia creada');
        setIsCreating(false);
        setForm(emptyForm);
      }
      await refresh();
    } catch (err) {
      toast.error('No se pudo guardar', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (depId: string) => {
    try {
      await deleteStoryDependency(storyId, depId);
      toast.success('Dependencia eliminada');
      setDeleteConfirmId(null);
      await refresh();
    } catch (err) {
      toast.error('No se pudo eliminar', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    }
  };

  // Group by category
  const grouped: Record<StoryTechnicalDependencyCategory, StoryTechnicalDependency[]> = {
    secrets: [],
    apis: [],
    testing: [],
    services: [],
    teams: [],
    knowledge: [],
    other: [],
  };
  deps.forEach((d) => {
    grouped[d.category].push(d);
  });
  const visibleCategories = CATEGORY_ORDER.filter((k) => grouped[k].length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {deps.length} {deps.length === 1 ? 'dependencia' : 'dependencias'} técnicas
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Estas dependencias se sincronizan a Linear como contexto del Issue.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={openCreate}
          disabled={isCreating || editingId !== null}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar
        </Button>
      </div>

      {/* Form inline para crear nueva dep — UX paritaria al edit inline.
          Aparece debajo del header y se cierra al guardar/cancelar. Mientras
          está abierto, el botón "Agregar" del header se deshabilita para
          evitar que el user abra dos forms simultáneamente. */}
      {isCreating && (
        <DependencyForm
          mode="create"
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={() => {
            setIsCreating(false);
            setForm(emptyForm);
          }}
          saving={saving}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Cargando...</p>
      ) : deps.length === 0 && !isCreating ? (
        <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-3 text-center">
          <GitBranch className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Esta historia no tiene dependencias técnicas registradas
          </p>
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Agregar la primera
          </Button>
        </div>
      ) : deps.length === 0 ? null : (
        <div className="space-y-8">
          {visibleCategories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const Icon = cfg.icon;
            return (
              <section key={cat} className="space-y-3">
                <div className="border-b pb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${cfg.accent}`} />
                    <h4 className="text-sm font-semibold">{cfg.label}</h4>
                    <span className="text-xs text-muted-foreground">({grouped[cat].length})</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{cfg.description}</p>
                </div>
                <div className="space-y-2">
                  {grouped[cat].map((dep) => {
                    // Legacy: la dep vive a nivel épica (sin storyId real).
                    // No editable/deletable desde la story porque su origen es
                    // el JSONB legacy o el vault — para migrarla, el user la
                    // recrea aquí y borra la legacy desde la épica.
                    const isLegacy = !dep.storyId || dep.storyId !== storyId;
                    const isFocused = focusedDepId === dep.id;
                    const isExpanded = expandedDeps.has(dep.id);
                    const isEditingThis = editingId === dep.id;
                    const hasRichContent =
                      (dep.mdContent && dep.mdContent.trim().length > 0) ||
                      (dep.description && dep.description.length > 100);

                    // Modo edit inline: la card se transforma en formulario
                    // con SectionTiptapEditor para mdContent (paridad con el
                    // editor de historias que ya usa Tiptap). El user edita
                    // todos los campos directamente en la card sin abrir dialog.
                    if (isEditingThis) {
                      return (
                        <div key={dep.id} id={`dep-${dep.id}`}>
                          <DependencyForm
                            mode="edit"
                            form={form}
                            setForm={setForm}
                            onSave={handleSave}
                            onCancel={cancelEdit}
                            saving={saving}
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={dep.id}
                        id={`dep-${dep.id}`}
                        className={`rounded-lg border p-4 transition-all duration-300 ${
                          dep.isBlocking
                            ? 'border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/10'
                            : ''
                        } ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => hasRichContent && toggleExpanded(dep.id)}
                            className={`flex-1 min-w-0 text-left ${hasRichContent ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            <div className="flex items-start gap-1.5">
                              {hasRichContent && (
                                <span className="mt-0.5 text-muted-foreground shrink-0">
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </span>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium leading-tight">{dep.title}</p>
                                {dep.description && (
                                  <p className={`text-xs text-muted-foreground mt-1 ${isExpanded ? '' : 'line-clamp-2'}`}>
                                    {dep.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                          {isLegacy ? (
                            <span
                              className="text-[10px] text-muted-foreground italic shrink-0"
                              title="Dependencia legacy de la épica. Para editarla, créala en esta historia y borra la del epic."
                            >
                              📦 Legacy de la épica
                            </span>
                          ) : (
                            <div className="flex items-center gap-1 shrink-0">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(dep)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              {deleteConfirmId === dep.id ? (
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setDeleteConfirmId(null)}>
                                    Cancelar
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => handleDelete(dep.id)}>
                                    Eliminar
                                  </Button>
                                </div>
                              ) : (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600" onClick={() => setDeleteConfirmId(dep.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[dep.severity]}`}>
                          {dep.severity}
                        </span>
                        {dep.source === 'discovered' && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
                            <Sparkles className="h-2.5 w-2.5" />
                            IA
                          </span>
                        )}
                        {dep.vendor && (
                          <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-foreground/80">
                            {dep.vendor}
                          </span>
                        )}
                        {dep.requiresCredential && !dep.linkedSecretId && (
                          <button
                            type="button"
                            onClick={() => setSecretDialogContext(dep)}
                            className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive px-2 py-0.5 text-[10px] font-medium hover:bg-destructive/20 hover:border-destructive/50 transition-colors cursor-pointer"
                            title="Click para registrar el secret asociado y resolver esta dependencia"
                          >
                            <KeyRound className="h-2.5 w-2.5" />
                            Requiere credencial
                            <span className="opacity-70">— resolver</span>
                          </button>
                        )}
                        {dep.linkedSecretId && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 text-[10px] font-medium">
                            <ShieldCheck className="h-2.5 w-2.5" />
                            Secret provisto
                          </span>
                        )}
                        {dep.isBlocking && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 text-[10px] font-semibold">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Bloqueante
                          </span>
                        )}
                      </div>

                      {/* Bloque expandido: muestra el mdContent rico que el
                          agente IA generó (naturaleza, impacto, mocks, owner,
                          links, etc.). Solo visible cuando el user expande
                          la card o cuando viene del deep-link ?dep=. */}
                      {isExpanded && dep.mdContent && dep.mdContent.trim().length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border/40">
                          <ReadOnlyMarkdown content={dep.mdContent} />
                        </div>
                      )}

                      {/* Inline form para guardar credencial externa, expandida
                          dentro de la dep card que originó el flujo. Reemplaza
                          al CreateExternalSecretDialog (modal) — paridad UX
                          con el DependencyForm inline. */}
                      {secretDialogContext?.id === dep.id && (
                        <div className="mt-4 pt-4 border-t border-border/40">
                          <CreateExternalSecretInlineForm
                            defaultName={titleToSecretName(dep.title)}
                            defaultVendor={dep.vendor ?? ''}
                            defaultDescription={dep.description ?? ''}
                            sourceDependencyId={dep.id}
                            onCreated={() => {
                              setSecretDialogContext(null);
                              // Refresh para que el badge cambie a "Secret provisto"
                              // — el backend hace bulk-update de todas las deps con
                              // mismo vendor en `resolveAllStoryDependenciesByVendor`.
                              void refresh();
                            }}
                            onCancel={() => setSecretDialogContext(null)}
                          />
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* La inline form para guardar el secret externo se renderiza DENTRO
          de la dep card que la originó (ver bloque arriba con
          `secretDialogContext?.id === dep.id`). Esto preserva el contexto
          visual y reemplaza al Dialog modal previo. */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-componente local — formulario reutilizable para crear y editar
// dependencias inline. UX paritaria entre los dos modos: el create
// vive arriba de la lista, el edit reemplaza la card de la dep que
// se está editando. La única diferencia entre modos es el copy del
// header opcional y del CTA del footer.
// ─────────────────────────────────────────────────────────────────

interface DependencyFormProps {
  mode: 'create' | 'edit';
  form: CreateStoryDependencyInput;
  setForm: React.Dispatch<React.SetStateAction<CreateStoryDependencyInput>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function DependencyForm({ mode, form, setForm, onSave, onCancel, saving }: DependencyFormProps) {
  return (
    <div className="rounded-lg border-2 border-primary/40 p-4 space-y-3 bg-card shadow-sm">
      {mode === 'create' && (
        <div className="flex items-center gap-2 pb-1">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <h4 className="text-sm font-semibold">Nueva dependencia técnica</h4>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Título
        </label>
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Stripe API Key"
          className="text-sm"
          autoFocus={mode === 'create'}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Descripción corta
        </label>
        <Input
          value={form.description ?? ''}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Subtítulo de 1-2 líneas que aparece en la card"
          className="text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Categoría
          </label>
          <Select
            value={form.category}
            onValueChange={(v) => setForm({ ...form, category: v as CreateStoryDependencyInput['category'] })}
          >
            <SelectTrigger className="text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_CONFIG[c].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Severidad
          </label>
          <Select
            value={form.severity}
            onValueChange={(v) => setForm({ ...form, severity: v as CreateStoryDependencyInput['severity'] })}
          >
            <SelectTrigger className="text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vendor (opcional)
        </label>
        <Input
          value={form.vendor ?? ''}
          onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          placeholder="Stripe, Twilio, OpenAI..."
          className="text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={form.requiresCredential ?? false}
            onCheckedChange={(v) => setForm({ ...form, requiresCredential: v === true })}
          />
          <span className="text-xs">Requiere credencial</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={form.isBlocking ?? false}
            onCheckedChange={(v) => setForm({ ...form, isBlocking: v === true })}
          />
          <span className="text-xs">Bloqueante</span>
        </label>
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Detalle (markdown rico)
        </label>
        <SectionTiptapEditor
          initialMarkdown={form.mdContent ?? ''}
          onChange={(md) => setForm({ ...form, mdContent: md })}
          placeholder="## Naturaleza&#10;Qué es exactamente, qué proveedor...&#10;&#10;## Impacto&#10;&#10;## Owner sugerido&#10;&#10;## Links"
          variant="paragraph"
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || !form.title.trim()}>
          {saving ? 'Guardando...' : mode === 'create' ? 'Crear dependencia' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  );
}
