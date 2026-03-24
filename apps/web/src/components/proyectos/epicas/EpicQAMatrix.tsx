'use client';

import { useState } from 'react';
import { Epic, QAMatrix, EpicQAMatrix as EpicQAMatrixType, UserStory, QAApproval } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { QAMatrixViewer } from './QAMatrixViewer';
import { EpicSystemicQAViewer } from './EpicSystemicQAViewer';
import { generateQAMatrix, generateEpicQAMatrix } from '@/lib/qa-matrix-agent';
import {
  Sparkles,
  ClipboardCheck,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Shield,
  FileCheck,
} from 'lucide-react';

interface EpicQAMatrixProps {
  epic: Epic;
  stories: UserStory[];
  // Story-level (functional)
  qaMatrix: QAMatrix | null;
  onMatrixGenerated: (matrix: QAMatrix) => void;
  onMatrixEdited: (matrix: QAMatrix) => void;
  qaApproval: QAApproval | null;
  onQaApprove: () => void;
  onQaReject: (comment: string) => void;
  // Epic-level (systemic)
  epicQAMatrix: EpicQAMatrixType | null;
  onEpicMatrixGenerated: (matrix: EpicQAMatrixType) => void;
  onEpicMatrixEdited: (matrix: EpicQAMatrixType) => void;
}

type QATab = 'systemic' | 'functional';

export function EpicQAMatrix({
  epic,
  stories,
  qaMatrix,
  onMatrixGenerated,
  onMatrixEdited,
  qaApproval,
  onQaApprove,
  onQaReject,
  epicQAMatrix,
  onEpicMatrixGenerated,
  onEpicMatrixEdited,
}: EpicQAMatrixProps) {
  const [activeQATab, setActiveQATab] = useState<QATab>('systemic');
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [isGeneratingEpic, setIsGeneratingEpic] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const handleGenerateStory = async () => {
    setIsGeneratingStory(true);
    try {
      const matrix = await generateQAMatrix(epic, stories);
      onMatrixGenerated(matrix);
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const handleGenerateEpic = async () => {
    setIsGeneratingEpic(true);
    try {
      const matrix = await generateEpicQAMatrix(epic);
      onEpicMatrixGenerated(matrix);
    } finally {
      setIsGeneratingEpic(false);
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

  // Systemic test count
  const systemicTestCount = epicQAMatrix?.tests.length ?? 0;
  const functionalTestCount = qaMatrix?.rows.reduce((s, r) => s + r.testCases.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setActiveQATab('systemic'); setShowRejectForm(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            activeQATab === 'systemic'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          QA Sistémico
          {systemicTestCount > 0 && (
            <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 font-semibold">
              {systemicTestCount}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveQATab('functional'); setShowRejectForm(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            activeQATab === 'functional'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileCheck className="h-3.5 w-3.5" />
          QA Funcional
          {functionalTestCount > 0 && (
            <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 font-semibold">
              {functionalTestCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Systemic Tab ── */}
      {activeQATab === 'systemic' && (
        <>
          {!epicQAMatrix ? (
            <GenerationPrompt
              title="Genera la matriz de QA sistémico con IA"
              description="El agente analizará la épica completa para generar tests de integración, E2E, performance, seguridad, compatibilidad y fiabilidad."
              buttonLabel="Generar QA Sistémico"
              isGenerating={isGeneratingEpic}
              generatingMessage="El agente está analizando la épica para generar tests sistémicos..."
              onGenerate={handleGenerateEpic}
            />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Shield className="h-4 w-4" />
                  Matriz de QA Sistémico
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateEpic}
                  disabled={isGeneratingEpic}
                  className="gap-1.5 text-xs h-7 text-muted-foreground"
                >
                  {isGeneratingEpic ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Regenerar
                </Button>
              </div>

              <EpicSystemicQAViewer
                matrix={epicQAMatrix}
                editable
                onMatrixChange={onEpicMatrixEdited}
              />

              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {epicQAMatrix.tests.length} tests sistémicos · 6 categorías NFR
                </span>
                <span>
                  Generado por {epicQAMatrix.generatedBy === 'ai' ? 'IA' : 'usuario'} · {new Date(epicQAMatrix.generatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {isGeneratingEpic && (
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Regenerando matriz de QA sistémico...</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Functional Tab ── */}
      {activeQATab === 'functional' && (
        <>
          {!qaMatrix ? (
            <GenerationPrompt
              title="Genera la matriz de QA funcional con IA"
              description="El agente analizará las historias de usuario y sus criterios de aceptación para generar casos de prueba funcionales, edge cases y validaciones."
              buttonLabel="Generar QA Funcional"
              isGenerating={isGeneratingStory}
              generatingMessage="El agente está analizando las historias para generar la matriz de trazabilidad QA funcional..."
              onGenerate={handleGenerateStory}
            />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <ClipboardCheck className="h-4 w-4" />
                  Matriz de Trazabilidad QA Funcional
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateStory}
                  disabled={isGeneratingStory}
                  className="gap-1.5 text-xs h-7 text-muted-foreground"
                >
                  {isGeneratingStory ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Regenerar
                </Button>
              </div>

              <QAMatrixViewer
                matrix={qaMatrix}
                editable
                onMatrixChange={onMatrixEdited}
              />

              {isGeneratingStory && (
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Regenerando matriz de QA funcional...</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* QA Approval Section (unified — covers both matrices) */}
      {(qaMatrix != null || epicQAMatrix != null) && (
        <ApprovalSection
          approval={qaApproval}
          onApprove={onQaApprove}
          onReject={handleReject}
          showRejectForm={showRejectForm}
          setShowRejectForm={setShowRejectForm}
          rejectComment={rejectComment}
          setRejectComment={setRejectComment}
          formatShortDate={formatShortDate}
          label="QA General"
        />
      )}
    </div>
  );
}

// --- Generation Prompt ---

function GenerationPrompt({
  title,
  description,
  buttonLabel,
  isGenerating,
  generatingMessage,
  onGenerate,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  isGenerating: boolean;
  generatingMessage: string;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-4 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md">{description}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onGenerate}
        disabled={isGenerating}
        className="gap-2 mt-2"
      >
        {isGenerating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ClipboardCheck className="h-3.5 w-3.5" />
        )}
        {buttonLabel}
      </Button>
      {isGenerating && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm mt-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">{generatingMessage}</span>
        </div>
      )}
    </div>
  );
}

// --- Approval Section ---

function ApprovalSection({
  approval,
  onApprove,
  onReject,
  showRejectForm,
  setShowRejectForm,
  rejectComment,
  setRejectComment,
  formatShortDate,
  label,
}: {
  approval: QAApproval | null;
  onApprove: () => void;
  onReject: () => void;
  showRejectForm: boolean;
  setShowRejectForm: (v: boolean) => void;
  rejectComment: string;
  setRejectComment: (v: string) => void;
  formatShortDate: (d: string) => string;
  label: string;
}) {
  return (
    <div className="rounded-xl border p-5">
      {!approval && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Visto Bueno — {label}</p>
              <p className="text-xs text-muted-foreground">
                El responsable debe validar que la matriz de {label.toLowerCase()} y los tests sean correctos
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
              onClick={onApprove}
              className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aprobar
            </Button>
          </div>
        </div>
      )}

      {approval?.status === 'approved' && (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">{label} aprobado</p>
            <p className="text-xs text-muted-foreground">
              Aprobado por {approval.approvedBy ?? 'QA'} · {approval.approvedAt ? formatShortDate(approval.approvedAt) : ''}
            </p>
          </div>
        </div>
      )}

      {approval?.status === 'rejected' && (
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">{label} rechazado</p>
              <p className="text-xs text-muted-foreground">
                Rechazado por {approval.approvedBy ?? 'QA'} · {approval.approvedAt ? formatShortDate(approval.approvedAt) : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onApprove}
              className="gap-1.5 text-green-600 hover:text-green-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aprobar
            </Button>
          </div>
          {approval.comment && (
            <div className="flex items-start gap-2 mt-3 ml-[52px] rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
              <MessageSquare className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-400">{approval.comment}</p>
            </div>
          )}
        </div>
      )}

      {showRejectForm && !approval && (
        <div className="mt-4 pt-4 border-t space-y-3">
          <textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder={`Describe qué cambios necesita la matriz de ${label.toLowerCase()}...`}
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowRejectForm(false); setRejectComment(''); }}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={onReject}
              disabled={!rejectComment.trim()}
              className="gap-1.5 bg-red-600 hover:bg-red-700 text-white"
            >
              Confirmar rechazo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
