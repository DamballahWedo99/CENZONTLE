'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Epic, EpicDiagram } from '@/types/proyectos';
import { Button } from '@/components/ui/button';
import { DiagramViewer } from './DiagramViewer';
import { generateDiagram } from '@/lib/diagram-agent';
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
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const businessDiagram = diagrams.find((d) => d.type === 'business');

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const diagram = await generateDiagram(epic, 'business');
      onDiagramGenerated(diagram);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReject = () => {
    if (!rejectComment.trim()) return;
    onTlReject(rejectComment.trim());
    setRejectComment('');
    setShowRejectForm(false);
  };

  function formatShortDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  // No diagram yet — show generation prompt
  if (!businessDiagram) {
    return (
      <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Genera el diagrama de negocio con IA</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            El agente analizará la definición de esta épica para generar el diagrama de flujo de negocio automáticamente.
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
        {isGenerating && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm mt-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              El agente está analizando la épica para generar el diagrama de negocio...
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
            onClick={handleGenerate}
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
            <Link href={`/proyectos/epicas/${epic.id}/diagrama`}>
              <Maximize2 className="h-3 w-3" />
              Página completa
            </Link>
          </Button>
        </div>
      </div>

      {/* Editable Diagram */}
      <DiagramViewer
        diagram={businessDiagram}
        editable
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

      {/* Generating overlay */}
      {isGenerating && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">
            Regenerando diagrama de negocio...
          </span>
        </div>
      )}

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
    </div>
  );
}
