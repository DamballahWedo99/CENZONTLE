'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Info,
  Loader2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getEpicCoverageCheck,
  type CoverageCheckResponse,
} from '@/lib/api/epics';
import { cn } from '@/lib/utils';

/**
 * Resultado del fetch del coverage-check, normalizado para los 3 estados
 * del UI: cargando, no aplica/falló (escondemos), y datos listos.
 */
type CoverageState =
  | { kind: 'loading' }
  | { kind: 'unavailable' } // Endpoint falló (Stream A pending) — no bloqueamos
  | { kind: 'ready'; data: CoverageCheckResponse };

/**
 * Hook que carga el coverage check para una épica. Degrada graciosamente
 * en 2 escenarios:
 *  1. El endpoint no existe aún (Stream A todavía no desplegó) → `unavailable`
 *  2. La épica no tiene designs (`epicHasDesigns: false`) → NO fetcheamos
 *     y devolvemos `unavailable` para que el caller lo trate como "no aplica"
 *
 * El caller decide si mostrar el bloque basado en `data.hasDesignBundle`.
 */
export function useCoverageCheck(
  epicId: string,
  epicHasDesigns: boolean,
  refreshKey?: number,
): CoverageState {
  // Initial state es derivable: si la épica no tiene designs, ya sabemos
  // que es `unavailable` (no aplica) sin necesidad de un effect que setee
  // state sincrónicamente. Si la épica gana designs después (rare path),
  // el effect abajo dispara el fetch y transiciona a `loading → ready`.
  const [state, setState] = useState<CoverageState>(() =>
    epicHasDesigns ? { kind: 'loading' } : { kind: 'unavailable' },
  );

  useEffect(() => {
    // Sin designs en la épica: no fetcheamos. El initial state ya es
    // `unavailable`; sólo sincronizamos si epicHasDesigns acaba de
    // transicionar de true→false (rarísimo: implicaría borrar todos
    // los designs sin desmontar el componente).
    if (!epicHasDesigns) {
      return;
    }

    let cancelled = false;

    getEpicCoverageCheck(epicId)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: 'ready', data });
      })
      .catch(() => {
        if (cancelled) return;
        // 404: endpoint aún no implementado (Stream A pending).
        // 5xx: tratamos como unavailable para no bloquear el flujo crítico
        //   del user — la coverage es una red de seguridad, no debe
        //   degenerar en bloqueo si el backend titubea.
        // Cualquier toast.error aquí asustaría al user sin razón válida.
        setState({ kind: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, [epicId, epicHasDesigns, refreshKey]);

  return state;
}

interface CoverageGateProps {
  epicId: string;
  /** Si la épica tiene al menos un design (cualquier tipo). Determina si fetcheamos. */
  epicHasDesigns: boolean;
  /**
   * Refresh key opcional para forzar re-fetch (ej: cuando el caller crea
   * stories nuevas y quiere ver el coverage actualizado).
   */
  refreshKey?: number;
  /**
   * Callback que recibe `canEnqueue`. El parent lo usa para deshabilitar
   * el botón "Enviar al Forge" cuando hay componentes sin cobertura.
   *
   * Mientras carga o el endpoint no responde, se reporta `true` (no bloquear
   * el flujo del user por un endpoint flakey o lento).
   */
  onCanEnqueueChange?: (canEnqueue: boolean) => void;
  /**
   * Callback opcional con el snapshot completo para que el parent muestre
   * un tooltip personalizado en el botón disabled (ej: lista de
   * componentes faltantes).
   */
  onStateChange?: (state: CoverageState) => void;
}

/**
 * Bloque visual que muestra la cobertura del bundle de diseño contra las
 * historias. Se monta debajo del botón "Enviar al Forge" en EpicFullPage.
 *
 * Comportamiento:
 *  - Si la épica no tiene designs o el endpoint falló → no renderiza nada
 *    (el flujo de envío no muestra el bloque).
 *  - Si bundle legacy (sin manifest) → mensaje informativo sugiriendo
 *    re-upload, NO bloquea.
 *  - Si manifest existe → checklist de componentes con estado covered/no
 *    + progress bar + lista de uncovered.
 */
export function CoverageGate({
  epicId,
  epicHasDesigns,
  refreshKey,
  onCanEnqueueChange,
  onStateChange,
}: CoverageGateProps) {
  const state = useCoverageCheck(epicId, epicHasDesigns, refreshKey);
  const [expanded, setExpanded] = useState(true);

  // BUG FIX 2026-05-25 (incident: infinite update loop):
  // Anteriormente este effect dependía de `[state, onCanEnqueueChange, onStateChange]`.
  // Los callbacks son funciones inline del parent (EpicFullPage) y cambian
  // de referencia en cada render — incluso cuando la lógica es idéntica.
  // Resultado: effect se gatillaba en cada render → llamaba setState del
  // parent → parent re-render → nuevos callbacks → otro disparo del effect
  // → LOOP INFINITO (Maximum update depth exceeded).
  //
  // Fix: usar refs para los callbacks. El effect solo depende de `state`
  // (lo que realmente importa); los callbacks se invocan con la versión
  // más reciente vía ref. Es self-contained: no requiere que el parent
  // memoize sus callbacks con useCallback.
  const onCanEnqueueChangeRef = useRef(onCanEnqueueChange);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onCanEnqueueChangeRef.current = onCanEnqueueChange;
    onStateChangeRef.current = onStateChange;
  });

  useEffect(() => {
    const canEnqueue =
      state.kind === 'ready' ? state.data.canEnqueue : true;
    onCanEnqueueChangeRef.current?.(canEnqueue);
    onStateChangeRef.current?.(state);
  }, [state]);

  if (state.kind === 'loading') {
    return (
      <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">
          Verificando cobertura del diseño...
        </p>
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return null;
  }

  const { data } = state;

  if (!data.hasDesignBundle) {
    return null;
  }

  if (!data.manifestExists) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
        <Info
          className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            Cobertura del diseño
          </p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/70 mt-0.5 leading-relaxed">
            Bundle legacy sin manifest — coverage gate no aplicable.
            Considera re-subir el bundle para activar el check de cobertura
            por componente.
          </p>
        </div>
      </div>
    );
  }

  const { summary, components } = data;
  const fullyCovered = summary.uncoveredComponents.length === 0;

  // Color del header + progress bar basado en cobertura.
  const headerColor = fullyCovered
    ? 'border-green-200 dark:border-green-900 bg-green-50/60 dark:bg-green-950/20'
    : 'border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20';
  const titleColor = fullyCovered
    ? 'text-green-700 dark:text-green-400'
    : 'text-red-700 dark:text-red-400';
  const barColor = fullyCovered ? 'bg-green-500' : 'bg-red-500';

  return (
    <TooltipProvider delayDuration={300}>
      <section
        className={cn('mt-3 rounded-xl border p-3', headerColor)}
        aria-label="Cobertura del diseño por historias"
      >
        {/* Header con resumen + toggle */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-2.5 text-left"
          aria-expanded={expanded}
          aria-controls="coverage-list"
        >
          {fullyCovered ? (
            <CheckCircle2
              className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0"
              aria-hidden="true"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className={cn('text-xs font-semibold', titleColor)}>
              Cobertura del diseño
            </p>
            <p
              className={cn(
                'text-[11px] mt-0.5',
                fullyCovered
                  ? 'text-green-600/80 dark:text-green-400/70'
                  : 'text-red-600/80 dark:text-red-400/70',
              )}
            >
              {summary.coveredComponents}/{summary.totalComponents}{' '}
              componente{summary.totalComponents !== 1 ? 's' : ''} cubierto
              {summary.coveredComponents !== 1 ? 's' : ''} ({summary.coveragePercent}%)
              {!fullyCovered && (
                <>
                  {' '}· {summary.uncoveredComponents.length} sin story
                </>
              )}
            </p>
          </div>
          {expanded ? (
            <ChevronUp
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
          ) : (
            <ChevronDown
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
          )}
        </button>

        {/* Progress bar */}
        <div className="mt-2.5">
          <div
            className="h-1.5 rounded-full overflow-hidden bg-muted"
            role="progressbar"
            aria-valuenow={summary.coveragePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Cobertura: ${summary.coveragePercent}%`}
          >
            <div
              className={cn('h-full transition-all duration-500', barColor)}
              style={{ width: `${summary.coveragePercent}%` }}
            />
          </div>
        </div>

        {/* Lista de componentes (colapsable) */}
        {expanded && components.length > 0 && (
          <ul
            id="coverage-list"
            className="mt-3 space-y-1.5 text-xs"
            aria-label="Lista de componentes y su cobertura"
          >
            {components.map((comp) => {
              const isCovered = comp.coverage.covered;
              const storyTitles = comp.coverage.coveredByStories
                .map((s) => s.storyTitle)
                .join(', ');
              return (
                <li
                  key={comp.name}
                  className={cn(
                    'flex items-start gap-2 py-1.5 px-2 rounded-md',
                    isCovered
                      ? 'bg-background/40'
                      : 'bg-red-100/40 dark:bg-red-950/20',
                  )}
                >
                  {isCovered ? (
                    <CheckCircle2
                      className="h-3.5 w-3.5 mt-0.5 text-green-600 dark:text-green-400 shrink-0"
                      aria-label="Cubierto"
                    />
                  ) : (
                    <XCircle
                      className="h-3.5 w-3.5 mt-0.5 text-red-600 dark:text-red-400 shrink-0"
                      aria-label="Sin cobertura"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-medium text-foreground">
                        {comp.name}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide',
                          comp.kind === 'react-component'
                            ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                            : 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
                        )}
                      >
                        {comp.kind === 'react-component' ? 'React' : 'Section'}
                      </span>
                    </div>
                    {isCovered ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate cursor-help">
                            {storyTitles}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs">{storyTitles}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="text-[11px] text-red-700/80 dark:text-red-400/80 mt-0.5 italic flex items-center gap-1">
                        <CircleSlash className="h-3 w-3" aria-hidden="true" />
                        Sin story asignada
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </TooltipProvider>
  );
}

/**
 * Dialog secundario para forzar el envío al Forge con cobertura incompleta.
 * Requiere justificación escrita (≥ 10 chars) para evitar clicks accidentales.
 * El comentario se loguea al backend via la propia request del enqueue (en
 * un futuro PR podríamos persistirlo en el ChangelogEntry — por ahora
 * solo lo usamos como confirmación UX).
 */
interface ForceEnqueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uncoveredComponents: string[];
  /**
   * Callback que ejecuta el envío forzado. Recibe la justificación que
   * el user escribió. Si lanza, el dialog se mantiene abierto.
   */
  onConfirm: (justification: string) => void | Promise<void>;
}

export function ForceEnqueueDialog(props: ForceEnqueueDialogProps) {
  return <ForceEnqueueDialogInner {...props} />;
}

// Implementación separada para que el caller pueda lazy-loadear si quiere.
function ForceEnqueueDialogInner({
  open,
  onOpenChange,
  uncoveredComponents,
  onConfirm,
}: ForceEnqueueDialogProps) {
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset cuando se cierra
  useEffect(() => {
    if (!open) {
      setJustification('');
      setSubmitting(false);
    }
  }, [open]);

  const trimmed = justification.trim();
  const isValid = trimmed.length >= 10;

  const handleConfirm = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch {
      // Caller maneja el toast.error; dejamos el dialog abierto.
    } finally {
      setSubmitting(false);
    }
  };

  // Dialog inline (reutilizamos los primitives del design system pero
  // sin extraer un wrapper porque el dialog es muy específico de este caso).
  return (
    <ForceDialog open={open} onOpenChange={onOpenChange} submitting={submitting}>
      <div className="space-y-3">
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Cobertura incompleta
              </p>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-1 leading-relaxed">
                {uncoveredComponents.length} componente
                {uncoveredComponents.length !== 1 ? 's' : ''} sin story
                asignada. Los agentes del Forge podrían no implementarlos
                — quedarán fuera del scope.
              </p>
              <ul className="mt-2 space-y-0.5 text-[11px] font-mono text-amber-700 dark:text-amber-400">
                {uncoveredComponents.map((name) => (
                  <li key={name} className="flex items-center gap-1.5">
                    <span className="text-amber-500">·</span> {name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="force-justification"
            className="text-xs font-medium text-foreground block"
          >
            Justificación (mínimo 10 caracteres)
          </label>
          <textarea
            id="force-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Ej: estos componentes son decorativos y se cubren manualmente post-deploy."
            className={cn(
              'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
            )}
            aria-describedby="force-justification-help"
          />
          <p
            id="force-justification-help"
            className="text-[11px] text-muted-foreground"
          >
            Este texto queda en el log de envío. Sé específico — alguien
            (incluso tú dentro de un mes) leerá esto al hacer post-mortem.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleConfirm}
          disabled={!isValid || submitting}
          className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <AlertTriangle className="h-3.5 w-3.5" />
          Forzar envío
        </Button>
      </div>
    </ForceDialog>
  );
}

// Wrapper liviano sobre Dialog primitives para no inflar el archivo con
// los re-exports. Mantiene la coherencia con EpicEnqueueDialog visualmente.
function ForceDialog({
  open,
  onOpenChange,
  submitting,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !submitting && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle
              className="h-4 w-4 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            Forzar envío al Forge
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            La cobertura del bundle no está completa. Los componentes
            faltantes NO serán implementados automáticamente. Esta acción
            queda registrada con tu justificación.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
