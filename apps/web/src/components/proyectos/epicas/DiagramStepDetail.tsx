'use client';

import { useEffect, useRef } from 'react';
import type { DiagramStep } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ArrowUpRight, ChevronLeft, ChevronRight, Loader2, Sparkles, X } from 'lucide-react';

interface DiagramStepDetailProps {
  step: DiagramStep;
  totalSteps: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  integrationFlowDocPath?: string;
  /**
   * Dispara la regeneración del documento de flujo (backfill). Cuando este
   * step no tiene `bulletpoints` por error del agente, el panel muestra un
   * CTA contextual que llama este callback. El backend re-corre el agente
   * sobre TODO el diagrama y emite summary + bullets para TODOS los steps
   * — al terminar, el `diagram_ready` pasa por el context y este panel
   * refleja los nuevos bullets sin reload.
   */
  onGenerateIntegrationDoc?: () => void;
  isGeneratingDoc?: boolean;
}

/**
 * Bottom panel con la sinopsis + bulletpoints del paso activo. Se monta
 * en el flex column del `DiagramFullPage`; su altura fija (`h-[280px]` vía
 * el contenedor padre) produce el "push" del canvas hacia arriba sin
 * transition explícita — ReactFlow reflea su ResizeObserver.
 *
 * El componente NO gestiona su propia visibilidad: el padre monta/desmonta
 * el bloque entero cuando `clickedStep` cambia. Esto mantiene el árbol de
 * DOM limpio (sin estilos `display: none`) y evita estados stale.
 */
export function DiagramStepDetail({
  step,
  totalSteps,
  onClose,
  onPrev,
  onNext,
  integrationFlowDocPath,
  onGenerateIntegrationDoc,
  isGeneratingDoc = false,
}: DiagramStepDetailProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus inicial al botón Cerrar + re-focus al navegar entre pasos con
  // prev/next. Acción más probable post-lectura → primer foco útil para
  // teclado. Dep `step.id` garantiza que cambiar de paso mantiene el flow.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [step.id]);

  const padded = String(step.order).padStart(2, '0');
  const summaryText = step.summary || step.description || '';
  const hasSummary = summaryText.length > 0;
  const bullets = step.bulletpoints ?? [];
  const hasBullets = bullets.length > 0;

  const docHref = integrationFlowDocPath
    ? `/proyectos/definiciones?path=${encodeURIComponent(integrationFlowDocPath)}${
        step.docAnchor ? `#${step.docAnchor}` : ''
      }`
    : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        role="region"
        aria-label="Detalles del paso"
        className="h-full border-t border-border/60 bg-background/98 backdrop-blur-sm px-8 py-4 flex flex-col animate-in slide-in-from-bottom-4 fade-in duration-200"
      >
        <div className="flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-full bg-indigo-500/15 flex items-center justify-center">
              <span className="text-indigo-400 font-bold text-sm tabular-nums">{padded}</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate leading-tight">{step.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paso {step.order} de {totalSteps}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={!onPrev}
                  onClick={onPrev}
                  aria-label="Paso anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Anterior</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={!onNext}
                  onClick={onNext}
                  aria-label="Paso siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Siguiente</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={closeButtonRef}
                  size="icon"
                  variant="ghost"
                  onClick={onClose}
                  aria-label="Cerrar detalles del paso"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Cerrar</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6 mt-3 flex-1 min-h-0 overflow-y-auto">
          <div className="rounded-xl bg-muted/30 border border-border/40 p-4">
            <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
              Sinopsis
            </div>
            {hasSummary ? (
              <p className="text-sm leading-relaxed text-foreground">{summaryText}</p>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground italic">
                Este paso no tiene sinopsis disponible.
              </p>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
              Puntos clave
            </div>
            {hasBullets ? (
              <ul className="space-y-1.5">
                {bullets.map((b, i) => (
                  <li
                    key={`${step.id}-b-${i}`}
                    className="flex gap-3 items-start text-sm leading-snug"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm leading-relaxed text-muted-foreground italic">
                  El agente aún no emitió puntos clave para este paso.
                </p>
                {onGenerateIntegrationDoc ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onGenerateIntegrationDoc}
                    disabled={isGeneratingDoc}
                  >
                    {isGeneratingDoc ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generando puntos clave...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                        Generar puntos clave
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            )}

            {docHref ? (
              <a
                href={docHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-4"
              >
                Ver paso completo en el documento
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
