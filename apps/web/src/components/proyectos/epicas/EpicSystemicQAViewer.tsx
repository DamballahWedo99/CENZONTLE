'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  EpicQAMatrix,
  EpicQATest,
  EpicQATestCategory,
  TestCaseStatus,
  TestCasePriority,
  AutomationStatus,
  GherkinScenario,
  TestExecution,
  EPIC_QA_CATEGORY_LABELS,
  EPIC_QA_CATEGORY_DESCRIPTIONS,
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
  Shield,
  Zap,
  Globe,
  Lock,
  Layers,
  Activity,
  Network,
  AlertTriangle,
  Hand,
  Wrench,
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

const statusColors: Record<TestCaseStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  passed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  blocked: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  skipped: 'bg-muted text-muted-foreground',
};

const priorityColors: Record<TestCasePriority, string> = {
  critical: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  low: 'bg-muted text-muted-foreground',
};

const automationLabels: Record<AutomationStatus, string> = {
  manual: 'Manual',
  automated: 'Automatizado',
  to_automate: 'Por automatizar',
};

const automationColors: Record<AutomationStatus, string> = {
  manual: 'bg-muted text-muted-foreground',
  automated: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  to_automate: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
};

const categoryIcons: Record<EpicQATestCategory, typeof Layers> = {
  integration: Network,
  e2e: Layers,
  performance: Zap,
  security: Lock,
  compatibility: Globe,
  reliability: Activity,
  safety: AlertTriangle,
  usability: Hand,
  maintainability: Wrench,
};

const categoryColors: Record<EpicQATestCategory, string> = {
  integration: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
  e2e: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10',
  performance: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  security: 'text-red-600 dark:text-red-400 bg-red-500/10',
  compatibility: 'text-teal-600 dark:text-teal-400 bg-teal-500/10',
  reliability: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10',
  safety: 'text-orange-600 dark:text-orange-400 bg-orange-500/10',
  usability: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
  maintainability: 'text-slate-600 dark:text-slate-400 bg-slate-500/10',
};

// --- Helpers ---

function calculateCategoryCoverage(tests: EpicQATest[], category: EpicQATestCategory): number {
  const catTests = tests.filter((t) => t.category === category);
  if (catTests.length === 0) return 0;
  return Math.round((catTests.filter((t) => t.status === 'passed').length / catTests.length) * 100);
}

function coverageBarColor(coverage: number): string {
  if (coverage >= 80) return 'bg-emerald-500';
  if (coverage >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

interface SystemicSummary {
  totalTests: number;
  passed: number;
  failed: number;
  blocked: number;
  overallCoverage: number;
  categoryCoverage: Record<EpicQATestCategory, number>;
}

function computeSummary(tests: EpicQATest[]): SystemicSummary {
  const total = tests.length;
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const blocked = tests.filter((t) => t.status === 'blocked').length;
  const overallCoverage = total > 0 ? Math.round((passed / total) * 100) : 0;

  const categories: EpicQATestCategory[] = ['integration', 'e2e', 'performance', 'security', 'compatibility', 'reliability', 'safety', 'usability', 'maintainability'];
  const categoryCoverage = {} as Record<EpicQATestCategory, number>;
  for (const cat of categories) {
    categoryCoverage[cat] = calculateCategoryCoverage(tests, cat);
  }

  return { totalTests: total, passed, failed, blocked, overallCoverage, categoryCoverage };
}

// --- Component ---

interface EpicSystemicQAViewerProps {
  matrix: EpicQAMatrix;
  editable?: boolean;
  onMatrixChange?: (matrix: EpicQAMatrix) => void;
}

export function EpicSystemicQAViewer({ matrix, editable = false, onMatrixChange }: EpicSystemicQAViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editableTests, setEditableTests] = useState<EpicQATest[]>(matrix.tests);
  const [expandedCategories, setExpandedCategories] = useState<Set<EpicQATestCategory>>(() => new Set());

  const currentTests = isEditing ? editableTests : matrix.tests;
  const summary = useMemo(() => computeSummary(currentTests), [currentTests]);

  const categories: EpicQATestCategory[] = ['integration', 'e2e', 'performance', 'security', 'compatibility', 'reliability', 'safety', 'usability', 'maintainability'];

  const testsByCategory = useMemo(() => {
    const grouped: Record<EpicQATestCategory, EpicQATest[]> = {
      integration: [], e2e: [], performance: [], security: [], compatibility: [], reliability: [],
      safety: [], usability: [], maintainability: [],
    };
    for (const test of currentTests) {
      grouped[test.category].push(test);
    }
    return grouped;
  }, [currentTests]);

  // --- Expand/collapse ---

  const toggleCategory = useCallback((cat: EpicQATestCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedCategories(new Set(categories));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedCategories(new Set());
  }, []);

  // --- Edit mode ---

  const enterEditMode = useCallback(() => {
    setEditableTests(structuredClone(matrix.tests));
    setIsEditing(true);
  }, [matrix.tests]);

  const cancelEdit = useCallback(() => {
    setEditableTests(matrix.tests);
    setIsEditing(false);
  }, [matrix.tests]);

  const handleSave = useCallback(() => {
    const nfrCoverage = {} as Record<EpicQATestCategory, number>;
    for (const cat of categories) {
      nfrCoverage[cat] = calculateCategoryCoverage(editableTests, cat);
    }
    const updatedMatrix: EpicQAMatrix = {
      ...matrix,
      tests: editableTests,
      nfrCoverage,
      updatedAt: new Date().toISOString(),
      generatedBy: 'manual',
    };
    onMatrixChange?.(updatedMatrix);
    setIsEditing(false);
  }, [editableTests, matrix, onMatrixChange]);

  const handleReset = useCallback(() => {
    setEditableTests(structuredClone(matrix.tests));
  }, [matrix.tests]);

  // --- Mutation helpers ---

  const updateTest = useCallback((testId: string, updates: Partial<EpicQATest>) => {
    setEditableTests((tests) =>
      tests.map((t) => t.id === testId ? { ...t, ...updates } : t)
    );
  }, []);

  const addTest = useCallback((category: EpicQATestCategory) => {
    const newTest: EpicQATest = {
      id: `epic-tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category,
      title: 'Nuevo test sistémico',
      description: '',
      scenarios: ['Escenario 1'],
      gherkinScenarios: [],
      dependencies: [],
      status: 'pending',
      priority: 'medium',
      assignedTo: null,
      automationStatus: 'manual',
      linkedDefects: [],
      riskLikelihood: 2,
      riskImpact: 3,
      executionHistory: [],
      trend: null,
    };
    setEditableTests((tests) => [...tests, newTest]);
    setExpandedCategories((prev) => new Set(prev).add(category));
  }, []);

  const deleteTest = useCallback((testId: string) => {
    setEditableTests((tests) => tests.filter((t) => t.id !== testId));
  }, []);

  const addScenario = useCallback((testId: string) => {
    setEditableTests((tests) =>
      tests.map((t) =>
        t.id === testId ? { ...t, scenarios: [...t.scenarios, `Escenario ${t.scenarios.length + 1}`] } : t
      )
    );
  }, []);

  const removeScenario = useCallback((testId: string, idx: number) => {
    setEditableTests((tests) =>
      tests.map((t) =>
        t.id === testId ? { ...t, scenarios: t.scenarios.filter((_, i) => i !== idx) } : t
      )
    );
  }, []);

  const updateScenario = useCallback((testId: string, idx: number, value: string) => {
    setEditableTests((tests) =>
      tests.map((t) =>
        t.id === testId ? { ...t, scenarios: t.scenarios.map((s, i) => i === idx ? value : s) } : t
      )
    );
  }, []);

  return (
    <div className="relative space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground font-medium">Tests:</span>
          <span className="text-[11px] text-foreground font-semibold">{summary.totalTests}</span>
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
          <span className="text-[11px] text-muted-foreground font-medium">Cobertura NFR:</span>
          <span className={`text-[11px] font-semibold ${summary.overallCoverage >= 80 ? 'text-emerald-600 dark:text-emerald-300' : summary.overallCoverage >= 50 ? 'text-amber-600 dark:text-amber-300' : 'text-red-600 dark:text-red-300'}`}>
            {summary.overallCoverage}%
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={expandedCategories.size === categories.length ? collapseAll : expandAll}
            className="h-7 text-xs"
          >
            {expandedCategories.size === categories.length ? 'Colapsar todo' : 'Expandir todo'}
          </Button>

          {editable && !isEditing && (
            <Button size="sm" variant="outline" onClick={enterEditMode} className="h-7 gap-1.5 text-xs">
              <MousePointer2 className="h-3 w-3" />
              Editar matriz
            </Button>
          )}

          {isEditing && (
            <>
              <Button size="sm" variant="outline" onClick={handleReset} className="h-7 gap-1.5 text-xs">
                <RotateCcw className="h-3 w-3" />
              </Button>
              <Button size="sm" onClick={handleSave} className="h-7 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white">
                <Save className="h-3 w-3" />
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 text-xs">
                Cancelar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* NFR Coverage Grid */}
      <div className="grid grid-cols-3 lg:grid-cols-9 gap-2">
        {categories.map((cat) => {
          const Icon = categoryIcons[cat];
          const cov = summary.categoryCoverage[cat];
          const count = testsByCategory[cat].length;
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`rounded-lg border p-2.5 text-left transition-all hover:shadow-sm ${
                expandedCategories.has(cat) ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-border'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className={`h-5 w-5 rounded flex items-center justify-center ${categoryColors[cat]}`}>
                  <Icon className="h-3 w-3" />
                </div>
                <span className="text-[10px] font-medium text-foreground truncate">{EPIC_QA_CATEGORY_LABELS[cat]}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${coverageBarColor(cov)}`} style={{ width: `${cov}%` }} />
                </div>
                <span className={`text-[9px] font-semibold ${cov >= 80 ? 'text-emerald-600 dark:text-emerald-400' : cov >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                  {cov}%
                </span>
              </div>
              <span className="text-[9px] text-muted-foreground">{count} {count === 1 ? 'test' : 'tests'}</span>
            </button>
          );
        })}
      </div>

      {/* Tests Table by Category */}
      <div className={`rounded-xl border overflow-x-auto ${isEditing ? 'border-indigo-500/50' : 'border-border'}`}>
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-8" />
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-28">
                Categoría
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80">
                Test
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-20 text-center">
                Escenarios
              </TableHead>
              <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-16 text-center">
                Riesgo
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
              {isEditing && (
                <TableHead className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider bg-muted/80 w-10" />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => {
              const tests = testsByCategory[cat];
              const isExpanded = expandedCategories.has(cat);
              const Icon = categoryIcons[cat];
              const catCoverage = summary.categoryCoverage[cat];

              return (
                <CategoryGroup
                  key={cat}
                  category={cat}
                  icon={Icon}
                  tests={tests}
                  isExpanded={isExpanded}
                  isEditing={isEditing}
                  coverage={catCoverage}
                  onToggle={() => toggleCategory(cat)}
                  onUpdateTest={updateTest}
                  onAddTest={() => addTest(cat)}
                  onDeleteTest={deleteTest}
                  onAddScenario={addScenario}
                  onRemoveScenario={removeScenario}
                  onUpdateScenario={updateScenario}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      {isEditing && (
        <div className="flex justify-end">
          <div className="bg-indigo-600/90 text-white text-[10px] font-medium px-2.5 py-1 rounded-md flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            Modo edición — edita tests sistémicos, agrega o elimina escenarios
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span>
          {currentTests.length} tests sistémicos · {categories.filter((c) => testsByCategory[c].length > 0).length} categorías
        </span>
        <span>
          Generado por {matrix.generatedBy === 'ai' ? 'IA' : 'manual'} · {new Date(matrix.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, {new Date(matrix.updatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// --- Category Group ---

interface CategoryGroupProps {
  category: EpicQATestCategory;
  icon: typeof Layers;
  tests: EpicQATest[];
  isExpanded: boolean;
  isEditing: boolean;
  coverage: number;
  onToggle: () => void;
  onUpdateTest: (testId: string, updates: Partial<EpicQATest>) => void;
  onAddTest: () => void;
  onDeleteTest: (testId: string) => void;
  onAddScenario: (testId: string) => void;
  onRemoveScenario: (testId: string, idx: number) => void;
  onUpdateScenario: (testId: string, idx: number, value: string) => void;
}

function CategoryGroup({
  category,
  icon: Icon,
  tests,
  isExpanded,
  isEditing,
  coverage,
  onToggle,
  onUpdateTest,
  onAddTest,
  onDeleteTest,
  onAddScenario,
  onRemoveScenario,
  onUpdateScenario,
}: CategoryGroupProps) {
  return (
    <>
      {/* Category header row */}
      <TableRow
        className="border-border cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <TableCell className="text-muted-foreground pl-3 pr-0">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <div className={`h-5 w-5 rounded flex items-center justify-center ${categoryColors[category]}`}>
              <Icon className="h-3 w-3" />
            </div>
            <span className="text-[11px] font-semibold text-foreground">{EPIC_QA_CATEGORY_LABELS[category]}</span>
          </div>
        </TableCell>
        <TableCell className="text-[10px] text-muted-foreground">
          {EPIC_QA_CATEGORY_DESCRIPTIONS[category]}
        </TableCell>
        <TableCell className="text-center">
          <span className="text-[11px] text-foreground font-semibold bg-muted rounded-full px-2 py-0.5">
            {tests.length}
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
              onClick={(e) => { e.stopPropagation(); onAddTest(); }}
              className="h-6 w-6 p-0 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
              title="Agregar test"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </TableCell>
        )}
      </TableRow>

      {/* Test sub-rows */}
      {isExpanded && tests.map((test, idx) => (
        <SystemicTestRow
          key={test.id}
          test={test}
          index={idx + 1}
          isEditing={isEditing}
          isEven={idx % 2 === 0}
          onUpdate={(updates) => onUpdateTest(test.id, updates)}
          onDelete={() => onDeleteTest(test.id)}
          onAddScenario={() => onAddScenario(test.id)}
          onRemoveScenario={(i) => onRemoveScenario(test.id, i)}
          onUpdateScenario={(i, v) => onUpdateScenario(test.id, i, v)}
        />
      ))}

      {isExpanded && tests.length === 0 && (
        <TableRow className="border-border/50">
          <TableCell colSpan={isEditing ? 11 : 10} className="pl-10 py-3">
            <p className="text-[11px] text-muted-foreground italic">Sin tests en esta categoría</p>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// --- Systemic Test Row ---

interface SystemicTestRowProps {
  test: EpicQATest;
  index: number;
  isEditing: boolean;
  isEven: boolean;
  onUpdate: (updates: Partial<EpicQATest>) => void;
  onDelete: () => void;
  onAddScenario: () => void;
  onRemoveScenario: (idx: number) => void;
  onUpdateScenario: (idx: number, value: string) => void;
}

function SystemicTestRow({
  test,
  index,
  isEditing,
  isEven,
  onUpdate,
  onDelete,
  onAddScenario,
  onRemoveScenario,
  onUpdateScenario,
}: SystemicTestRowProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showGherkin, setShowGherkin] = useState(false);

  return (
    <>
      <TableRow className={`border-border/50 ${isEven ? 'bg-muted/30' : 'bg-muted/10'} hover:bg-muted/50 transition-colors`}>
        <TableCell className="pl-3 pr-0" />
        <TableCell className="text-[10px] text-muted-foreground font-mono pl-6">
          ST-{String(index).padStart(2, '0')}
        </TableCell>
        <TableCell className="pl-2">
          {isEditing && isEditingTitle ? (
            <Input
              value={test.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingTitle(false); }}
              autoFocus
              className="h-6 text-xs px-1.5"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs text-foreground/80 ${isEditing ? 'cursor-pointer hover:text-foreground' : ''}`}
                onClick={(e) => { if (isEditing) { e.stopPropagation(); setIsEditingTitle(true); } }}
              >
                {test.title}
              </span>
              {test.scenarios.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowScenarios(!showScenarios); }}
                  className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors ml-1"
                  title={showScenarios ? 'Ocultar escenarios' : 'Ver escenarios'}
                >
                  {showScenarios ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  ({test.scenarios.length} {test.scenarios.length === 1 ? 'escenario' : 'escenarios'})
                </button>
              )}
              {test.gherkinScenarios.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowGherkin(!showGherkin); }}
                  className="flex items-center gap-0.5 text-[9px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors ml-1"
                  title={showGherkin ? 'Ocultar Gherkin' : 'Ver Gherkin'}
                >
                  {showGherkin ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  BDD
                </button>
              )}
              {test.executionHistory.length > 0 && (
                <span className="text-[9px] text-muted-foreground ml-1" title={`${test.executionHistory.length} ejecuciones`}>
                  ({test.executionHistory.length} runs)
                </span>
              )}
            </div>
          )}
        </TableCell>
        <TableCell />
        <TableCell className="text-center">
          {isEditing ? (
            <div className="flex items-center gap-0.5 justify-center">
              <Select value={String(test.riskLikelihood)} onValueChange={(v) => onUpdate({ riskLikelihood: Number(v) as 1|2|3|4|5 })}>
                <SelectTrigger className="h-6 w-10 text-[10px] px-1 [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
                <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-[9px] text-muted-foreground">×</span>
              <Select value={String(test.riskImpact)} onValueChange={(v) => onUpdate({ riskImpact: Number(v) as 1|2|3|4|5 })}>
                <SelectTrigger className="h-6 w-10 text-[10px] px-1 [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
                <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <span className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              test.riskLikelihood * test.riskImpact >= 15 ? 'bg-red-500/10 text-red-700 dark:text-red-300' :
              test.riskLikelihood * test.riskImpact >= 8 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
              'bg-muted text-muted-foreground'
            }`}>
              {test.riskLikelihood * test.riskImpact}
            </span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {isEditing ? (
            <Select value={test.priority} onValueChange={(v) => onUpdate({ priority: v as TestCasePriority })}>
              <SelectTrigger className="h-6 w-full text-[10px] px-1.5 [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(priorityLabels) as TestCasePriority[]).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{priorityLabels[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${priorityColors[test.priority]}`}>
              {priorityLabels[test.priority]}
            </span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {isEditing ? (
            <Select value={test.status} onValueChange={(v) => onUpdate({ status: v as TestCaseStatus })}>
              <SelectTrigger className="h-6 w-full text-[10px] px-1.5 [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(statusLabels) as TestCaseStatus[]).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{statusLabels[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${statusColors[test.status]}`}>
              {statusLabels[test.status]}
            </span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {isEditing ? (
            <Select value={test.automationStatus} onValueChange={(v) => onUpdate({ automationStatus: v as AutomationStatus })}>
              <SelectTrigger className="h-6 w-full text-[10px] px-1.5 [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(automationLabels) as AutomationStatus[]).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{automationLabels[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${automationColors[test.automationStatus]}`}>
              {automationLabels[test.automationStatus]}
            </span>
          )}
        </TableCell>
        <TableCell>
          {isEditing ? (
            <Input
              value={test.assignedTo ?? ''}
              onChange={(e) => onUpdate({ assignedTo: e.target.value || null })}
              placeholder="Sin asignar"
              className="h-6 text-[10px] px-1.5"
            />
          ) : (
            <span className="text-[11px] text-muted-foreground">{test.assignedTo || 'Sin asignar'}</span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {test.linkedDefects.length > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
              <Bug className="h-3 w-3" />
              {test.linkedDefects.length}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </TableCell>
        {isEditing && (
          <TableCell className="text-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="h-6 w-6 p-0 text-red-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Eliminar test"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TableCell>
        )}
      </TableRow>

      {/* Scenarios sub-section */}
      {showScenarios && (
        <TableRow className={`border-border/30 ${isEven ? 'bg-muted/30' : 'bg-muted/10'}`}>
          <TableCell />
          <TableCell colSpan={isEditing ? 10 : 9} className="pl-6 py-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">
                Escenarios de prueba
              </p>
              {test.scenarios.map((scenario, sIdx) => (
                <div key={sIdx} className="flex items-center gap-1.5 group">
                  <span className="text-[9px] text-muted-foreground/60 font-mono w-4 text-right shrink-0">
                    {sIdx + 1}.
                  </span>
                  {isEditing ? (
                    <>
                      <Input
                        value={scenario}
                        onChange={(e) => onUpdateScenario(sIdx, e.target.value)}
                        className="h-5 text-[10px] px-1.5 flex-1"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onRemoveScenario(sIdx)}
                        className="h-5 w-5 p-0 text-red-400/60 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Eliminar escenario"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{scenario}</span>
                  )}
                </div>
              ))}
              {isEditing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onAddScenario}
                  className="h-5 gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 px-1.5 mt-0.5"
                >
                  <Plus className="h-2.5 w-2.5" />
                  Agregar escenario
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}

      {/* Gherkin scenarios sub-section */}
      {showGherkin && test.gherkinScenarios.length > 0 && (
        <TableRow className={`border-border/30 ${isEven ? 'bg-muted/30' : 'bg-muted/10'}`}>
          <TableCell />
          <TableCell colSpan={isEditing ? 10 : 9} className="pl-6 py-2">
            <div className="space-y-2">
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-semibold mb-1.5">
                Escenarios BDD (Gherkin)
              </p>
              {test.gherkinScenarios.map((gs) => (
                <div key={gs.id} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 space-y-0.5">
                  <p className="text-[10px] font-semibold text-foreground">{gs.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">Given </span>{gs.given}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-mono text-blue-600 dark:text-blue-400">When </span>{gs.when}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-mono text-amber-600 dark:text-amber-400">Then </span>{gs.then}
                  </p>
                  {gs.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {gs.tags.map((tag, i) => (
                        <span key={i} className="text-[8px] bg-muted px-1 py-0.5 rounded font-mono text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
