'use client';

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Target,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export type MilestoneBar = 'dod' | 'acceptance' | 'workflow';

interface MilestoneItem {
  text: string;
  done: boolean;
}

interface BarConfig {
  label: string;
  description: string;
  Icon: LucideIcon;
  /** Acento de texto. */
  text: string;
  /** Fondo tinte del icono del header. */
  iconBg: string;
  /** Fondo del nodo completado. */
  node: string;
  /** Halo (ring) del nodo completado. */
  nodeRing: string;
  /** Segmento de la espina ya recorrido. */
  spine: string;
  /** Relleno de la barra de progreso. */
  track: string;
  /** Gradiente del bloom de fondo del header. */
  glow: string;
}

/**
 * Config visual + textual por categoría. Los acentos (cyan / emerald /
 * blue) son los MISMOS que los chips del header de AgentTerminal — la
 * semántica de color se conserva: DoD=cyan, acceptance=emerald,
 * workflow=blue.
 */
const BAR_CONFIG: Record<MilestoneBar, BarConfig> = {
  dod: {
    label: 'Definition of Done',
    description: 'Criterios del DoD que el verificador evaluó para este run.',
    Icon: ListChecks,
    text: 'text-cyan-400',
    iconBg: 'bg-cyan-500/10',
    node: 'bg-cyan-500',
    nodeRing: 'ring-cyan-500/20',
    spine: 'bg-cyan-500/55',
    track: 'bg-cyan-500',
    glow: 'from-cyan-500/10',
  },
  acceptance: {
    label: 'Acceptance criteria',
    description:
      'Criterios de aceptación de la story, marcados per-criterio por el verifier.',
    Icon: Target,
    text: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    node: 'bg-emerald-500',
    nodeRing: 'ring-emerald-500/20',
    spine: 'bg-emerald-500/55',
    track: 'bg-emerald-500',
    glow: 'from-emerald-500/10',
  },
  workflow: {
    label: 'Workflow milestones',
    description: 'Hitos técnicos del worker — clone, spawn, commit, push.',
    Icon: Workflow,
    text: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    node: 'bg-blue-500',
    nodeRing: 'ring-blue-500/20',
    spine: 'bg-blue-500/55',
    track: 'bg-blue-500',
    glow: 'from-blue-500/10',
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Agrupación por sección de la solución técnica
// ─────────────────────────────────────────────────────────────────────────

/**
 * Secciones de `definicion-tecnica.md`. El verifier prefija el label de cada
 * verdict `technical-design` con su sección (`Checklist:`, `Contrato:`, …);
 * agrupamos los milestones por ese prefijo. Mismas etiquetas que el panel
 * `ForgeReviewAlert` del merge view — semántica consistente.
 */
const MILESTONE_GROUPS: ReadonlyArray<{ prefix: string; name: string }> = [
  { prefix: 'Checklist:', name: 'Checklist técnico' },
  { prefix: 'Contrato:', name: 'Contrato' },
  { prefix: 'Validación:', name: 'Validación' },
  { prefix: 'Errores:', name: 'Manejo de errores' },
];
/** Catch-all para milestones sin prefijo de sección (DoD, workflow, ACs). */
const GENERAL_GROUP = 'General';

interface MilestoneGroupData {
  name: string;
  items: MilestoneItem[];
}

/**
 * Reparte los milestones por su sección (prefijo del label). Orden fijo —
 * las 4 secciones del TL, luego el general; devuelve sólo los grupos con al
 * menos un item. Al item se le quita el prefijo: el wrapper del grupo ya lo
 * nombra.
 */
function groupMilestones(items: MilestoneItem[]): MilestoneGroupData[] {
  const result: MilestoneGroupData[] = [
    ...MILESTONE_GROUPS.map((g) => ({
      name: g.name,
      items: [] as MilestoneItem[],
    })),
    { name: GENERAL_GROUP, items: [] as MilestoneItem[] },
  ];
  for (const item of items) {
    const def = MILESTONE_GROUPS.find((d) => item.text.startsWith(d.prefix));
    const target = result.find(
      (g) => g.name === (def ? def.name : GENERAL_GROUP),
    );
    if (!target) continue;
    if (def) {
      const stripped = item.text.slice(def.prefix.length).trim();
      target.items.push({ text: stripped || item.text, done: item.done });
    } else {
      target.items.push(item);
    }
  }
  return result.filter((g) => g.items.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────

/**
 * Línea de tiempo vertical de milestones — nodo (disco de acento + check si
 * cumplido, anillo hueco si pendiente) unidos por una espina que se "llena"
 * de acento solo entre nodos cumplidos consecutivos.
 */
function MilestoneTimeline({
  items,
  cfg,
}: {
  items: MilestoneItem[];
  cfg: BarConfig;
}) {
  return (
    <ol>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <li
            // `text` por sí solo puede colisionar si dos criterios comparten
            // descripción tras quitar el prefijo — el índice lo desempata.
            key={`${item.text}-${i}`}
            className="flex animate-in gap-3 fade-in-0 slide-in-from-bottom-1"
            style={{
              animationDelay: `${i * 35}ms`,
              animationFillMode: 'both',
            }}
          >
            {/* Nodo + espina */}
            <div className="flex w-5 flex-col items-center">
              {item.done ? (
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-full ring-4',
                    cfg.node,
                    cfg.nodeRing,
                  )}
                >
                  <Check
                    className="size-3 text-background"
                    strokeWidth={3.5}
                    aria-hidden="true"
                  />
                </span>
              ) : (
                <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-muted-foreground/25 bg-card">
                  <span className="size-1.5 rounded-full bg-muted-foreground/25" />
                </span>
              )}
              {/* Espina — accent solo entre dos nodos cumplidos, para que en
                  checklists no-monótonas no quede acento "colgando". */}
              {!isLast && (
                <span
                  className={cn(
                    'my-1 w-0.5 flex-1 rounded-full',
                    item.done && items[i + 1].done ? cfg.spine : 'bg-border',
                  )}
                />
              )}
            </div>

            {/* Texto */}
            <div className={cn('min-w-0', isLast ? 'pb-0' : 'pb-5')}>
              <p
                className={cn(
                  'text-[13px] leading-snug',
                  item.done
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {item.text}
              </p>
              {!item.done && (
                <span className="mt-1 inline-block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                  Pendiente
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Wrapper colapsable de una sección de milestones. Default abierto: el panel
 * existe para que el progreso se vea de inmediato. El contador del header
 * (`done/total`) toma el acento de la categoría cuando la sección está
 * completa.
 */
function MilestoneGroup({
  group,
  cfg,
}: {
  group: MilestoneGroupData;
  cfg: BarConfig;
}) {
  const [open, setOpen] = useState(true);
  const done = group.items.filter((i) => i.done).length;
  const allDone = done === group.items.length;
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
          {group.name}
        </span>
        <span
          className={cn(
            'ml-auto font-mono text-[11px] tabular-nums',
            allDone ? cfg.text : 'text-muted-foreground/55',
          )}
        >
          {done}/{group.items.length}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 pb-3 pt-3">
          <MilestoneTimeline items={group.items} cfg={cfg} />
        </div>
      )}
    </div>
  );
}

interface MilestoneDrawerProps {
  /** Si el panel está abierto. */
  open: boolean;
  /** Categoría mostrada — SIEMPRE válida. El caller la mantiene "sticky"
   *  aunque el drawer cierre, para que el contenido no parpadee durante la
   *  animación de salida del Sheet. */
  bar: MilestoneBar;
  /** Radix lo dispara al cerrar (botón X, overlay o Esc). */
  onOpenChange: (open: boolean) => void;
  dod: MilestoneItem[];
  acceptance: MilestoneItem[];
  workflow: MilestoneItem[];
}

/**
 * Drawer lateral (shadcn `Sheet`) que reimagina la vieja barra inferior de
 * milestones como una línea de tiempo de progreso vertical: header con
 * contador + barra de progreso, y un timeline con espina.
 *
 * Cuando los milestones traen prefijo de sección (caso acceptance →
 * Checklist/Contrato/Validación/Errores) se agrupan en wrappers colapsables;
 * cuando no (DoD, workflow) se muestra el timeline plano.
 *
 * Una sola instancia controlada por `open` + `bar`. Los chips del header de
 * AgentTerminal disparan la apertura y el cambio de categoría.
 */
export function MilestoneDrawer({
  open,
  bar,
  onOpenChange,
  dod,
  acceptance,
  workflow,
}: MilestoneDrawerProps) {
  const cfg = BAR_CONFIG[bar];
  const HeaderIcon = cfg.Icon;
  const items =
    bar === 'dod' ? dod : bar === 'acceptance' ? acceptance : workflow;
  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // Agrupamos cuando hay al menos UNA sección técnica con nombre (caso
  // acceptance — Checklist/Contrato/…). DoD y workflow no traen prefijo →
  // solo el grupo 'General' → timeline plano sin wrappers colapsables.
  const groups = groupMilestones(items);
  const grouped = groups.some((g) => g.name !== GENERAL_GROUP);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {/* Bloom de acento detrás del header — atmósfera sutil. */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b to-transparent',
            cfg.glow,
          )}
        />

        {/* ─── Header ─── */}
        <SheetHeader className="relative gap-0 border-b border-border/60 p-5 pr-12">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-xl',
                cfg.iconBg,
                cfg.text,
              )}
            >
              <HeaderIcon className="size-[18px]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-[15px] leading-tight tracking-tight">
                {cfg.label}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-xs leading-snug">
                {cfg.description}
              </SheetDescription>
            </div>
          </div>

          {/* Progreso */}
          <div className="mt-5">
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-mono text-2xl font-semibold leading-none tabular-nums',
                  cfg.text,
                )}
              >
                {doneCount}
              </span>
              <span className="font-mono text-sm tabular-nums text-muted-foreground/50">
                / {total}
              </span>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {pct === 100 ? 'Completado' : `${pct}%`}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-500 ease-out',
                  cfg.track,
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </SheetHeader>

        {/* ─── Timeline ─── */}
        <div className="relative flex-1 overflow-y-auto px-5 py-5">
          {total === 0 ? (
            <p className="text-xs text-muted-foreground/60">
              No hay milestones para esta categoría.
            </p>
          ) : grouped ? (
            // `key={bar}` remonta al cambiar de categoría → re-anima el
            // stagger y resetea el estado abierto/cerrado de los grupos.
            <div key={bar} className="space-y-2.5">
              {groups.map((g) => (
                <MilestoneGroup key={g.name} group={g} cfg={cfg} />
              ))}
            </div>
          ) : (
            <MilestoneTimeline key={bar} items={items} cfg={cfg} />
          )}
        </div>

        {/* ─── Footer ─── */}
        <SheetFooter className="relative border-t border-border/60 p-4">
          <SheetClose asChild>
            <Button variant="outline" className="w-full">
              Cerrar
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
