'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  CriterionVerdict,
  DodVerificationEntry,
  FactoryAgent,
} from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import { useFactory } from '@/context/FactoryContext';
import { AgentTerminal } from '@/components/factory/AgentTerminal';
import { ApiError } from '@/lib/api/client';
import { getRunDetail, type RunDetailResponse } from '@/lib/api/factory';
import { listDodCriteria, type DodCriterion } from '@/lib/api/dod';

const POLL_INTERVAL_MS = 5_000;

/**
 * Mapeo del status del backend al AgentStatus enum del FactoryAgent.
 * Nos da el color correcto en el header dot + badge.
 */
const RUN_STATUS_TO_AGENT_STATUS: Record<RunDetailResponse['status'], AgentStatus> = {
  claimed: AgentStatus.Coding,
  running: AgentStatus.Coding,
  completed: AgentStatus.Done,
  failed: AgentStatus.Error,
  abandoned: AgentStatus.Error,
};

interface RunCriterion {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  source: 'worker' | 'agent';
}

function isCriterionArray(v: unknown): v is RunCriterion[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      typeof (c as Record<string, unknown>).id === 'string' &&
      typeof (c as Record<string, unknown>).label === 'string' &&
      typeof (c as Record<string, unknown>).status === 'string',
  );
}

/**
 * Construye un FactoryAgent sintético a partir del RunDetailResponse para
 * que el AgentTerminal (que espera un FactoryAgent en sus props) pueda
 * renderear el run real con el MISMO chrome del mock.
 */
function synthesizeAgentFromRun(run: RunDetailResponse): FactoryAgent {
  return {
    id: run.runId,
    name: run.storyTitle,
    storyId: run.storyId,
    storyKey: `run-${run.runId.slice(0, 8)}`,
    status: RUN_STATUS_TO_AGENT_STATUS[run.status],
    worktree: '/forge', // dummy — no se usa en runMode (auto-start está skip)
    tmuxSession: `cenzontle-${run.runId.slice(0, 8)}`,
    startedAt: run.startedAt,
    duration: 0,
    tokens: 0,
    cost: 0,
    lastOutput: run.lastOutput ? run.lastOutput.split('\n').slice(-5) : [],
    currentFile: null,
    linesWritten: 0,
    testsRun: 0,
    testsPassed: 0,
  };
}

/**
 * Type guard del log estructurado de Tier 1 — `agent_runs.dodVerification`.
 * Devuelve los verdicts del último attempt si el shape es válido, sino null.
 *
 * El backend tipa `dodVerification` como `unknown[]` (validación shallow en
 * `class-validator`), por eso el guard runtime acá — `DodVerificationEntry`
 * solo le da tipo al output, no garantiza el input.
 *
 * Tolera arrays parciales: durante POST `/progress` el último attempt puede
 * tener `verdicts.length < dodConfig.length` (UX progressive — checkmarks
 * incrementales). Los criterios sin verdict aún caen al fallback heurístico
 * de `evaluateCriterion`.
 */
function extractLastVerdicts(raw: unknown): CriterionVerdict[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const last = raw[raw.length - 1] as Partial<DodVerificationEntry> | undefined;
  if (!last || !Array.isArray(last.verdicts)) return null;
  return last.verdicts.filter(
    (v): v is CriterionVerdict =>
      v != null &&
      typeof v === 'object' &&
      typeof (v as CriterionVerdict).label === 'string' &&
      ['passed', 'failed', 'skipped'].includes((v as CriterionVerdict).status),
  );
}

/**
 * DoD del run — derivado del catálogo configurado en `/factory/settings/Definition of Done`
 * + estado del run + verdicts del Tier 1 verifier (si ya corrió).
 *
 * Estrategia de evaluación por criterio (en orden de prioridad):
 *   1. **Tier 1 verifier (autoritative)**: si `dodVerification` tiene un
 *      verdict para este criterio (matched por kind o label), eso manda.
 *      `passed` o `skipped` → done. `failed` → not done.
 *   2. **Self-report del agente**: matched en `criteriaProgress` por kind/label.
 *      completed=true → done.
 *   3. **Heurística legacy** desde `run.exitCode`/`prNumber`/`errorMessage`.
 *      Solo aplica para los kinds estándar pre-Tier-1.
 *   4. Custom criteria sin reporte ni verifier → done=false.
 */
function evaluateDodFromConfig(
  config: DodCriterion[],
  run: RunDetailResponse,
  criteriaProgress: RunCriterion[],
): { text: string; done: boolean }[] {
  const verdicts = extractLastVerdicts(run.dodVerification);
  return config
    .filter((c) => c.enabled)
    .map((c) => ({
      text: c.text,
      done: evaluateCriterion(c, run, criteriaProgress, verdicts),
    }));
}

function evaluateCriterion(
  criterion: DodCriterion,
  run: RunDetailResponse,
  criteriaProgress: RunCriterion[],
  verdicts: CriterionVerdict[] | null,
): boolean {
  // 1. Tier 1 verifier — si ya corrió, su veredicto manda. Match por kind
  //    estable o por label exacto. `skipped` se considera done (el verifier
  //    no pudo verificar pero no es failure — ej. repo sin pnpm test).
  if (verdicts) {
    const v = verdicts.find(
      (vd) =>
        (criterion.kind !== null && vd.kind === criterion.kind) ||
        vd.label === criterion.text,
    );
    if (v) return v.status === 'passed' || v.status === 'skipped';
    // El Tier 1 verifier YA empezó (verdicts !== null) pero aún NO emitió
    // verdict para este criterio. Devolvemos `false` (pending) en lugar de
    // caer al self-report del agente (2026-05-11).
    //
    // Razón: si caemos al self-report, el agente generator dirá "ya está
    // completed" antes de que el verifier independiente valide nada. Eso
    // produce el bug visual de "todos los criterios ✓ desde el principio" —
    // el opuesto del UX progressive que queremos. El verdict autoritativo
    // viene SOLO del Tier 1 verifier; el self-report del generator es
    // sycophancy potencial y no manda.
    //
    // Trade-off aceptado: durante los 60-90s que tarda el verifier en
    // procesar los 7 criterios, la UI muestra "criterio pending" en lugar
    // de "auto-marked done por el agente". Eso es más honesto y refleja
    // el estado real del DoD.
    return false;
  }

  // 2. Self-report del agente vía .cenzontle-criteria.json. Match por kind
  //    (con o sin prefix `agent.`) o por label exacto. SOLO aplica cuando
  //    el Tier 1 verifier no corrió aún (verdicts === null) — ej. runs
  //    legacy pre-Tier-1 o runs con `dodCriteria` vacío.
  const reported = criteriaProgress.find(
    (c) =>
      (criterion.kind !== null &&
        (c.id === `agent.${criterion.kind}` || c.id === criterion.kind)) ||
      c.label === criterion.text,
  );
  if (reported) return reported.status === 'completed';

  // 3. Heurística legacy: pre-Tier-1 podemos derivar algunos del exit state.
  //    Solo aplica cuando el run ya completó (exitCode != null).
  switch (criterion.kind) {
    case 'code-written':
      return run.exitCode === 0;
    case 'tests-passing':
      return run.exitCode === 0; // mock — Tier 1 verifier lo reemplaza
    case 'pr-created':
      return run.prNumber !== null;
    case 'no-errors':
      return run.exitCode === 0 && run.errorMessage === null;
    case 'docs-updated':
    case 'security-scan':
    case 'perf-budget':
    case 'accessibility':
      // Sin verifier, no podemos auto-evaluar — false hasta que Tier 1
      // verifier corra o el agente reporte explícitamente.
      return false;
    default:
      // Custom criteria (kind=null) sin reporte del agente ni verifier.
      return false;
  }
}

/**
 * Milestones para runs reales — vienen de criteriaProgress (worker +
 * agente). Si no hay criterios reportados aún, devuelve [] y el pill
 * mostrará 0/0.
 */
function deriveMilestonesFromRun(run: RunDetailResponse): { text: string; done: boolean }[] {
  if (!isCriterionArray(run.criteriaProgress)) return [];
  return run.criteriaProgress.map((c) => ({
    text: c.label,
    done: c.status === 'completed',
  }));
}

/**
 * Página `/factory/agents/:id/terminal`. El `id` puede venir de dos fuentes:
 *  1. **Mock**: agents legacy del FactoryContext
 *  2. **Backend**: AgentRun.id (uuid) creado por el flujo Forge real
 *
 * En ambos casos renderea el MISMO componente `<AgentTerminal>` — para
 * runs reales hace polling del backend, sintetiza un FactoryAgent
 * compatible y pasa runOverride. El componente decide internamente qué
 * lógica aplicar según si runOverride está presente o no.
 */
export default function AgentTerminalPage() {
  const params = useParams();
  const agentId = params.id as string;
  const { state } = useFactory();

  const mockAgent = useMemo(
    () => state.agents.find((a) => a.id === agentId) ?? null,
    [state.agents, agentId],
  );

  // Si NO es mock, asumimos runId del backend y hacemos polling 5s.
  const isRunMode = !mockAgent;
  const [run, setRun] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(isRunMode);
  const [error, setError] = useState<string | null>(null);
  // Catálogo de criterios DoD configurado en `/factory/settings`. Se carga
  // una vez al mount; cambia rara vez (operador edita manualmente). Si el
  // operador edita mientras el terminal está abierto, basta con refrescar
  // la página — no vale el overhead de re-poll cada 5s.
  const [dodConfig, setDodConfig] = useState<DodCriterion[]>([]);

  useEffect(() => {
    if (!isRunMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const criteria = await listDodCriteria();
        if (!cancelled) setDodConfig(criteria);
      } catch {
        // 401 lo maneja client wrapper. 403 = no eres Alta Gerencia →
        // no mostramos error porque el page mismo ya bloquea con error
        // del fetchRun. Otros errores los silenciamos para no romper la
        // UX del run mismo.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRunMode]);

  const fetchRun = useCallback(async () => {
    if (!isRunMode) return;
    try {
      const result = await getRunDetail(agentId);
      setRun(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(`Run ${agentId} no encontrado en el backend.`);
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Solo Alta Gerencia puede ver el output de runs.');
      } else if (err instanceof ApiError && err.status !== 401) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, isRunMode]);

  useEffect(() => {
    if (!isRunMode) return;
    void fetchRun();
    const interval = setInterval(() => void fetchRun(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRun, isRunMode]);

  // Render mock — comportamiento legacy
  if (mockAgent) {
    return (
      <div className="terminal-page h-full w-full bg-background dark">
        <AgentTerminal agent={mockAgent} onClose={() => window.close()} />
      </div>
    );
  }

  // Render run real — sintetiza FactoryAgent + pasa runOverride
  // mientras se carga el run, sintetizamos un placeholder con status Idle
  const syntheticAgent: FactoryAgent = run
    ? synthesizeAgentFromRun(run)
    : {
        id: agentId,
        name: 'Cargando run…',
        storyId: null,
        storyKey: null,
        status: AgentStatus.Idle,
        worktree: '/forge',
        tmuxSession: '',
        startedAt: null,
        duration: 0,
        tokens: 0,
        cost: 0,
        lastOutput: [],
        currentFile: null,
        linesWritten: 0,
        testsRun: 0,
        testsPassed: 0,
      };

  // Memos para evitar recomputar derived state en cada render (2026-05-11).
  // Antes los cálculos vivían inline en el JSX y se ejecutaban cada vez que
  // React decidía re-renderear este componente (varias veces por poll), aun
  // cuando los inputs no habían cambiado.
  const dodEvaluated = useMemo(
    () =>
      run
        ? evaluateDodFromConfig(
            dodConfig,
            run,
            isCriterionArray(run.criteriaProgress) ? run.criteriaProgress : [],
          )
        : [],
    [run, dodConfig],
  );
  const milestonesEvaluated = useMemo(
    () => (run ? deriveMilestonesFromRun(run) : []),
    [run],
  );
  // El wrapper también memoizado: si `AgentTerminal` recibe la misma
  // referencia de runOverride entre renders, evitamos re-render del subtree.
  const runOverride = useMemo(
    () => ({
      ttydUrl: run?.ttydUrl ?? null,
      dod: dodEvaluated,
      milestones: milestonesEvaluated,
      prNumber: run?.prNumber ?? null,
      loading,
      error,
    }),
    [run?.ttydUrl, run?.prNumber, dodEvaluated, milestonesEvaluated, loading, error],
  );

  return (
    <div className="terminal-page h-full w-full bg-background dark">
      <AgentTerminal
        agent={syntheticAgent}
        onClose={() => window.close()}
        runOverride={runOverride}
      />
    </div>
  );
}
