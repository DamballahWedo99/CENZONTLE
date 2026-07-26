'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  KeyRound,
  Server,
  Database,
  Link2,
  Users,
  BookOpen,
  GitBranch,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { StoryDependencyItem } from '@/lib/api/epics';
import { useProyectos } from '@/context/ProyectosContext';
import {
  getEpicDependenciesRollup,
  type StoryTechnicalDependency,
  type StoryTechnicalDependencyCategory,
  type StoryTechnicalDependencySeverity,
} from '@/lib/api/story-dependencies';
import { CreateExternalSecretDialog } from '@/components/secrets/CreateExternalSecretDialog';
import { ReadOnlyMarkdown } from '@/components/shared/tiptap/ReadOnlyMarkdown';

/**
 * Convierte un título humano (ej "Stripe API Key") al name UPPER_SNAKE_CASE
 * que el dialog de secrets requiere (ej "STRIPE_API_KEY"). El user puede
 * editar el name luego en el dialog si no le gusta el sugerido.
 */
function titleToSecretName(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'X_$1');
}

// ── Categories config (coherente con StoryDependencies + Linear provider) ──

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

/**
 * Rollup vacío compartido. Referencia estable para que el render de la
 * ventana de carga no cree un array nuevo por render (y no invalide los
 * `useMemo` que dependan de él).
 */
const EMPTY_ROLLUP: StoryTechnicalDependency[] = [];

const STORY_ORDER_REASON_LABELS: Record<string, string> = {
  api_contract: 'API contract',
  migration_order: 'Migration order',
  shared_model: 'Shared model',
  sequential_logic: 'Sequential logic',
  other: 'Otro',
};

interface EpicDependenciesProps {
  epicId: string;
  /**
   * DAG de orden entre historias (emitido por el Tech Lead). Cada item es una
   * historia bloqueada con su lista de bloqueantes directos. Se renderiza
   * como sección separada al final.
   */
  storyOrderDependencies?: StoryDependencyItem[];
  /**
   * Callback que se invoca cada vez que el rollup termina de cargar, con el
   * total de deps del rollup (nuevas + legacy unificadas). El padre lo usa
   * para mantener el contador del tab consistente con lo que se renderea aquí.
   */
  onRollupCountChange?: (count: number) => void;
}

/**
 * Tab "Dependencias" del epic — roll-up READ-ONLY de las dependencias técnicas
 * de TODAS las historias del epic + DAG de orden entre historias.
 *
 * Las dependencias técnicas ya NO se crean a nivel epic — se gestionan desde
 * la vista de cada historia (`StoryDependencies.tsx`). Este componente solo
 * agrega y muestra; el botón "Agregar" se removió intencionalmente.
 */
export function EpicDependencies({
  epicId,
  storyOrderDependencies = [],
  onRollupCountChange,
}: EpicDependenciesProps) {
  const { state } = useProyectos();
  /*
    El rollup se guarda JUNTO con la clave del fetch que lo produjo
    (`epicId` + tick de refresh). Así `loading` es un valor derivado —
    "todavía no llegó el rollup de la clave actual"— en vez de un segundo
    state que había que poner en true desde el effect. Beneficio real, no
    solo lint: al cambiar de épica ya no existe el render intermedio en el
    que `loading` seguía en false mientras `rollup` era el de la épica
    anterior.
  */
  const [fetched, setFetched] = useState<{
    key: string;
    deps: StoryTechnicalDependency[];
  } | null>(null);
  // Cuando el usuario hace click en "Resolver con secret" sobre una dep que
  // requiere credencial, abrimos el dialog compartido con el contexto pre-
  // llenado de esa dep (name derivado del title, vendor/description, sourceDependencyId).
  const [secretDialogContext, setSecretDialogContext] = useState<StoryTechnicalDependency | null>(null);
  // Trigger para forzar re-fetch del rollup (sube cuando se crea un secret).
  const [refreshTick, setRefreshTick] = useState(0);
  // Set de deps expandidas (mostrando mdContent rico al click). Mismo patrón
  // que en StoryDependencies.tsx — el rollup es read-only así que el detalle
  // expandido ayuda al user a revisar el contenido sin navegar a la story.
  const [expandedDeps, setExpandedDeps] = useState<Set<string>>(new Set());
  const toggleExpanded = (depId: string) => {
    setExpandedDeps((prev) => {
      const next = new Set(prev);
      if (next.has(depId)) next.delete(depId);
      else next.add(depId);
      return next;
    });
  };

  // Identidad del fetch en vuelo. Cambia con la épica y con cada refresh
  // forzado — exactamente los dos disparadores que antes eran deps del effect.
  const fetchKey = `${epicId}#${refreshTick}`;
  const current = fetched !== null && fetched.key === fetchKey ? fetched : null;
  const loading = current === null;
  const rollup = current?.deps ?? EMPTY_ROLLUP;

  useEffect(() => {
    let cancelled = false;
    getEpicDependenciesRollup(epicId)
      .then((deps) => {
        if (!cancelled) {
          setFetched({ key: fetchKey, deps });
          onRollupCountChange?.(deps.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetched({ key: fetchKey, deps: [] });
          onRollupCountChange?.(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [epicId, fetchKey, onRollupCountChange]);

  // Map storyId → story title para mostrar de qué historia viene cada dep.
  const storyTitleById = useMemo(() => {
    const map = new Map<string, string>();
    state.stories
      .filter((s) => s.epicId === epicId)
      .forEach((s) => map.set(s.id, s.title));
    return map;
  }, [state.stories, epicId]);

  // Agrupar por categoría
  const grouped: Record<StoryTechnicalDependencyCategory, StoryTechnicalDependency[]> = {
    secrets: [],
    apis: [],
    testing: [],
    services: [],
    teams: [],
    knowledge: [],
    other: [],
  };
  rollup.forEach((d) => {
    grouped[d.category].push(d);
  });
  const visibleCategories = CATEGORY_ORDER.filter((k) => grouped[k].length > 0);

  // Stats
  const totalDeps = rollup.length;
  const blockingCount = rollup.filter((d) => d.isBlocking).length;
  const credentialsNeeded = rollup.filter(
    (d) => d.requiresCredential && !d.linkedSecretId,
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (totalDeps === 0 && storyOrderDependencies.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-4 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground" />
        <div className="max-w-md space-y-1">
          <p className="text-sm font-medium">Sin dependencias registradas</p>
          <p className="text-xs text-muted-foreground">
            Las dependencias técnicas se crean desde la vista de cada historia. Las
            relaciones de orden las emite el agente Tech Lead durante la generación.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Stats header */}
      {totalDeps > 0 && (
        <div className="flex items-center gap-6 pb-4 border-b">
          <div>
            <p className="text-2xl font-bold">{totalDeps}</p>
            <p className="text-xs text-muted-foreground">Total deps</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{blockingCount}</p>
            <p className="text-xs text-muted-foreground">Bloqueantes</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{credentialsNeeded}</p>
            <p className="text-xs text-muted-foreground">Sin credencial</p>
          </div>
          <div className="ml-auto text-xs text-muted-foreground max-w-md text-right">
            Roll-up read-only. Edita cada dependencia desde la vista de su historia.
          </div>
        </div>
      )}

      {/* Categorías */}
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
                const isLegacy = !dep.storyId;
                const storyTitle = isLegacy
                  ? 'Legacy a nivel épica'
                  : (storyTitleById.get(dep.storyId) ?? '(historia desconocida)');
                const isExpanded = expandedDeps.has(dep.id);
                const hasRichContent =
                  (dep.mdContent && dep.mdContent.trim().length > 0) ||
                  (dep.description && dep.description.length > 100) ||
                  // Habilita expansión cuando la dep está dedupleada en N
                  // historias — el bloque expandido lista cada una con link.
                  (dep.relatedStories && dep.relatedStories.length > 1);
                // Cards no-legacy son clickables: navegan a la historia con
                // `?dep=<id>` para que la vista destino haga scroll + focus.
                const cardClass = `block rounded-lg border p-4 transition-colors ${
                  dep.isBlocking
                    ? 'border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/10'
                    : ''
                } ${isLegacy ? '' : 'hover:border-foreground/30 hover:bg-muted/30 cursor-pointer'}`;
                const cardInner = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 flex items-start gap-1.5">
                        {hasRichContent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              // Evitar navegación del Link wrapper.
                              e.preventDefault();
                              e.stopPropagation();
                              toggleExpanded(dep.id);
                            }}
                            className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                            title={isExpanded ? 'Colapsar detalle' : 'Ver detalle completo'}
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
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
                      {isLegacy ? (
                        <span
                          className="text-[10px] text-muted-foreground shrink-0 max-w-[200px] truncate text-right italic"
                          title="Dependencia legacy de la épica (no tiene historia owner). Migra creándola en una historia para desligarla del epic."
                        >
                          📦 {storyTitle}
                        </span>
                      ) : dep.relatedStories && dep.relatedStories.length > 1 ? (
                        // Dep usada en MÚLTIPLES historias del epic — colapsamos
                        // el rollup visual y mostramos el conteo + tooltip con
                        // los títulos. Evita el ruido de N entries duplicadas.
                        <span
                          className="text-[10px] text-muted-foreground shrink-0 cursor-help"
                          title={`Usado en ${dep.relatedStories.length} historias:\n${dep.relatedStories.map((s) => `• ${s.storyTitle}`).join('\n')}`}
                        >
                          📖 {dep.relatedStories.length} historias
                        </span>
                      ) : (
                        <span
                          className="text-[10px] text-muted-foreground shrink-0 max-w-[200px] truncate text-right"
                          title={`Ir a historia: ${storyTitle}`}
                        >
                          📖 {storyTitle}
                        </span>
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
                          onClick={(e) => {
                            // Evitar que el click propague al wrapper Link de
                            // la card (que navegaría a la historia owner).
                            e.preventDefault();
                            e.stopPropagation();
                            setSecretDialogContext(dep);
                          }}
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

                    {/* Bloque expandido: muestra la lista de historias que
                        mencionan esta credencial (si fue dedupleada en el
                        rollup) + el mdContent rico que el agente IA generó.
                        Click adentro hace stopPropagation para que el user
                        pueda seleccionar texto / clickear links sin navegar
                        accidentalmente al detalle de la historia. */}
                    {isExpanded && dep.relatedStories && dep.relatedStories.length > 1 && (
                      <div
                        // BUG FIX (2026-05-04): antes usábamos `e.preventDefault()`
                        // junto con `stopPropagation()`, lo cual cancelaba la
                        // navegación nativa de los `<a>` internos (links del
                        // markdown del agente). El intent era "no navegar a la
                        // historia cuando clickees adentro" — solo `stopPropagation`
                        // logra eso (previene bubble al Link wrapper). El
                        // `preventDefault` era too aggressive: aplicaba a TODO
                        // click, incluyendo los <a href="..."> internos.
                        onClick={(e) => e.stopPropagation()}
                        className="mt-4 pt-4 border-t border-border/40 cursor-default"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Usado en {dep.relatedStories.length} historias
                        </p>
                        <ul className="space-y-1">
                          {dep.relatedStories.map((s) => (
                            <li key={s.storyId} className="text-xs">
                              <Link
                                href={`/proyectos/historias/${s.storyId}?dep=${dep.id}`}
                                className="text-foreground/80 hover:text-foreground hover:underline"
                              >
                                📖 {s.storyTitle}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {isExpanded && dep.mdContent && dep.mdContent.trim().length > 0 && (
                      <div
                        // Mismo fix que arriba: stopPropagation (no preventDefault).
                        onClick={(e) => e.stopPropagation()}
                        className="mt-4 pt-4 border-t border-border/40 cursor-default"
                      >
                        <ReadOnlyMarkdown content={dep.mdContent} />
                      </div>
                    )}
                  </>
                );
                // Si la dep está dedupleada (N>1 menciones), la card NO es
                // navegable como un todo — el `dep.storyId` es la canónica
                // del grupo (arbitraria), navegar ahí silenciosamente lleva
                // al user a UNA historia particular sin contexto. En su
                // lugar, el user expande la card y clickea la historia
                // específica que quiera ver. Misma rama que legacy.
                const isMultiMention =
                  !!dep.relatedStories && dep.relatedStories.length > 1;
                return isLegacy || isMultiMention ? (
                  <div
                    key={dep.id}
                    className={
                      isMultiMention
                        ? cardClass.replace('cursor-pointer', 'cursor-default').replace('hover:border-foreground/30', '').replace('hover:bg-muted/30', '')
                        : cardClass
                    }
                  >
                    {cardInner}
                  </div>
                ) : (
                  <Link
                    key={dep.id}
                    href={`/proyectos/historias/${dep.storyId}?dep=${dep.id}`}
                    className={cardClass}
                  >
                    {cardInner}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Sección DAG: Orden entre historias del epic (sin cambios respecto al original) */}
      {storyOrderDependencies.length > 0 && (
        <section className="space-y-3">
          <div className="border-b pb-2">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-foreground" />
              <h4 className="text-sm font-semibold">🔄 Orden entre historias del epic</h4>
              <span className="text-xs text-muted-foreground">
                ({storyOrderDependencies.length} {storyOrderDependencies.length === 1 ? 'historia bloqueada' : 'historias bloqueadas'})
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              DAG emitido por el Tech Lead. Las hard se sincronizan a Linear como Issue Relations
              tipo &quot;blocks&quot; (visibles en el panel de cada Issue).
            </p>
          </div>
          <div className="space-y-2">
            {storyOrderDependencies.map((item) => (
              <div key={item.story.id} className="rounded-lg border p-4 space-y-2">
                <Link
                  href={`/proyectos/historias/${item.story.id}`}
                  className="text-sm font-medium leading-tight hover:underline block"
                >
                  {item.story.title}
                </Link>
                <p className="text-xs text-muted-foreground">Bloqueada por:</p>
                <ul className="space-y-1 ml-2">
                  {item.blockedBy.map((blocker) => (
                    <li key={blocker.story.id} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 inline-block px-1.5 py-0 rounded text-[9px] font-semibold ${
                        blocker.hardness === 'hard'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      }`}>
                        {blocker.hardness.toUpperCase()}
                      </span>
                      <div className="flex-1">
                        <Link
                          href={`/proyectos/historias/${blocker.story.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {blocker.story.title}
                        </Link>
                        <span className="text-muted-foreground ml-2">
                          [{STORY_ORDER_REASON_LABELS[blocker.reason] ?? blocker.reason}]
                        </span>
                        {blocker.description && (
                          <p className="text-muted-foreground mt-0.5">{blocker.description}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Dialog compartido para crear secret externo desde una dep concreta.
          Se abre cuando el user click en "Requiere credencial — resolver".
          El backend usa `sourceDependencyId` para auto-resolver la dep
          (status='resolved' + linkedSecretId) Y bulk-update por vendor sobre
          todas las stories que comparten la misma credencial. */}
      <CreateExternalSecretDialog
        open={secretDialogContext !== null}
        onOpenChange={(open) => {
          if (!open) setSecretDialogContext(null);
        }}
        defaultName={secretDialogContext ? titleToSecretName(secretDialogContext.title) : ''}
        defaultVendor={secretDialogContext?.vendor ?? ''}
        defaultDescription={secretDialogContext?.description ?? ''}
        sourceDependencyId={secretDialogContext?.id}
        onCreated={() => {
          setSecretDialogContext(null);
          // Forzar re-fetch del rollup → el badge cambia a "Secret provisto".
          setRefreshTick((t) => t + 1);
        }}
      />
    </div>
  );
}
