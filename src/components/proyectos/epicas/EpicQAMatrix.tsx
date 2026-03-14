'use client';

import { useState } from 'react';
import { Epic, QAMatrix, UserStory } from '@/types/proyectos';
import { Button } from '@/components/ui/button';
import { QAMatrixViewer } from './QAMatrixViewer';
import { generateQAMatrix } from '@/lib/qa-matrix-agent';
import {
  Sparkles,
  ClipboardCheck,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  MessageSquare,
} from 'lucide-react';

interface EpicQAMatrixProps {
  epic: Epic;
  stories: UserStory[];
  qaMatrix: QAMatrix | null;
  onMatrixGenerated: (matrix: QAMatrix) => void;
  onMatrixEdited: (matrix: QAMatrix) => void;
  qaApproval: Epic['qaApproval'];
  onQaApprove: () => void;
  onQaReject: (comment: string) => void;
}

export function EpicQAMatrix({
  epic,
  stories,
  qaMatrix,
  onMatrixGenerated,
  onMatrixEdited,
  qaApproval,
  onQaApprove,
  onQaReject,
}: EpicQAMatrixProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const matrix = await generateQAMatrix(epic, stories);
      onMatrixGenerated(matrix);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReject = () => {
    if (!rejectComment.trim()) return;
    onQaReject(rejectComment.trim());
    setRejectComment('');
    setShowRejectForm(false);
  };

  function formatShortDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  // No matrix yet — show generation prompt
  if (!qaMatrix) {
    return (
      <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Genera la matriz de QA con IA</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            El agente analizará las historias de usuario y sus criterios de aceptación para generar
            una matriz de trazabilidad QA con casos de prueba estructurados.
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
            <ClipboardCheck className="h-3.5 w-3.5" />
          )}
          Generar Matriz de QA
        </Button>
        {isGenerating && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm mt-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              El agente está analizando las historias para generar la matriz de trazabilidad QA...
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
          <ClipboardCheck className="h-4 w-4" />
          Matriz de Trazabilidad QA
        </span>
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
      </div>

      {/* Editable Matrix */}
      <QAMatrixViewer
        matrix={qaMatrix}
        editable
        onMatrixChange={onMatrixEdited}
      />

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {qaMatrix.rows.length} historias · {qaMatrix.rows.reduce((sum, r) => sum + r.testCases.length, 0)} casos de prueba
        </span>
        <span>
          Generado por {qaMatrix.generatedBy === 'ai' ? 'IA' : 'usuario'} · {new Date(qaMatrix.generatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Generating overlay */}
      {isGenerating && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">
            Regenerando matriz de QA...
          </span>
        </div>
      )}

      {/* QA Approval Section */}
      <div className="rounded-xl border p-5">
        {!qaApproval && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Visto Bueno de QA</p>
                <p className="text-xs text-muted-foreground">
                  El responsable de QA debe validar que la matriz de trazabilidad y los casos de prueba sean correctos
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
                onClick={onQaApprove}
                className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aprobar
              </Button>
            </div>
          </div>
        )}

        {qaApproval?.status === 'approved' && (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-400">Matriz QA aprobada</p>
              <p className="text-xs text-muted-foreground">
                Aprobado por {qaApproval.approvedBy ?? 'QA'} · {qaApproval.approvedAt ? formatShortDate(qaApproval.approvedAt) : ''}
              </p>
            </div>
          </div>
        )}

        {qaApproval?.status === 'rejected' && (
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Matriz QA rechazada</p>
                <p className="text-xs text-muted-foreground">
                  Rechazado por {qaApproval.approvedBy ?? 'QA'} · {qaApproval.approvedAt ? formatShortDate(qaApproval.approvedAt) : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onQaApprove}
                className="gap-1.5 text-green-600 hover:text-green-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aprobar
              </Button>
            </div>
            {qaApproval.comment && (
              <div className="flex items-start gap-2 mt-3 ml-[52px] rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
                <MessageSquare className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-400">{qaApproval.comment}</p>
              </div>
            )}
          </div>
        )}

        {/* Reject form */}
        {showRejectForm && !qaApproval && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Describe qué cambios necesita la matriz de QA..."
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
