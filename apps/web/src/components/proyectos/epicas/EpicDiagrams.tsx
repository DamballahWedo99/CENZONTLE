'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Epic, EpicDiagram } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
import { DiagramViewer } from './DiagramViewer';
import {
  streamDiagramGeneration,
  getDiagramSession,
  cancelDiagramGeneration,
  type DiagramGenerationEventWithMeta,
} from '@/lib/diagram-agent';
import { AgentThinkingDisplay } from '@/components/proyectos/overview/agent-thinking';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';
import {
  Sparkles,
  GitBranch,
  Loader2,
  Maximize2,
} from 'lucide-react';

interface EpicDiagramsProps {
  epic: Epic;
  diagrams: EpicDiagram[];
  onDiagramGenerated: (diagram: EpicDiagram) => void;
  onDiagramEdited: (diagram: EpicDiagram) => void;
  /**
   * Callback opcional invocado cuando el backend emite `document_ready`.
   * El padre (EpicFullPage) lo usa para refrescar la lista de documentos
   * de la épica, ya que el backend habrá registrado el .md del vault en
   * `epic.documents[]` antes de emitir el evento.
   */
  onDocumentReady?: () => void;
}

export function EpicDiagrams({
  epic,
  diagrams,
  onDiagramGenerated,
  onDiagramEdited,
  onDocumentReady,
}: EpicDiagramsProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [events, setEvents] = useState<DiagramGenerationEventWithMeta[]>([]);

  // Mantiene pantalla activa durante diagram generation. Sin esto, system
  // sleep mata el SSE con `terminated` y el progreso visual del agente se
  // pierde aunque el backend complete.
  useScreenWakeLock(isGenerating);
  // Confirmación antes de regenerar: regenerar con IA sobrescribe el diagrama
  // existente (incluyendo ediciones manuales y posiciones personalizadas).
  // Solo se pide confirmación si ya hay un diagrama — la primera generación
  // no tiene qué perder.
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);

  // Buffer para el metadata del documento de integración emitido por el
  // evento `document_ready`. El backend lo emite ANTES de `diagram_ready`,
  // así que cuando llega aún no existe un diagrama en el state local al
  // que anclar los campos. Guardamos el payload aquí y lo aplicamos dentro
  // del handler del `diagram_ready` (o, si el diagrama ya existía en `diagrams`,
  // al instante via `onDiagramEdited`).
  //
  // `useRef` en vez de `useState` porque el valor vive durante el iterador
  // async y no queremos re-renderizar el componente entre eventos — sólo
  // consumirlo en el siguiente tick lógico.
  const pendingDocRef = useRef<{
    diagramType: EpicDiagram['type'];
    path: string;
    generatedAt: string;
  } | null>(null);

  const businessDiagram = diagrams.find((d) => d.type === 'business');
  const showThinking = isGenerating || events.length > 0;

  // Ref para el AbortController del SSE local — evita que el polling effect
  // arranque cuando este cliente ya está escuchando vía SSE.
  const sseAbortRef = useRef<AbortController | null>(null);

  // Hidratar la sesión SSE cacheada al mount — sobrevive a refresh / cambio
  // de pestaña. Si el agente sigue corriendo en background (status='streaming')
  // marca isGenerating=true para activar el polling effect siguiente.
  useEffect(() => {
    if (!epic.id) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await getDiagramSession(epic.id, 'business');
        if (cancelled || !session) return;
        if (session.events.length > 0) {
          setEvents(session.events);
          // Si la sesión sigue 'streaming' Y el último event no es un terminal,
          // asumimos que el agente sigue corriendo en background.
          const lastEvent = session.events[session.events.length - 1];
          const isFinal =
            lastEvent?.type === 'run_finished' ||
            lastEvent?.type === 'done' ||
            lastEvent?.type === 'diagram_ready' ||
            lastEvent?.type === 'error';
          if (session.status === 'streaming' && !isFinal) {
            setIsGenerating(true);
          }
        }
      } catch {
        // Cache no disponible — ignorar, el flujo idle es válido.
      }
    })();
    return () => { cancelled = true; };
  }, [epic.id]);

  // Polling cuando el agente sigue corriendo en otra tab/sesión y este
  // cliente no tiene SSE local activo. Cada 3s relee el cache; si llegan
  // events nuevos, hidrata. Cuando status='staging' o llega diagram_ready,
  // dispatcha el diagrama al state global y para polling.
  // Stale detection: 5 min sin nuevos events → asume run muerto. Sube de
  // los 60s anteriores porque iter4 con tool_use grande puede pasar 4+ min
  // dentro de un solo messages.stream sin emitir cambios visibles al cache.
  useEffect(() => {
    if (!epic.id || !isGenerating) return;
    // Si abortRef del SSE local está activo, no necesitamos polling
    // (el stream ya está alimentando events directamente).
    if (sseAbortRef.current) return;

    let cancelled = false;
    const POLL_INTERVAL_MS = 3000;
    const STALE_THRESHOLD_TICKS = 100; // 100 × 3s = 5min
    let lastEventCount = -1;
    let staleTickCount = 0;

    /**
     * Busca un evento `diagram_ready` en la lista de events del cache.
     * Si existe, dispatcha el diagrama al state global vía onDiagramGenerated.
     * Crítico: cuando el SSE local se desconectó pero el agente terminó en
     * background, el cache contiene el diagrama y necesitamos aplicarlo
     * sin requerir refresh manual del user.
     */
    const tryApplyDiagramFromEvents = (events: DiagramGenerationEventWithMeta[]) => {
      for (const ev of events) {
        if (ev.type === 'diagram_ready' && (ev as { diagram?: EpicDiagram }).diagram) {
          const diagram = (ev as { diagram: EpicDiagram }).diagram;
          // Buscar document_ready previo para hidratar campos del integration doc.
          const docEvent = events.find((e) => e.type === 'document_ready') as
            | { path?: string; generatedAt?: string }
            | undefined;
          const merged: EpicDiagram = {
            ...diagram,
            integrationFlowDocPath: diagram.integrationFlowDocPath ?? docEvent?.path,
            integrationFlowGeneratedAt: diagram.integrationFlowGeneratedAt ?? docEvent?.generatedAt,
          };
          onDiagramGenerated(merged);
          return true;
        }
      }
      return false;
    };

    const tick = async () => {
      if (cancelled) return;
      // Guard de mid-tick: si entre el setInterval y este tick el user
      // disparó handleGenerate (→ pobló sseAbortRef), saltamos para no
      // duplicar el dispatch. El effect deps `[epic.id, isGenerating]` no
      // re-ejecuta el effect porque isGenerating ya era true cuando arrancó
      // el polling, así que sin este chequeo, el setInterval seguía vivo
      // mientras el SSE local también dispatchaba el diagrama.
      if (sseAbortRef.current) return;
      try {
        const session = await getDiagramSession(epic.id, 'business');
        if (cancelled) return;
        if (!session) {
          setIsGenerating(false);
          cancelled = true;
          return;
        }
        setEvents(session.events);
        const lastEvent = session.events[session.events.length - 1];
        const isFinal =
          lastEvent?.type === 'run_finished' ||
          lastEvent?.type === 'done' ||
          lastEvent?.type === 'diagram_ready' ||
          lastEvent?.type === 'error';
        if (session.status === 'staging' || isFinal) {
          // Agente terminó. Intentar aplicar el diagrama si está en events.
          const applied = tryApplyDiagramFromEvents(session.events);
          if (applied) {
            // Limpiar cache de sesión — el diagrama ya está en DiagramCacheService (5d).
            cancelDiagramGeneration(epic.id, 'business').catch(() => {});
          }
          setIsGenerating(false);
          cancelled = true;
          return;
        }
        if (session.events.length === lastEventCount) {
          staleTickCount++;
          if (staleTickCount >= STALE_THRESHOLD_TICKS) {
            // Última oportunidad: si por algún motivo hay un diagram_ready
            // que no detectamos antes, aplicarlo ahora.
            tryApplyDiagramFromEvents(session.events);
            setIsGenerating(false);
            cancelled = true;
            return;
          }
        } else {
          lastEventCount = session.events.length;
          staleTickCount = 0;
        }
      } catch {
        // Tick transitorio falló — siguiente reintenta.
      }
    };

    void tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [epic.id, isGenerating]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setEvents([]);
    pendingDocRef.current = null;

    // AbortController para el SSE local. Almacenado en sseAbortRef para que
    // el polling effect lo detecte y NO duplique el polling cuando este
    // cliente ya tiene SSE activo alimentando events directamente.
    const controller = new AbortController();
    sseAbortRef.current = controller;

    const collected: DiagramGenerationEventWithMeta[] = [];
    let emittedDiagram: EpicDiagram | null = null;
    let lastError: string | null = null;

    let userCancelled = false;
    try {
      for await (const event of streamDiagramGeneration(epic, 'business', { signal: controller.signal })) {
        collected.push(event);
        setEvents([...collected]);
        if (event.type === 'diagram_ready') {
          // Si `document_ready` llegó primero (caso normal), aplicamos sus
          // campos al diagrama antes de propagarlo al padre — así el state
          // global queda consistente en un único dispatch. El backend
          // típicamente ya setea estos campos antes de `saveDiagram`, pero
          // nos aseguramos de no perderlos si hubo desincronía (p.ej. cache
          // servido sin los campos nuevos).
          const pending = pendingDocRef.current;
          if (pending && pending.diagramType === event.diagram.type) {
            emittedDiagram = {
              ...event.diagram,
              integrationFlowDocPath: event.diagram.integrationFlowDocPath ?? pending.path,
              integrationFlowGeneratedAt:
                event.diagram.integrationFlowGeneratedAt ?? pending.generatedAt,
            };
            pendingDocRef.current = null;
          } else {
            emittedDiagram = event.diagram;
          }
          // Dispatch INMEDIATO al store global — antes esperábamos al cierre
          // del for-await loop, pero si la SSE tarda en cerrar tras
          // `run_finished` (proxy timeout, latencia de red), el user veía
          // la UI "trabada" hasta que daba refresh y `useDiagramCacheHydration`
          // recogía el diagrama del cache backend. Aplicarlo aquí garantiza
          // render inmediato y no requiere acción del usuario.
          onDiagramGenerated(emittedDiagram);
        } else if (event.type === 'document_ready') {
          // Toast informativo — el path puede ser largo; recortar a 60 chars
          // para no reventar el toast component (sonner respeta layout pero
          // los paths del vault pueden superar los 100 chars).
          const truncatedPath =
            event.path.length > 60 ? `${event.path.slice(0, 57)}...` : event.path;
          toast.success('Documento de flujo de integración guardado en el vault', {
            description: truncatedPath,
          });

          // Buscar el diagrama correspondiente en el state actual (props).
          // Si existe (regeneración sobre un diagrama previo), lo actualizamos
          // inmediatamente vía `onDiagramEdited` para que el context refleje
          // los nuevos campos incluso si el `diagram_ready` tarda.
          //
          // Si no existe (primera generación o el diagrama aún no está en
          // props), guardamos en el ref y lo aplicaremos cuando llegue
          // `diagram_ready`.
          const existing = diagrams.find((d) => d.type === event.diagramType);
          if (existing) {
            onDiagramEdited({
              ...existing,
              integrationFlowDocPath: event.path,
              integrationFlowGeneratedAt: event.generatedAt,
            });
          } else {
            pendingDocRef.current = {
              diagramType: event.diagramType,
              path: event.path,
              generatedAt: event.generatedAt,
            };
          }
          // Notificar al padre para que refresque epic.documents[] — el
          // backend ya habrá registrado el .md del vault como EpicDocument.
          onDocumentReady?.();
        } else if (event.type === 'error') {
          lastError = event.message;
        }
      }
    } catch (err) {
      // AbortError es comportamiento esperado cuando el user da Cancel.
      // No es un error real — no mostrar toast rojo. El handler de cancel
      // ya limpió la UI a idle y borró el cache via cancelDiagramGeneration.
      const errName = (err as { name?: string })?.name;
      if (errName === 'AbortError' || controller.signal.aborted) {
        userCancelled = true;
      } else {
        lastError = err instanceof Error ? err.message : 'Error desconocido al generar el diagrama.';
      }
    }

    if (userCancelled) {
      // Cancel intencional: NO toast, NO error. UI ya está en idle.
    } else if (emittedDiagram) {
      // El dispatch ya ocurrió al recibir `diagram_ready` arriba — no
      // duplicamos aquí. Solo verificamos que tengamos un diagrama emitido
      // para no caer al else-branch del error.
    } else {
      const description = lastError ?? 'El agente finalizó sin emitir un diagrama.';
      toast.error('No fue posible generar el diagrama', { description });
    }
    pendingDocRef.current = null;
    sseAbortRef.current = null;
    setIsGenerating(false);

    // Cuando el run termina exitosamente Y el cliente recibió el diagrama
    // localmente, limpiamos el cache de sesión para no mostrar la cadena
    // de pensamiento "stale" en futuros mounts (el diagrama ya está
    // persistido en el cache de DiagramCacheService de 5 días).
    if (emittedDiagram) {
      cancelDiagramGeneration(epic.id, 'business').catch(() => {});
    }
  }, [epic, diagrams, onDiagramGenerated, onDiagramEdited, onDocumentReady]);

  const handleConfirmRegenerate = useCallback(() => {
    setConfirmRegenerateOpen(false);
    handleGenerate();
  }, [handleGenerate]);

  /**
   * Cancela la generación en curso. Doble cancelación (mismo patrón que
   * épicas):
   *   1. AbortController local — cierra el SSE de este cliente.
   *   2. DELETE /session/active al backend — aborta el agente Anthropic +
   *      invalida cache de sesión. Sin (2), tras `req.close` el backend
   *      dejaba el agente corriendo en background hasta el timeout de 10min.
   *
   * Fire-and-forget — el user no espera la respuesta del DELETE para que
   * la UI vuelva a idle al instante.
   */
  const handleCancelGeneration = useCallback(() => {
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    if (epic.id) {
      cancelDiagramGeneration(epic.id, 'business').catch(() => {});
    }
    setIsGenerating(false);
    setEvents([]);
  }, [epic.id]);

  // No diagram yet — show generation prompt
  if (!businessDiagram) {
    return (
      <div className="space-y-4">
        {showThinking && (
          <AgentThinkingDisplay
          events={events}
          isStreaming={isGenerating}
          onCancel={isGenerating ? handleCancelGeneration : undefined}
        />
        )}
        <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-4 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Genera el diagrama de negocio con IA</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              El agente analizará la definición de esta épica, leerá código y documentación reales, y generará el diagrama de flujo de negocio automáticamente.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="gap-2 mt-2"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            Generar Diagrama de Negocio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Agent thinking — shown above the diagram while streaming and persisted after */}
      {showThinking && (
        <AgentThinkingDisplay
          events={events}
          isStreaming={isGenerating}
          onCancel={isGenerating ? handleCancelGeneration : undefined}
        />
      )}

      {/* Header with regenerate */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <GitBranch className="h-4 w-4" />
          Diagrama de Negocio
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRegenerateOpen(true)}
            disabled={isGenerating}
            className="gap-1.5 text-xs h-7 text-muted-foreground"
          >
            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Regenerar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs h-7 text-muted-foreground"
            asChild
          >
            {/*
              `target="_blank"` abre la vista dedicada del diagrama en una
              nueva pestaña para que el usuario pueda seguir viendo la épica
              en la original. `rel="noopener noreferrer"` es convención
              defensiva: previene reverse tabnabbing (que el destino acceda
              a window.opener) y no filtra el Referer del origen.
            */}
            <Link
              href={`/proyectos/epicas/${epic.id}/diagrama`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Maximize2 className="h-3 w-3" />
              Página completa
            </Link>
          </Button>
        </div>
      </div>

      {/* Editable Diagram — pasamos epicId para que el viewer active
          auto-save al cache Redis con debounce 500ms durante edición. */}
      <DiagramViewer
        diagram={businessDiagram}
        editable
        epicId={epic.id}
        onDiagramChange={onDiagramEdited}
      />

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {businessDiagram.nodes.length} nodos · {businessDiagram.edges.length} conexiones
        </span>
        <span>
          Generado por {businessDiagram.generatedBy === 'ai' ? 'IA' : 'usuario'} · {new Date(businessDiagram.generatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Confirmación type-to-confirm antes de regenerar. Regenerar es una
          operación destructiva: sobrescribe el diagrama persistido en Postgres
          y borra el documento de flujo (pasos) asociado del vault. Por eso
          exigimos que el user escriba "regenerar diagrama" literal —  fricción
          proporcional al impacto, el mismo patrón que el delete de iniciativas. */}
      <TypeToConfirmDialog
        open={confirmRegenerateOpen}
        onOpenChange={setConfirmRegenerateOpen}
        title="Regenerar diagrama con IA"
        resourceLabel="acción"
        expectedValue="regenerar diagrama"
        description="Se reemplazará el diagrama actual, incluyendo ediciones manuales, posiciones personalizadas, tema de colores, Y el documento de pasos del flujo de integración del vault. Esta acción NO se puede deshacer."
        confirmText="Regenerar diagrama"
        cancelText="Conservar"
        onConfirm={handleConfirmRegenerate}
      />
    </div>
  );
}
