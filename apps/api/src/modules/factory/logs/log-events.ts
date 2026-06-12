import type { CriterionVerdict, DodVerificationEntry } from '@cenzontle/shared';

/**
 * Contrato de `GET /factory/logs` — espejo en `apps/web/src/lib/api/factory.ts`
 * (mismo patrón que /factory/cost y /factory/prs: el backend es canónico, el
 * frontend duplica el shape para no acoplar el build de web al del API).
 *
 * Cada entry es un evento DERIVADO del estado persistido en Prisma — no hay
 * tabla de eventos ni log shipping: el stream se reconstruye en cada request
 * desde `Epic` (lifecycle de la cola) y `AgentRun` (lifecycle del run,
 * milestones del worker en `criteriaProgress`, veredictos del verifier en
 * `dodVerification`). Eso lo hace robusto por construcción: sobrevive
 * reinicios del API/worker/navegador porque la fuente es la BD, y los ids
 * deterministas permiten al frontend reconciliar entre polls sin parpadeo.
 */
export type ForgeLogSource = 'forge' | 'agent' | 'worker' | 'dod';
export type ForgeLogLevel = 'info' | 'warn' | 'error';

export interface ForgeLogEntry {
  /** Determinista y estable entre polls (ej. `run-X:dod:2:tests-passing`) —
   *  el frontend lo usa como React key y para conservar la fila expandida. */
  id: string;
  /** ISO 8601. */
  timestamp: string;
  /**
   *  - `forge`: lifecycle del batch en la cola (enqueue, integration branch,
   *    PR consolidado, staging gate).
   *  - `agent`: lifecycle del AgentRun (iniciado, en curso, completado,
   *    fallido, abandonado).
   *  - `worker`: milestones técnicos del runner (clone, commit, push, PR)
   *    desde `criteriaProgress` con source='worker'.
   *  - `dod`: veredictos del DoD verifier por criterio/attempt desde
   *    `dodVerification`.
   */
  source: ForgeLogSource;
  /** batchId para eventos `forge`; runId para el resto. */
  sourceId: string;
  level: ForgeLogLevel;
  message: string;
  batchId: string;
  epicTitle: string;
  /** Null para eventos batch-level (source `forge`). */
  storyTitle: string | null;
}

export interface ForgeLogsResponse {
  logs: ForgeLogEntry[];
}

// ── Shape del row que el service selecciona de Prisma ───────────────────────
//
// IMPORTANTE: mantener sincronizado con el `select` de
// `ForgeLogsService.listLogs` — el service castea el resultado de Prisma a
// estos tipos, así que un campo agregado aquí sin agregarlo al select
// compila pero llega undefined en runtime.

export interface RunLogRow {
  id: string;
  status: string;
  attempts: number | null;
  prNumber: number | null;
  exitCode: number | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  lastProgressAt: Date;
  /** Json crudo de Prisma — validado con type guards antes de usar. */
  criteriaProgress: unknown;
  /** Json crudo de Prisma — validado con type guards antes de usar. */
  dodVerification: unknown;
  node: { name: string } | null;
}

export interface StoryLogRow {
  id: string;
  title: string;
  agentRuns: RunLogRow[];
}

export interface EpicLogRow {
  id: string;
  title: string;
  enqueuedAt: Date | null;
  enqueuedBatchId: string | null;
  forgeBranch: string | null;
  forgeBranchCreatedAt: Date | null;
  consolidatedPrNumber: number | null;
  consolidatedPrCreatedAt: Date | null;
  consolidatedPrMergedAt: Date | null;
  stagingApprovedAt: Date | null;
  stagingApprovedByName: string | null;
  stories: StoryLogRow[];
}

// ── Guards para los Json columns ─────────────────────────────────────────────

/**
 * Entry de `criteriaProgress` ya validada. Espejo laxo de `CriterionEvent`
 * (shared) — los timestamps vienen como ISO strings escritos por el worker,
 * así que se re-validan con Date.parse antes de emitir el evento.
 */
interface ParsedCriterionEvent {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  source: 'worker' | 'agent' | 'story';
  startedAt?: string;
  completedAt?: string;
}

function parseCriterionEvents(raw: unknown): ParsedCriterionEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is ParsedCriterionEvent => {
    if (e === null || typeof e !== 'object') return false;
    const r = e as Record<string, unknown>;
    return (
      typeof r.id === 'string' &&
      typeof r.label === 'string' &&
      (r.status === 'pending' ||
        r.status === 'in_progress' ||
        r.status === 'completed' ||
        r.status === 'failed') &&
      (r.source === 'worker' || r.source === 'agent' || r.source === 'story')
    );
  });
}

/** Mismos guards que `deriveDodStatus` (prs/dod-status.ts), sin el merge. */
function parseDodEntries(raw: unknown): DodVerificationEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is DodVerificationEntry => {
      if (e === null || typeof e !== 'object') return false;
      const r = e as Record<string, unknown>;
      return typeof r.attempt === 'number' && Array.isArray(r.verdicts);
    })
    .sort((a, b) => a.attempt - b.attempt);
}

function isValidVerdict(v: unknown): v is CriterionVerdict {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.criterionId === 'string' &&
    typeof r.label === 'string' &&
    (r.status === 'passed' || r.status === 'failed' || r.status === 'skipped')
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cap defensivo para errorMessage/reason — el row ya viene redactado y
 *  truncado del worker, pero el mensaje del log debe ser una línea legible. */
function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** ISO string del worker → Date válida o null (nunca emitir Invalid Date). */
function parseIso(value: string | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

// ── Derivación ───────────────────────────────────────────────────────────────

/**
 * Deriva todos los eventos de log de un epic encolado al Forge. Función pura
 * (sin DI) para testear la derivación sin mocks de Nest — mismo patrón que
 * `gate-readiness`/`failure-info`/`dod-status`.
 *
 * No ordena ni capea: eso es responsabilidad del service, que mergea los
 * eventos de todos los batches de la ventana.
 */
export function deriveEpicLogEntries(epic: EpicLogRow): ForgeLogEntry[] {
  const batchId = epic.enqueuedBatchId;
  if (!batchId) return [];

  const entries: ForgeLogEntry[] = [];
  const batchEvent = (
    idSuffix: string,
    timestamp: Date,
    level: ForgeLogLevel,
    message: string,
  ) => {
    entries.push({
      id: `${epic.id}:${idSuffix}`,
      timestamp: timestamp.toISOString(),
      source: 'forge',
      sourceId: batchId,
      level,
      message,
      batchId,
      epicTitle: epic.title,
      storyTitle: null,
    });
  };

  if (epic.enqueuedAt) {
    batchEvent(
      'enqueued',
      epic.enqueuedAt,
      'info',
      `Épica «${epic.title}» encolada al Forge (${epic.stories.length} historias)`,
    );
  }
  if (epic.forgeBranchCreatedAt && epic.forgeBranch) {
    batchEvent(
      'forge-branch',
      epic.forgeBranchCreatedAt,
      'info',
      `Integration branch ${epic.forgeBranch} creada`,
    );
  }
  if (epic.consolidatedPrCreatedAt && epic.consolidatedPrNumber !== null) {
    batchEvent(
      'consolidated-pr-created',
      epic.consolidatedPrCreatedAt,
      'info',
      `PR consolidado #${epic.consolidatedPrNumber} abierto hacia staging`,
    );
  }
  if (epic.consolidatedPrMergedAt && epic.consolidatedPrNumber !== null) {
    batchEvent(
      'consolidated-pr-merged',
      epic.consolidatedPrMergedAt,
      'info',
      `PR consolidado #${epic.consolidatedPrNumber} mergeado a staging`,
    );
  }
  if (epic.stagingApprovedAt) {
    const by = epic.stagingApprovedByName ? ` por ${epic.stagingApprovedByName}` : '';
    batchEvent(
      'staging-approved',
      epic.stagingApprovedAt,
      'info',
      `Staging gate aprobado${by}`,
    );
  }

  for (const story of epic.stories) {
    for (const run of story.agentRuns) {
      entries.push(...deriveRunLogEntries(epic, batchId, story, run));
    }
  }

  return entries;
}

function deriveRunLogEntries(
  epic: EpicLogRow,
  batchId: string,
  story: StoryLogRow,
  run: RunLogRow,
): ForgeLogEntry[] {
  const entries: ForgeLogEntry[] = [];
  const runEvent = (
    idSuffix: string,
    source: ForgeLogSource,
    timestamp: Date,
    level: ForgeLogLevel,
    message: string,
  ) => {
    entries.push({
      id: `${run.id}:${idSuffix}`,
      timestamp: timestamp.toISOString(),
      source,
      sourceId: run.id,
      level,
      message,
      batchId,
      epicTitle: epic.title,
      storyTitle: story.title,
    });
  };

  const nodeName = run.node?.name ?? 'worker desconocido';
  // Mejor anclaje disponible para eventos sin timestamp propio (veredictos
  // DoD): cierre del run si terminó, último progress si sigue vivo
  // (lastProgressAt es NOT NULL con default now() en el schema).
  const anchor = run.completedAt ?? run.lastProgressAt;

  // ── agent: lifecycle del run ──────────────────────────────────────────
  runEvent(
    'started',
    'agent',
    run.startedAt,
    'info',
    `Run iniciado para «${story.title}» en ${nodeName}`,
  );

  switch (run.status) {
    case 'claimed':
      runEvent(
        'live',
        'agent',
        run.lastProgressAt,
        'info',
        `Story «${story.title}» reclamada por ${nodeName} — preparando workspace`,
      );
      break;
    case 'running':
      runEvent(
        'live',
        'agent',
        run.lastProgressAt,
        'info',
        `Run en curso — «${story.title}» en ${nodeName} (último progreso reportado)`,
      );
      break;
    case 'completed': {
      const pr = run.prNumber !== null ? `, PR #${run.prNumber}` : '';
      const tries =
        (run.attempts ?? 1) > 1 ? `, ${run.attempts} intentos del DoD loop` : '';
      runEvent(
        'completed',
        'agent',
        anchor,
        'info',
        `Run completado — «${story.title}»${pr}${tries}`,
      );
      break;
    }
    case 'failed': {
      const exit = run.exitCode !== null ? ` (exit ${run.exitCode})` : '';
      const reason = run.errorMessage ? `: ${truncate(run.errorMessage, 300)}` : '';
      runEvent(
        'failed',
        'agent',
        anchor,
        'error',
        `Run falló${exit} — «${story.title}»${reason}`,
      );
      break;
    }
    case 'abandoned':
      runEvent(
        'abandoned',
        'agent',
        run.lastProgressAt,
        'warn',
        `Run abandonado — el worker dejó de reportar progreso (>10 min) — «${story.title}»`,
      );
      break;
    default:
      // Status desconocido (schema drift) — no inventar semántica.
      break;
  }

  if ((run.attempts ?? 1) > 1) {
    runEvent(
      'attempts',
      'dod',
      anchor,
      'warn',
      `DoD loop requirió ${run.attempts} intentos — «${story.title}»`,
    );
  }

  // ── worker: milestones técnicos de criteriaProgress ───────────────────
  for (const criterion of parseCriterionEvents(run.criteriaProgress)) {
    // Solo los milestones del runner: son objetivos (clone, commit, push,
    // PR) y no dependen del agente. Los criterios 'story' ya quedan
    // cubiertos por los veredictos del verifier (source 'dod') y 'agent'
    // es el self-report legacy deprecado por sycophancy (2026-05-13).
    if (criterion.source !== 'worker') continue;

    const startedAt = parseIso(criterion.startedAt);
    const completedAt = parseIso(criterion.completedAt);

    if (criterion.status === 'completed' && (completedAt ?? startedAt)) {
      runEvent(
        `worker:${criterion.id}`,
        'worker',
        (completedAt ?? startedAt) as Date,
        'info',
        `${criterion.label} — «${story.title}»`,
      );
    } else if (criterion.status === 'failed' && (completedAt ?? startedAt)) {
      runEvent(
        `worker:${criterion.id}`,
        'worker',
        (completedAt ?? startedAt) as Date,
        'error',
        `${criterion.label} — falló — «${story.title}»`,
      );
    } else if (criterion.status === 'in_progress' && startedAt) {
      runEvent(
        `worker:${criterion.id}`,
        'worker',
        startedAt,
        'info',
        `${criterion.label} — en progreso — «${story.title}»`,
      );
    }
    // 'pending' o sin timestamps: todavía no es un evento.
  }

  // ── dod: veredictos del verifier por attempt/criterio ─────────────────
  // Cada veredicto de cada attempt es una línea de log (historia completa
  // del loop), a diferencia del merge last-wins ACROSS attempts que usa la
  // UI de detail. Sin timestamp propio en el shape → anclados al
  // cierre/último progress. Los ids resultantes son OPACOS: no parsearlos
  // de vuelta (un criterionId custom puede contener `:`).
  for (const dodEntry of parseDodEntries(run.dodVerification)) {
    // Last-wins por criterionId DENTRO del attempt: un worker con drift
    // podría emitir el mismo criterio dos veces en un attempt y duplicaría
    // ids → React keys duplicadas en el viewer (qa-reviewer 2026-06-11).
    const byCriterion = new Map<string, CriterionVerdict>();
    for (const verdict of dodEntry.verdicts) {
      if (isValidVerdict(verdict)) byCriterion.set(verdict.criterionId, verdict);
    }
    for (const verdict of byCriterion.values()) {
      const reason = verdict.reason ? ` — ${truncate(verdict.reason, 200)}` : '';
      const base = `DoD intento ${dodEntry.attempt} — ${verdict.label}`;
      if (verdict.status === 'passed') {
        runEvent(
          `dod:${dodEntry.attempt}:${verdict.criterionId}`,
          'dod',
          anchor,
          'info',
          `${base}: PASS`,
        );
      } else if (verdict.status === 'failed') {
        runEvent(
          `dod:${dodEntry.attempt}:${verdict.criterionId}`,
          'dod',
          anchor,
          'error',
          `${base}: FAIL${reason}`,
        );
      } else {
        runEvent(
          `dod:${dodEntry.attempt}:${verdict.criterionId}`,
          'dod',
          anchor,
          'warn',
          `${base}: SKIP${reason}`,
        );
      }
    }
  }

  return entries;
}
