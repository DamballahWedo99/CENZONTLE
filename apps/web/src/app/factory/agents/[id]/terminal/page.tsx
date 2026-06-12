'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  CriterionEvent,
  CriterionVerdict,
  DodVerificationEntry,
  FactoryAgent,
} from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import { AgentTerminal } from '@/components/factory/AgentTerminal';
import { ApiError } from '@/lib/api/client';
import {
  getRunDetail,
  isCriterionEventArray,
  type RunDetailResponse,
} from '@/lib/api/factory';
import { listDodCriteria, type DodCriterion } from '@/lib/api/dod';
import { useDocumentTitle } from '@/hooks/use-document-title';

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
    // Métricas reales del run. `duration` en SEGUNDOS (FactoryAgent lo
    // espera así); `durationMs` es null mientras el run no haya completado.
    duration: run.durationMs !== null ? Math.round(run.durationMs / 1000) : 0,
    tokens: run.tokensNew,
    cost: run.costUsd,
    lastOutput: run.lastOutput ? run.lastOutput.split('\n').slice(-5) : [],
    currentFile: null,
    // El worker del Forge no reporta líneas/tests granulares — quedan en 0.
    // En run mode el AgentDetailDrawer no los muestra (usa `runDetail`).
    linesWritten: 0,
    testsRun: 0,
    testsPassed: 0,
  };
}

/**
 * Type guard + merge del log estructurado de Tier 1 — `agent_runs.dodVerification`.
 *
 * Itera TODOS los attempts y construye un map por `criterionId`; el último
 * verdict gana por criterio. Esto evita la regresión visual que tenía la
 * versión anterior (`extractLastVerdicts`) durante POST `/progress`:
 *
 *   - Attempt 1 termina con 6 verdicts (1 passed, 5 failed) → UI: 1/6 ✓
 *   - Attempt 2 inicia, verifier emite 1er verdict → backend tiene
 *     `[{att:1, [6]}, {att:2, [1]}]`. La función vieja agarraba el último
 *     entry y devolvía SOLO 1 verdict — la UI mostraba 0/6 o 1/6 porque
 *     los otros 5 criterios caían a `return false` en `evaluateCriterion`.
 *   - Con merge, los 6 verdicts del attempt 1 quedan visibles hasta que
 *     el attempt 2 los sobrescriba uno por uno → progress monotónico.
 *
 * Semántica del "último gana": si el agente pasó un criterio en attempt 1
 * y lo rompió en attempt 2, el verdict 'failed' del attempt 2 manda
 * (refleja el estado real del repo, no historial optimista).
 *
 * El backend tipa `dodVerification` como `unknown[]` (validación shallow en
 * class-validator), por eso el guard runtime acá — `DodVerificationEntry`
 * solo le da tipo al output, no garantiza el input.
 */
function extractMergedVerdicts(raw: unknown): CriterionVerdict[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const byCriterion = new Map<string, CriterionVerdict>();
  for (const entry of raw as Array<Partial<DodVerificationEntry> | undefined>) {
    if (!entry || !Array.isArray(entry.verdicts)) continue;
    for (const v of entry.verdicts) {
      if (
        v != null &&
        typeof v === 'object' &&
        typeof (v as CriterionVerdict).criterionId === 'string' &&
        typeof (v as CriterionVerdict).label === 'string' &&
        ['passed', 'failed', 'skipped'].includes((v as CriterionVerdict).status)
      ) {
        byCriterion.set((v as CriterionVerdict).criterionId, v as CriterionVerdict);
      }
    }
  }
  return byCriterion.size > 0 ? [...byCriterion.values()] : null;
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
  criteriaProgress: CriterionEvent[],
): { text: string; done: boolean }[] {
  const verdicts = extractMergedVerdicts(run.dodVerification);
  return config.map((c) => ({
    text: c.text,
    done: evaluateCriterion(c, run, criteriaProgress, verdicts),
  }));
}

function evaluateCriterion(
  criterion: DodCriterion,
  run: RunDetailResponse,
  criteriaProgress: CriterionEvent[],
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
 * Milestones para runs reales — vienen de criteriaProgress que combina:
 *  - `source: 'story'`: acceptance criteria parseados del vault (pill PRIMARIA
 *    "acceptance"), marcados individualmente por el verifier Sonnet per-criterio.
 *  - `source: 'worker'`: milestones técnicos hardcoded del runner (pill
 *    SECUNDARIA "workflow"), marcados durante el flow del worker.
 *  - `source: 'agent'`: legacy self-report, DEPRECATED 2026-05-13 (no
 *    debería venir ya, pero filtramos por compatibilidad con runs históricos).
 *
 * El `source` se preserva en el shape para que el AgentTerminal pueda
 * separar las dos pills.
 */
function deriveMilestonesFromRun(
  run: RunDetailResponse,
): { text: string; done: boolean; source: 'worker' | 'agent' | 'story' }[] {
  if (!isCriterionEventArray(run.criteriaProgress)) return [];
  return run.criteriaProgress.map((c) => ({
    text: c.label,
    done: c.status === 'completed',
    source: c.source,
  }));
}

/**
 * Página `/factory/agents/:id/terminal`. El `id` es un AgentRun.id (uuid)
 * del flujo Forge real. El camino "mock" legacy (lookup en los agents del
 * FactoryContext) se retiró junto con el slice `state.agents` (2026-06-11):
 * el slice estaba permanentemente vacío, así que toda visita real ya
 * entraba por este flujo.
 *
 * Hace polling del backend, sintetiza un FactoryAgent compatible y pasa
 * runOverride a `<AgentTerminal>`.
 */
export default function AgentTerminalPage() {
  const params = useParams();
  const agentId = params.id as string;
  // Title con el ID truncado del run — permite al operador identificar la
  // pestaña sin abrirla cuando hay varios terminales abiertos. El storyTitle
  // real podría inyectarse después que el run cargue (via state), pero hoy
  // el ID es suficiente para distinguir.
  useDocumentTitle(`Terminal · ${agentId.slice(0, 8)}`);

  const [run, setRun] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Catálogo de criterios DoD configurado en `/factory/settings`. Se carga
  // una vez al mount; cambia rara vez (operador edita manualmente). Si el
  // operador edita mientras el terminal está abierto, basta con refrescar
  // la página — no vale el overhead de re-poll cada 5s.
  const [dodConfig, setDodConfig] = useState<DodCriterion[]>([]);

  useEffect(() => {
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
  }, []);

  const fetchRun = useCallback(async () => {
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
  }, [agentId]);

  useEffect(() => {
    void fetchRun();
    const interval = setInterval(() => void fetchRun(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRun]);

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
            isCriterionEventArray(run.criteriaProgress) ? run.criteriaProgress : [],
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
      // Branch del run — cuando el run ya terminó (ttyd del worker cerrado),
      // el AgentTerminal embebe un Claude Code nuevo sobre esta branch en
      // lugar de un spinner infinito. '' mientras `run` aún carga: en esa
      // ventana el status es Idle, así que el terminal embebido no se monta.
      branch: run?.branch ?? '',
      dod: dodEvaluated,
      milestones: milestonesEvaluated,
      prNumber: run?.prNumber ?? null,
      loading,
      error,
      // Datos reales del run para el AgentDetailDrawer. Mientras `run` carga
      // usamos placeholders neutros — el drawer no se abre en esa ventana.
      drawer: {
        branch: run?.branch ?? '',
        epicId: run?.epicId ?? '',
        epicTitle: run?.epicTitle ?? '',
        epicTrackerKey: run?.epicTrackerKey ?? null,
        storyTitle: run?.storyTitle ?? '',
        storyPoints: run?.storyPoints ?? 0,
        storyTrackerKey: run?.storyTrackerKey ?? null,
        dependsOn: run?.dependsOn ?? [],
        durationMs: run?.durationMs ?? null,
        tokensNew: run?.tokensNew ?? 0,
        costUsd: run?.costUsd ?? 0,
        filesModified: run?.filesModified ?? null,
        attempts: run?.attempts ?? 0,
        // Conteo del DoD evaluado (mismo array que pinta el header).
        dodPassed: dodEvaluated.filter((c) => c.done).length,
        dodTotal: dodEvaluated.length,
      },
    }),
    [run, dodEvaluated, milestonesEvaluated, loading, error],
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
