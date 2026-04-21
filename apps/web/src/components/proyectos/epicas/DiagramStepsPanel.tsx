'use client';

import type { DiagramStep } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronDown, ChevronLeft, ChevronRight, FileText, GitBranch, ListOrdered, Loader2 } from 'lucide-react';

interface DiagramStepsPanelProps {
  steps: DiagramStep[] | undefined;
  integrationFlowDocPath?: string;
  /** Hover transitorio sobre un paso — dispara highlight temporal en el viewer. */
  onHoverStep: (stepId: string | null) => void;
  /** Click fija el paso como activo — highlight persistente. */
  activeStepId: string | null;
  onClickStep: (stepId: string | null) => void;
  /** Callback para disparar el backfill cuando steps es undefined/vacío. */
  onGenerateIntegrationDoc?: () => void;
  isGeneratingDoc?: boolean;
  /**
   * Cuando true, el panel se renderiza como un rail estrecho con solo un
   * botón para re-abrirlo. Libera espacio para el canvas en demos y
   * presentaciones donde la lista de pasos es distracción.
   */
  isCollapsed?: boolean;
  /** Toggle handler — controlado por el padre (DiagramFullPage). */
  onToggleCollapse?: () => void;
}

export function DiagramStepsPanel({
  steps,
  integrationFlowDocPath,
  onHoverStep,
  activeStepId,
  onClickStep,
  onGenerateIntegrationDoc,
  isGeneratingDoc = false,
  isCollapsed = false,
  onToggleCollapse,
}: DiagramStepsPanelProps) {
  const hasSteps = Array.isArray(steps) && steps.length > 0;

  // Modo colapsado: rail estrecho con el icono del panel y un chevron para
  // re-abrir. Botón full-height y full-width para que sea fácil de acertar
  // cuando el user quiere volver a ver los pasos.
  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-col h-full border-r border-border/50 bg-background">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Expandir pasos del flujo"
                className="h-12 w-full border-b border-border/50 flex items-center justify-center hover:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expandir pasos del flujo</TooltipContent>
          </Tooltip>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <ListOrdered className="h-5 w-5 text-muted-foreground/50" />
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex flex-col h-full border-r border-border/50 bg-background">
      <div className="h-12 border-b border-border/50 flex items-center justify-between pl-4 pr-2 shrink-0">
        <h2 className="text-sm font-semibold">Pasos del flujo</h2>
        {onToggleCollapse ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={onToggleCollapse}
                aria-label="Colapsar pasos del flujo"
                className="h-7 w-7"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Colapsar panel</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {hasSteps ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ul className="flex flex-col">
              {steps!.map((step) => {
                const isActive = step.id === activeStepId;
                return (
                  <li key={step.id}>
                    {/*
                      Hover y click coexisten intencionalmente: el hover da preview
                      efímero (se pierde al salir), el click fija el paso para que
                      el usuario pueda mover el mouse al canvas sin perder el foco.
                    */}
                    <button
                      type="button"
                      onMouseEnter={() => onHoverStep(step.id)}
                      onMouseLeave={() => onHoverStep(null)}
                      onClick={() =>
                        onClickStep(isActive ? null : step.id)
                      }
                      aria-pressed={isActive}
                      className={[
                        'w-full text-left px-4 py-3 border-b border-border/30 transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                        isActive
                          ? 'bg-muted/50 border-l-2 border-l-indigo-400'
                          : 'hover:bg-muted/30',
                      ].join(' ')}
                    >
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 text-xs font-mono text-muted-foreground mt-0.5 tabular-nums">
                          {String(step.order).padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-snug">
                            {step.title}
                          </p>
                          <p
                            className="text-xs text-muted-foreground mt-1 leading-relaxed overflow-hidden"
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {step.description}
                          </p>
                        </div>
                        {/* Indicador visual de "detalles abiertos abajo" cuando el
                            paso está pinned por click. Complementa el border-l-2
                            que ya comunica "activo", añadiendo el hint direccional
                            para que el usuario asocie el sidebar con el bottom panel. */}
                        {isActive ? (
                          <ChevronDown
                            className="h-3 w-3 text-indigo-400 shrink-0 mt-1"
                            aria-label="Detalles abajo"
                          />
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {integrationFlowDocPath ? (
            <div className="shrink-0 border-t border-border/50 p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                asChild
              >
                <a
                  href={`/proyectos/definiciones?path=${encodeURIComponent(integrationFlowDocPath)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText className="h-4 w-4" />
                  Ver documento completo
                </a>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <GitBranch className="h-8 w-8 text-muted-foreground/30" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Sin documento de flujo</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Este diagrama no tiene pasos asociados todavía.
              <br />
              Genera el documento para navegar el flujo paso a paso.
            </p>
          </div>
          {onGenerateIntegrationDoc ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onGenerateIntegrationDoc}
              disabled={isGeneratingDoc}
              className="mt-2"
            >
              {isGeneratingDoc ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generando...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Generar documento de flujo
                </>
              )}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground/70 mt-2">
              Este diagrama no tiene documento asociado.
            </p>
          )}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
