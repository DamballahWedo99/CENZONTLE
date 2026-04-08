'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  QAMatrix,
  QAMatrixRow,
  QATestCase,
  TestCaseStatus,
  TestCasePriority,
  TestExecution,
} from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  MousePointer2,
  ClipboardCheck,
  Shield,
  Bug,
  Cog,
} from 'lucide-react';

// --- Labels ---

const statusLabels: Record<TestCaseStatus, string> = {
  pending: 'Pendiente',
  passed: 'Aprobado',
  failed: 'Fallido',
  blocked: 'Bloqueado',
  skipped: 'Omitido',
};

const priorityLabels: Record<TestCasePriority, string> = {
  critical: 'Critico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
};

// --- Status badge colors (theme-aware) ---

const statusColors: Record<TestCaseStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  passed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  blocked: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  skipped: 'bg-muted text-muted-foreground',
};

// --- Priority badge colors (theme-aware) ---

const priorityColors: Record<TestCasePriority, string> = {
  critical: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  low: 'bg-muted text-muted-foreground',
};

const automationLabels: Record<import('@cenzontle/shared').AutomationStatus, string> = {
  manual: 'Manual',
  automated: 'Automatizado',
  to_automate: 'Por automatizar',
};

const automationColors: Record<import('@cenzontle/shared').AutomationStatus, string> = {
  manual: 'bg-muted text-muted-foreground',
  automated: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  to_automate: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
};

// --- Coverage helpers ---

function calculateCoverage(testCases: QATestCase[]): number {
  if (testCases.length === 0) return 0;
  return Math.round(
    (testCases.filter((tc) => tc.status === 'passed').length / testCases.length) * 100
  );
}

function coverageBarColor(coverage: number): string {
  if (coverage >= 80) return 'bg-emerald-500';
  if (coverage >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

// --- Summary stats ---

interface MatrixSummary {
  totalTestCases: number;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
  skipped: number;
  overallCoverage: number;
}

function computeSummary(rows: QAMatrixRow[]): MatrixSummary {
  const allTestCases = rows.flatMap((r) => r.testCases);
  const total = allTestCases.length;
  const passed = allTestCases.filter((tc) => tc.status === 'passed').length;
  const failed = allTestCases.filter((tc) => tc.status === 'failed').length;
  const blocked = allTestCases.filter((tc) => tc.status === 'blocked').length;
  const pending = allTestCases.filter((tc) => tc.status === 'pending').length;
  const skipped = allTestCases.filter((tc) => tc.status === 'skipped').length;
  const overallCoverage = total > 0 ? Math.round((passed / total) * 100) : 0;
  return { totalTestCases: total, passed, failed, blocked, pending, skipped, overallCoverage };
}

// --- Component ---

interface QAMatrixViewerProps {
  matrix: QAMatrix;
  editable?: boolean;
  onMatrixChange?: (matrix: QAMatrix) => void;
}

export function QAMatrixViewer({ matrix, editable = false, onMatrixChange }: QAMatrixViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editableRows, setEditableRows] = useState<QAMatrixRow[]>(matrix.rows);
  const [expandedStories, setExpandedStories] = useState<Set<string>>(() => new Set());

  // Sync editableRows when matrix prop changes and not editing
  const currentRows = isEditing ? editableRows : matrix.rows;

  const summary = useMemo(() => computeSummary(currentRows), [currentRows]);

  // --- Expand/collapse ---

  const toggleExpand = useCallback((storyId: string) => {
    setExpandedStories((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) {
        next.delete(storyId);
      } else {
        next.add(storyId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedStories(new Set(currentRows.map((r) => r.storyId)));
  }, [currentRows]);

  const collapseAll = useCallback(() => {
    setExpandedStories(new Set());
  }, []);

  // --- Edit mode toggle ---

  const enterEditMode = useCallback(() => {
    setEditableRows(structuredClone(matrix.rows));
    setIsEditing(true);
  }, [matrix.rows]);

  const cancelEdit = useCallback(() => {
    setEditableRows(matrix.rows);
    setIsEditing(false);
  }, [matrix.rows]);

  const handleSave = useCallback(() => {
    const updatedRows = editableRows.map((row) => ({
      ...row,
      coverage: calculateCoverage(row.testCases),
    }));
    const updatedMatrix: QAMatrix = {
      ...matrix,
      rows: updatedRows,
      updatedAt: new Date().toISOString(),
      generatedBy: 'manual',
    };
    onMatrixChange?.(updatedMatrix);
    setIsEditing(false);
  }, [editableRows, matrix, onMatrixChange]);

  const handleReset = useCallback(() => {
    setEditableRows(structuredClone(matrix.rows));
  }, [matrix.rows]);

  // --- Row mutation helpers ---

  const updateTestCase = useCallback(
    (storyId: string, testCaseId: string, updates: Partial<QATestCase>) => {
      setEditableRows((rows) =>
        rows.map((row) =>
          row.storyId === storyId
            ? {
                ...row,
                testCases: row.testCases.map((tc) =>
                  tc.id === testCaseId ? { ...tc, ...updates } : tc
                ),
              }
            : row
        )
      );
    },
    []
  );

  const addTestCase = useCallback((storyId: string) => {
    const newId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTestCase: QATestCase = {
      id: newId,
      title: 'Nuevo caso de prueba',
      description: '',
      steps: ['Paso 1'],
      expectedResult: '',
      status: 'pending',
      priority: 'medium',
      assignedTo: null,
      automationStatus: 'manual',
      linkedDefects: [],
      executionHistory: [],
      trend: null,
    };
    setEditableRows((rows) =>
      rows.map((row) =>
        row.storyId === storyId
          ? { ...row, testCases: [...row.testCases, newTestCase] }
          : row
      )
    );
    setExpandedStories((prev) => new Set(prev).add(storyId));
  }, []);

  const deleteTestCase = useCallback((storyId: string, testCaseId: string) => {
    setEditableRows((rows) =>
      rows.map((row) =>
        row.storyId === storyId
          ? { ...row, testCases: row.testCases.filter((tc) => tc.id !== testCaseId) }
          : row
      )
    );
  }, []);

  const addTestStep = useCallback(
    (storyId: string, testCaseId: string) => {
      setEditableRows((rows) =>
        rows.map((row) =>
          row.storyId === storyId
            ? {
                ...row,
                testCases: row.testCases.map((tc) =>
                  tc.id === testCaseId
                    ? { ...tc, steps: [...tc.steps, `Paso ${tc.steps.length + 1}`] }
                    : tc
                ),
              }
            : row
        )
      );
    },
    []
  );

  const removeTestStep = useCallback(
    (storyId: string, testCaseId: string, stepIndex: number) => {
      setEditableRows((rows) =>
        rows.map((row) =>
          row.storyId === storyId
            ? {
                ...row,
                testCases: row.testCases.map((tc) =>
                  tc.id === testCaseId
                    ? { ...tc, steps: tc.steps.filter((_, i) => i !== stepIndex) }
                    : tc
                ),
              }
            : row
        )
      );
    },
    []
  );

  const updateTestStep = useCallback(
    (storyId: string, testCaseId: string, stepIndex: number, value: string) => {
      setEditableRows((rows) =>
        rows.map((row) =>
          row.storyId === storyId
            ? {
                ...row,
                testCases: row.testCases.map((tc) =>
                  tc.id === testCaseId
                    ? { ...tc, steps: tc.steps.map((s, i) => (i === stepIndex ? value : s)) }
                    : tc
                ),
              }
            : row
        )
      );
    },
    []
  );

  // --- Render ---

  return (
    <div className="relative space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
          <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground font-medium">Total:</span>
          <span className="text-[11px] text-foreground font-semibold">{summary.totalTestCases}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">{summary.passed} aprobados</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-[11px] text-red-700 dark:text-red-300 font-medium">{summary.failed} fallidos</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">{summary.blocked} bloqueados</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground font-medium">Cobertura:</span>
          <span className={`text-[11px] font-semibold ${summary.overallCoverage >= 80 ? 'text-emerald-600 dark:text-emerald-300' : summary.overallCoverage >= 50 ? 'text-amber-600 dark:text-amber-300' : 'text-red-600 dark:text-red-300'}`}>
            {summary.overallCoverage}%
          </span>
        </div>

        {/* Expand/Collapse all + Edit buttons */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={expandedStories.size === currentRows.length ? collapseAll : expandAll}
            className="h-7 text-xs"
          >
            {expandedStories.size === currentRows.length ? 'Colapsar todo' : 'Expandir todo'}
          </Button>

          {editable && !isEditing && (
            <Button
              size="sm"
              variant="outline"
              onClick={enterEditMode}
              className="h-7 gap-1.5 text-xs"
            >
              <MousePointer2 className="h-3 w-3" />
              Editar matriz
            </Button>
          )}

          {isEditing && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                className="h-7 gap-1.5 text-xs"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="h-7 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Save className="h-3 w-3" />
                Guardar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={cancelEdit}
                className="h-7 text-xs"
              >
                Cancelar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-xl border overflow-x-auto ${isEditing ? 'border-indigo-500/50' : 'border-border'}`}>
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-8" />
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-28">
                ID
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80">
                Titulo
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-28 text-center">
                Casos de Prueba
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-24 text-center">
                Prioridad
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-24 text-center">
                Estado
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-24 text-center">
                Automatización
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-32">
                Asignado
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-16 text-center">
                Defectos
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-32 text-center">
                Cobertura
              </TableHead>
              {isEditing && (
                <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-10" />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentRows.map((row) => {
              const isExpanded = expandedStories.has(row.storyId);
              const coverage = isEditing
                ? calculateCoverage(row.testCases)
                : row.coverage;

              return (
                <StoryRowGroup
                  key={row.storyId}
                  row={row}
                  isExpanded={isExpanded}
                  isEditing={isEditing}
                  coverage={coverage}
                  onToggleExpand={() => toggleExpand(row.storyId)}
                  onUpdateTestCase={(tcId, updates) => updateTestCase(row.storyId, tcId, updates)}
                  onAddTestCase={() => addTestCase(row.storyId)}
                  onDeleteTestCase={(tcId) => deleteTestCase(row.storyId, tcId)}
                  onAddTestStep={(tcId) => addTestStep(row.storyId, tcId)}
                  onRemoveTestStep={(tcId, idx) => removeTestStep(row.storyId, tcId, idx)}
                  onUpdateTestStep={(tcId, idx, val) => updateTestStep(row.storyId, tcId, idx, val)}
                />
              );
            })}

            {currentRows.length === 0 && (
              <TableRow className="border-border">
                <TableCell colSpan={isEditing ? 11 : 10} className="text-center py-8">
                  <p className="text-xs text-muted-foreground">No hay historias de usuario en la matriz</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Editing mode indicator */}
      {isEditing && (
        <div className="flex justify-end">
          <div className="bg-indigo-600/90 text-white text-[10px] font-medium px-2.5 py-1 rounded-md flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            Modo edicion — edita campos, agrega o elimina casos de prueba
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span>
          {currentRows.length} {currentRows.length === 1 ? 'historia' : 'historias'} · {summary.totalTestCases} casos de prueba
        </span>
        <span>
          Generado por {matrix.generatedBy === 'ai' ? 'IA' : 'manual'} · {new Date(matrix.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, {new Date(matrix.updatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// --- Story Row Group (parent row + test case sub-rows) ---

interface StoryRowGroupProps {
  row: QAMatrixRow;
  isExpanded: boolean;
  isEditing: boolean;
  coverage: number;
  onToggleExpand: () => void;
  onUpdateTestCase: (testCaseId: string, updates: Partial<QATestCase>) => void;
  onAddTestCase: () => void;
  onDeleteTestCase: (testCaseId: string) => void;
  onAddTestStep: (testCaseId: string) => void;
  onRemoveTestStep: (testCaseId: string, stepIndex: number) => void;
  onUpdateTestStep: (testCaseId: string, stepIndex: number, value: string) => void;
}

function StoryRowGroup({
  row,
  isExpanded,
  isEditing,
  coverage,
  onToggleExpand,
  onUpdateTestCase,
  onAddTestCase,
  onDeleteTestCase,
  onAddTestStep,
  onRemoveTestStep,
  onUpdateTestStep,
}: StoryRowGroupProps) {
  return (
    <>
      {/* Story parent row */}
      <TableRow
        className="border-border cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggleExpand}
      >
        <TableCell className="text-muted-foreground pl-3 pr-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </TableCell>
        <TableCell className="text-[11px] text-indigo-600 dark:text-indigo-400 font-mono font-medium">
          {row.storyJiraKey}
        </TableCell>
        <TableCell className="text-xs text-foreground font-medium">
          {row.storyTitle}
        </TableCell>
        <TableCell className="text-center">
          <span className="text-[11px] text-foreground font-semibold bg-muted rounded-full px-2 py-0.5">
            {row.testCases.length}
          </span>
        </TableCell>
        <TableCell />
        <TableCell />
        <TableCell />
        <TableCell />
        <TableCell />
        <TableCell className="px-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${coverageBarColor(coverage)}`}
                style={{ width: `${coverage}%` }}
              />
            </div>
            <span className={`text-[10px] font-semibold min-w-[28px] text-right ${coverage >= 80 ? 'text-emerald-600 dark:text-emerald-400' : coverage >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
              {coverage}%
            </span>
          </div>
        </TableCell>
        {isEditing && (
          <TableCell className="text-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onAddTestCase();
              }}
              className="h-6 w-6 p-0 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
              title="Agregar caso de prueba"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </TableCell>
        )}
      </TableRow>

      {/* Test case sub-rows */}
      {isExpanded &&
        row.testCases.map((tc, tcIndex) => (
          <TestCaseRow
            key={tc.id}
            testCase={tc}
            index={tcIndex + 1}
            isEditing={isEditing}
            isEven={tcIndex % 2 === 0}
            onUpdate={(updates) => onUpdateTestCase(tc.id, updates)}
            onDelete={() => onDeleteTestCase(tc.id)}
            onAddStep={() => onAddTestStep(tc.id)}
            onRemoveStep={(idx) => onRemoveTestStep(tc.id, idx)}
            onUpdateStep={(idx, val) => onUpdateTestStep(tc.id, idx, val)}
          />
        ))}

      {/* Empty state inside expanded story */}
      {isExpanded && row.testCases.length === 0 && (
        <TableRow className="border-border/50">
          <TableCell colSpan={isEditing ? 11 : 10} className="pl-10 py-3">
            <p className="text-[11px] text-muted-foreground italic">Sin casos de prueba</p>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// --- Test Case Sub-Row ---

interface TestCaseRowProps {
  testCase: QATestCase;
  index: number;
  isEditing: boolean;
  isEven: boolean;
  onUpdate: (updates: Partial<QATestCase>) => void;
  onDelete: () => void;
  onAddStep: () => void;
  onRemoveStep: (stepIndex: number) => void;
  onUpdateStep: (stepIndex: number, value: string) => void;
}

function TestCaseRow({
  testCase,
  index,
  isEditing,
  isEven,
  onUpdate,
  onDelete,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
}: TestCaseRowProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  return (
    <>
      <TableRow
        className={`border-border/50 ${isEven ? 'bg-muted/30' : 'bg-muted/10'} hover:bg-muted/50 transition-colors`}
      >
        {/* Indent spacer */}
        <TableCell className="pl-3 pr-0" />

        {/* Test case index */}
        <TableCell className="text-[10px] text-muted-foreground font-mono pl-6">
          TC-{String(index).padStart(2, '0')}
        </TableCell>

        {/* Title - click to edit in edit mode */}
        <TableCell className="pl-2">
          {isEditing && isEditingTitle ? (
            <Input
              value={testCase.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setIsEditingTitle(false);
              }}
              autoFocus
              className="h-6 text-xs px-1.5"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs text-foreground/80 ${isEditing ? 'cursor-pointer hover:text-foreground' : ''}`}
                onClick={(e) => {
                  if (isEditing) {
                    e.stopPropagation();
                    setIsEditingTitle(true);
                  }
                }}
              >
                {testCase.title}
              </span>
              {testCase.steps.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSteps(!showSteps);
                  }}
                  className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors ml-1"
                  title={showSteps ? 'Ocultar pasos' : 'Ver pasos'}
                >
                  {showSteps ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  ({testCase.steps.length} {testCase.steps.length === 1 ? 'paso' : 'pasos'})
                </button>
              )}
              {testCase.executionHistory.length > 0 && (
                <span className="text-[9px] text-muted-foreground ml-1" title={`${testCase.executionHistory.length} ejecuciones`}>
                  ({testCase.executionHistory.length} runs)
                </span>
              )}
            </div>
          )}
        </TableCell>

        {/* Test cases count - empty for sub-rows */}
        <TableCell />

        {/* Priority */}
        <TableCell className="text-center">
          {isEditing ? (
            <Select
              value={testCase.priority}
              onValueChange={(value) => onUpdate({ priority: value as TestCasePriority })}
            >
              <SelectTrigger className="h-6 w-full text-[10px] px-1.5 [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(priorityLabels) as TestCasePriority[]).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {priorityLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${priorityColors[testCase.priority]}`}>
              {priorityLabels[testCase.priority]}
            </span>
          )}
        </TableCell>

        {/* Status */}
        <TableCell className="text-center">
          {isEditing ? (
            <Select
              value={testCase.status}
              onValueChange={(value) => onUpdate({ status: value as TestCaseStatus })}
            >
              <SelectTrigger className="h-6 w-full text-[10px] px-1.5 [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(statusLabels) as TestCaseStatus[]).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {statusLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${statusColors[testCase.status]}`}>
              {statusLabels[testCase.status]}
            </span>
          )}
        </TableCell>

        {/* Automation status */}
        <TableCell className="text-center">
          {isEditing ? (
            <Select
              value={testCase.automationStatus}
              onValueChange={(value) => onUpdate({ automationStatus: value as import('@cenzontle/shared').AutomationStatus })}
            >
              <SelectTrigger className="h-6 w-full text-[10px] px-1.5 [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(automationLabels) as import('@cenzontle/shared').AutomationStatus[]).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {automationLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${automationColors[testCase.automationStatus]}`}>
              {automationLabels[testCase.automationStatus]}
            </span>
          )}
        </TableCell>

        {/* Assigned to */}
        <TableCell>
          {isEditing ? (
            <Input
              value={testCase.assignedTo ?? ''}
              onChange={(e) => onUpdate({ assignedTo: e.target.value || null })}
              placeholder="Sin asignar"
              className="h-6 text-[10px] px-1.5"
            />
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {testCase.assignedTo || 'Sin asignar'}
            </span>
          )}
        </TableCell>

        {/* Linked defects */}
        <TableCell className="text-center">
          {testCase.linkedDefects.length > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
              <Bug className="h-3 w-3" />
              {testCase.linkedDefects.length}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Coverage - empty for sub-rows */}
        <TableCell />

        {/* Delete button in edit mode */}
        {isEditing && (
          <TableCell className="text-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="h-6 w-6 p-0 text-red-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Eliminar caso de prueba"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TableCell>
        )}
      </TableRow>

      {/* Test steps sub-section */}
      {showSteps && (
        <TableRow className={`border-border/30 ${isEven ? 'bg-muted/30' : 'bg-muted/10'}`}>
          <TableCell />
          <TableCell colSpan={isEditing ? 10 : 9} className="pl-6 py-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">
                Pasos del caso de prueba
              </p>
              {testCase.steps.map((step, stepIndex) => (
                <div key={stepIndex} className="flex items-center gap-1.5 group">
                  <span className="text-[9px] text-muted-foreground/60 font-mono w-4 text-right shrink-0">
                    {stepIndex + 1}.
                  </span>
                  {isEditing ? (
                    <>
                      <Input
                        value={step}
                        onChange={(e) => onUpdateStep(stepIndex, e.target.value)}
                        className="h-5 text-[10px] px-1.5 flex-1"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onRemoveStep(stepIndex)}
                        className="h-5 w-5 p-0 text-red-400/60 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Eliminar paso"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{step}</span>
                  )}
                </div>
              ))}
              {isEditing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onAddStep}
                  className="h-5 gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 px-1.5 mt-0.5"
                >
                  <Plus className="h-2.5 w-2.5" />
                  Agregar paso
                </Button>
              )}
              {testCase.expectedResult && (
                <div className="mt-1.5 pt-1.5 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground font-medium">Resultado esperado: </span>
                  <span className="text-[10px] text-foreground/70">{testCase.expectedResult}</span>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
