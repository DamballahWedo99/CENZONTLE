'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Epic, EpicDiagram } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DiagramViewer } from './DiagramViewer';
import { streamDiagramGeneration, type DiagramGenerationEventWithMeta } from '@/lib/diagram-agent';
import { AgentThinkingDisplay } from '@/components/proyectos/overview/agent-thinking';
import {
  Sparkles,
  GitBranch,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Maximize2,
} from 'lucide-react';

interface EpicDiagramsProps {
  epic: Epic;
  diagrams: EpicDiagram[];
  onDiagramGenerated: (diagram: EpicDiagram) => void;
  onDiagramEdited: (diagram: EpicDiagram) => void;
  tlApproval: Epic['tlApproval'];
  onTlApprove: () => void;
  onTlReject: (comment: string) => void;
}

export function EpicDiagrams({
  epic,
  diagrams,
  onDiagramGenerated,
  onDiagramEdited,
  tlApproval,
  onTlApprove,
  onTlReject,
}: EpicDiagramsProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [events, setEvents] = useState<DiagramGenerationEventWithMeta[]>([]);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
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

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setEvents([]);
    pendingDocRef.current = null;

    const collected: DiagramGenerationEventWithMeta[] = [];
    let emittedDiagram: EpicDiagram | null = null;
    let lastError: string | null = null;

    try {
      for await (const event of streamDiagramGeneration(epic, 'business')) {
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
        } else if (event.type === 'error') {
          lastError = event.message;
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Error desconocido al generar el diagrama.';
    }

    if (emittedDiagram) {
      onDiagramGenerated(emittedDiagram);
    } else {
      const description = lastError ?? 'El agente finalizó sin emitir un diagrama.';
      toast.error('No fue posible generar el diagrama', { description });
    }
    pendingDocRef.current = null;
    setIsGenerating(false);
  }, [epic, diagrams, onDiagramGenerated, onDiagramEdited]);

  const handleReject = () => {
    if (!rejectComment.trim()) return;
    onTlReject(rejectComment.trim());
    setRejectComment('');
    setShowRejectForm(false);
  };

  const handleConfirmRegenerate = useCallback(() => {
    setConfirmRegenerateOpen(false);
    handleGenerate();
  }, [handleGenerate]);

  function formatShortDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  // No diagram yet — show generation prompt
  if (!businessDiagram) {
    return (
      <div className="space-y-4">
        {showThinking && (
          <AgentThinkingDisplay events={events} isStreaming={isGenerating} />
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
        <AgentThinkingDisplay events={events} isStreaming={isGenerating} />
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

      {/* TL Approval Section */}
      <div className="rounded-xl border p-5">
        {!tlApproval && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-indigo-900 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Visto Bueno del Technical Leader</p>
                <p className="text-xs text-muted-foreground">
                  El TL debe validar que el diagrama de negocio sea correcto antes de generar historias
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRejectForm(true)}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <XCircle className="h-3.5 w-3.5" />
                Rechazar
              </Button>
              <Button
                size="sm"
                onClick={onTlApprove}
                className="gap-1.5 bg-indigo-900 hover:bg-indigo-700 text-white"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aprobar
              </Button>
            </div>
          </div>
        )}

        {tlApproval?.status === 'approved' && (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-400">Diagrama aprobado por TL</p>
              <p className="text-xs text-muted-foreground">
                Aprobado por {tlApproval.approvedBy ?? 'TL'} · {tlApproval.approvedAt ? formatShortDate(tlApproval.approvedAt) : ''}
              </p>
            </div>
          </div>
        )}

        {tlApproval?.status === 'rejected' && (
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Diagrama rechazado por TL</p>
                <p className="text-xs text-muted-foreground">
                  Rechazado por {tlApproval.approvedBy ?? 'TL'} · {tlApproval.approvedAt ? formatShortDate(tlApproval.approvedAt) : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onTlApprove}
                className="gap-1.5 text-green-600 hover:text-green-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aprobar
              </Button>
            </div>
            {tlApproval.comment && (
              <div className="flex items-start gap-2 mt-3 ml-[52px] rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
                <MessageSquare className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-400">{tlApproval.comment}</p>
              </div>
            )}
          </div>
        )}

        {/* Reject form */}
        {showRejectForm && !tlApproval && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Describe qué cambios necesita el diagrama..."
              rows={3}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowRejectForm(false); setRejectComment(''); }}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleReject}
                disabled={!rejectComment.trim()}
                className="gap-1.5 bg-red-600 hover:bg-red-700 text-white"
              >
                Confirmar rechazo
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmación antes de regenerar. Pedimos confirmación SIEMPRE que
          haya un diagrama existente (puede tener ediciones manuales que se
          perderían). Si regenerar no tiene nada que perder, no se muestra
          porque el render de este header completo depende de `businessDiagram`. */}
      <ConfirmDialog
        open={confirmRegenerateOpen}
        onOpenChange={setConfirmRegenerateOpen}
        title="Regenerar diagrama con IA"
        description="Se reemplazará el diagrama actual. Las ediciones manuales, posiciones personalizadas y el tema de colores aplicado a los nodos se perderán. ¿Continuar?"
        confirmText="Regenerar"
        cancelText="Conservar"
        onConfirm={handleConfirmRegenerate}
      />
    </div>
  );
}
