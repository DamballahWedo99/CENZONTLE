'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { useDiagramCacheHydration } from '@/hooks/useDiagramCacheHydration';
import { DiagramViewer } from './DiagramViewer';
import { DiagramStepsPanel } from './DiagramStepsPanel';
import { DiagramStepDetail } from './DiagramStepDetail';
import { EpicDiagram } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { GitBranch, Loader2 } from 'lucide-react';
import { generateIntegrationDoc } from '@/lib/diagram-agent';

interface DiagramFullPageProps {
  epicId: string;
}

export function DiagramFullPage({ epicId }: DiagramFullPageProps) {
  const { state, dispatch } = useProyectos();

  // Hidrata desde Redis si el diagrama no está en memoria. Crítico aquí
  // porque esta ruta se abre en una TAB NUEVA vía `target="_blank"` desde
  // `EpicDiagrams`: el Provider arranca con state vacío, el diagrama nunca
  // llegó a este Context y sin hidratar veríamos "No hay diagrama generado".
  // `isHydrating` es true durante la ventana de fetch a Redis (~50-300ms).
  const { isHydrating } = useDiagramCacheHydration(epicId, 'business');

  // Hover y click coexisten: hover da preview efímero, click fija un paso
  // persistente. El active visible resuelve con precedencia hover > click
  // para que el preview sobrescriba temporalmente al pinned sin perderlo.
  const [hoveredStepId, setHoveredStepId] = useState<string | null>(null);
  const [clickedStepId, setClickedStepId] = useState<string | null>(null);
  const activeStepId = hoveredStepId ?? clickedStepId;

  // Estado del backfill del documento de flujo de integración. Se activa
  // cuando el user dispara el CTA "Generar documento de flujo" desde el
  // panel; se apaga al recibir `done`/`error`/`run_finished` del SSE.
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);

  // Estado de colapso del sidepanel izquierdo de pasos. Cuando está
  // colapsado, se reemplaza por un rail estrecho con solo un botón para
  // re-abrirlo — da más espacio al canvas para presentaciones/demos.
  const [isStepsPanelCollapsed, setIsStepsPanelCollapsed] = useState(false);

  const rawEpic = state.epics.find((e) => e.id === epicId);
  const businessDiagram = rawEpic?.diagrams.find((d) => d.type === 'business');

  const highlightedNodeIds = useMemo<Set<string>>(() => {
    if (!activeStepId || !businessDiagram?.steps) return new Set();
    const step = businessDiagram.steps.find((s) => s.id === activeStepId);
    return step ? new Set(step.nodeIds) : new Set();
  }, [activeStepId, businessDiagram?.steps]);

  // El paso clickeado alimenta el bottom panel. Se busca por `clickedStepId`
  // (fuente persistente) ignorando el hover efímero — queremos que el
  // panel inferior refleje el PIN del usuario, no un preview transitorio.
  const clickedStep = useMemo(() => {
    if (!clickedStepId || !businessDiagram?.steps) return null;
    return businessDiagram.steps.find((s) => s.id === clickedStepId) ?? null;
  }, [clickedStepId, businessDiagram?.steps]);

  // focusNodeIds viaja al viewer para disparar zoom/pan al grupo de nodos
  // del paso. DELIBERADAMENTE derivado del click (no del hover) — el hover
  // solo ilumina, el click ancla la cámara. Null cuando no hay paso
  // clickeado → el viewer hace fitView panorámico (restaura).
  const focusNodeIds = useMemo<string[] | null>(() => {
    return clickedStep ? clickedStep.nodeIds : null;
  }, [clickedStep]);

  // Navegación prev/next por `order` (1..N). `undefined` cuando no hay
  // paso anterior/siguiente — el child deshabilita los botones respectivos.
  const handlePrevStep = useCallback(() => {
    if (!clickedStep || !businessDiagram?.steps) return;
    const prev = businessDiagram.steps.find((s) => s.order === clickedStep.order - 1);
    if (prev) setClickedStepId(prev.id);
  }, [clickedStep, businessDiagram?.steps]);

  const handleNextStep = useCallback(() => {
    if (!clickedStep || !businessDiagram?.steps) return;
    const next = businessDiagram.steps.find((s) => s.order === clickedStep.order + 1);
    if (next) setClickedStepId(next.id);
  }, [clickedStep, businessDiagram?.steps]);

  const handleCloseDetail = useCallback(() => {
    setClickedStepId(null);
  }, []);

  const hasPrevStep = clickedStep ? clickedStep.order > 1 : false;
  const hasNextStep =
    clickedStep && businessDiagram?.steps
      ? clickedStep.order < businessDiagram.steps.length
      : false;

  /**
   * Dispara el backfill del documento de flujo de integración. El backend:
   *   1. Lee el diagrama cacheado.
   *   2. Corre un agente Claude que investiga y emite steps + markdown.
   *   3. Escribe el doc al vault y emite `document_ready` + `diagram_ready`.
   *
   * Manejo de eventos:
   *   - `document_ready` → toast de éxito con el path.
   *   - `diagram_ready` → dispatch al context para que el sidepanel
   *     reciba los nuevos `steps` y el `integrationFlowDocPath` sin
   *     re-fetch de Redis.
   *   - `error` → toast de error + guard contra futuros eventos.
   *   - `run_finished`/`done` → apagar el spinner.
   *
   * Definido ANTES de los early returns para respetar Rules of Hooks: el
   * `useCallback` debe ejecutarse en el mismo slot en cada render, incluso
   * mientras `businessDiagram` es undefined (estado de loading/hidratación).
   * El guard `if (!businessDiagram) return` dentro del callback evita que
   * se dispare antes de tener un diagrama válido.
   */
  const handleGenerateIntegrationDoc = useCallback(async () => {
    if (!businessDiagram) return;
    setIsGeneratingDoc(true);

    let emittedDiagram: EpicDiagram | null = null;
    let errorReported = false;

    toast.info('Generando documento de flujo de integración...', {
      description: 'El agente está investigando el flujo sobre el diagrama actual.',
    });

    try {
      await generateIntegrationDoc(epicId, 'business', (event) => {
        if (event.type === 'document_ready') {
          const truncatedPath =
            event.path.length > 60 ? `${event.path.slice(0, 57)}...` : event.path;
          toast.success('Documento de flujo guardado en el vault', {
            description: truncatedPath,
          });
        } else if (event.type === 'diagram_ready') {
          emittedDiagram = event.diagram;
          dispatch({
            type: 'UPDATE_EPIC_DIAGRAM',
            payload: { epicId, diagram: event.diagram },
          });
        } else if (event.type === 'error' && !errorReported) {
          errorReported = true;
          toast.error('No fue posible generar el documento', {
            description: event.message,
          });
        }
      });
    } catch (err) {
      if (!errorReported) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        toast.error('No fue posible generar el documento', { description: message });
      }
    } finally {
      if (!emittedDiagram && !errorReported) {
        toast.error('El agente finalizó sin emitir el documento.');
      }
      setIsGeneratingDoc(false);
    }
  }, [epicId, businessDiagram, dispatch]);

  // Nota: no seteamos breadcrumb aquí — el layout raíz `FullscreenOrChrome`
  // detecta la ruta `/diagrama` y NO renderiza `DashboardHeader`, por lo que
  // un breadcrumb quedaría orphan. La ruta es una vista de presentación
  // del canvas, no parte de la navegación del dashboard.

  // Mientras el Provider carga los datos iniciales (típico en una tab nueva
  // donde arranca sin state hidratado), mostramos un spinner en vez del
  // mensaje "Épica no encontrada" que sería engañoso durante el loading.
  if (state.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Cargando épica...</p>
      </div>
    );
  }

  if (!rawEpic) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-sm text-muted-foreground">Épica no encontrada</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/proyectos">Volver a proyectos</Link>
        </Button>
      </div>
    );
  }

  // Durante la ventana de hidratación del cache Redis, no queremos
  // mostrar el estado "sin diagrama" — sería falso positivo visual de ~200ms.
  // Mostramos spinner hasta que el fetch termina; si tras terminar realmente
  // no hay diagrama (cache vacío / TTL caducado), caemos al branch siguiente.
  if (isHydrating) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Cargando diagrama desde caché...</p>
      </div>
    );
  }

  if (!businessDiagram) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <GitBranch className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No hay diagrama de negocio generado</p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/proyectos/epicas/${epicId}?tab=diagramas`}>Volver a la épica</Link>
        </Button>
      </div>
    );
  }

  const handleDiagramChange = (diagram: EpicDiagram) => {
    dispatch({ type: 'UPDATE_EPIC_DIAGRAM', payload: { epicId, diagram } });
  };

  // Vista 100 % canvas — sin top bar ni chrome alrededor. El layout raíz
  // (FullscreenOrChrome) detecta el pathname `/diagrama` y ya remueve
  // sidebar + dashboard header. Layout interno: flex column con la fila
  // sidepanel+viewer arriba y el bottom panel de detalle del paso abajo
  // (solo visible cuando hay un step clickeado).
  //
  // `min-h-0` en la fila superior es CRÍTICO: sin él, `flex-1` ignora las
  // restricciones del padre y el bottom panel se sale del viewport.
  // ReactFlow tiene su propio ResizeObserver interno, así que al reducir
  // la altura del contenedor del viewer, re-fitea el diagrama sin tocarlo.
  const totalSteps = businessDiagram.steps?.length ?? 0;
  // Ancho del sidepanel alterna entre rail estrecho (colapsado) y el panel
  // completo. Transition suave en el width para que la "apertura" se sienta
  // continua, no salto abrupto.
  const sidepanelWidthClass = isStepsPanelCollapsed ? 'w-12' : 'w-80';
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 min-h-0 w-full">
        <div className={`${sidepanelWidthClass} shrink-0 transition-[width] duration-200 ease-out`}>
          <DiagramStepsPanel
            steps={businessDiagram.steps}
            integrationFlowDocPath={businessDiagram.integrationFlowDocPath}
            onHoverStep={setHoveredStepId}
            activeStepId={clickedStepId}
            onClickStep={setClickedStepId}
            onGenerateIntegrationDoc={handleGenerateIntegrationDoc}
            isGeneratingDoc={isGeneratingDoc}
            isCollapsed={isStepsPanelCollapsed}
            onToggleCollapse={() => setIsStepsPanelCollapsed((v) => !v)}
          />
        </div>
        {/* Padding externo al viewer para el efecto "flote" tipo Lovable —
            combinado con el `rounded-2xl` interno del viewer da la tarjeta
            del board con aire respirado alrededor. */}
        <div className="flex-1 min-w-0 p-3">
          <DiagramViewer
            diagram={businessDiagram}
            editable
            fullHeight
            epicId={epicId}
            onDiagramChange={handleDiagramChange}
            highlightedNodeIds={highlightedNodeIds}
            focusNodeIds={focusNodeIds}
            onStepFromNode={setClickedStepId}
          />
        </div>
      </div>
      {clickedStep ? (
        <div className="shrink-0 h-[240px]">
          <DiagramStepDetail
            step={clickedStep}
            totalSteps={totalSteps}
            onClose={handleCloseDetail}
            onPrev={hasPrevStep ? handlePrevStep : undefined}
            onNext={hasNextStep ? handleNextStep : undefined}
            integrationFlowDocPath={businessDiagram.integrationFlowDocPath}
            onGenerateIntegrationDoc={handleGenerateIntegrationDoc}
            isGeneratingDoc={isGeneratingDoc}
            epicTitle={rawEpic?.title}
          />
        </div>
      ) : null}
    </div>
  );
}
