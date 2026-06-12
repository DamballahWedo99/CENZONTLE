import {
  deriveEpicLogEntries,
  type EpicLogRow,
  type RunLogRow,
  type StoryLogRow,
} from './log-events';

describe('deriveEpicLogEntries', () => {
  const baseRun = (over: Partial<RunLogRow> = {}): RunLogRow => ({
    id: 'run-1',
    status: 'completed',
    attempts: 1,
    prNumber: 101,
    exitCode: 0,
    errorMessage: null,
    startedAt: new Date('2026-06-10T09:00:00Z'),
    completedAt: new Date('2026-06-10T09:30:00Z'),
    lastProgressAt: new Date('2026-06-10T09:29:00Z'),
    criteriaProgress: null,
    dodVerification: null,
    node: { name: 'mac-mini-01' },
    ...over,
  });

  const baseStory = (over: Partial<StoryLogRow> = {}): StoryLogRow => ({
    id: 'story-1',
    title: 'Login form',
    agentRuns: [baseRun()],
    ...over,
  });

  const baseEpic = (over: Partial<EpicLogRow> = {}): EpicLogRow => ({
    id: 'epic-1',
    title: 'Checkout épico',
    enqueuedAt: new Date('2026-06-10T08:00:00Z'),
    enqueuedBatchId: 'batch-1',
    forgeBranch: 'forge/sprint-batch-epic1',
    forgeBranchCreatedAt: new Date('2026-06-10T08:00:05Z'),
    consolidatedPrNumber: null,
    consolidatedPrCreatedAt: null,
    consolidatedPrMergedAt: null,
    stagingApprovedAt: null,
    stagingApprovedByName: null,
    stories: [baseStory()],
    ...over,
  });

  it('sin enqueuedBatchId no emite nada (epic fuera del Forge)', () => {
    expect(deriveEpicLogEntries(baseEpic({ enqueuedBatchId: null }))).toEqual([]);
  });

  it('emite el lifecycle completo del batch como eventos forge', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        consolidatedPrNumber: 55,
        consolidatedPrCreatedAt: new Date('2026-06-10T10:00:00Z'),
        consolidatedPrMergedAt: new Date('2026-06-10T11:00:00Z'),
        stagingApprovedAt: new Date('2026-06-10T10:30:00Z'),
        stagingApprovedByName: 'Ana TL',
        stories: [],
      }),
    );

    const forge = entries.filter((e) => e.source === 'forge');
    expect(forge.map((e) => e.id)).toEqual([
      'epic-1:enqueued',
      'epic-1:forge-branch',
      'epic-1:consolidated-pr-created',
      'epic-1:consolidated-pr-merged',
      'epic-1:staging-approved',
    ]);
    expect(forge.every((e) => e.level === 'info')).toBe(true);
    expect(forge.every((e) => e.sourceId === 'batch-1')).toBe(true);
    expect(forge.every((e) => e.storyTitle === null)).toBe(true);
    expect(forge.find((e) => e.id === 'epic-1:staging-approved')?.message).toContain(
      'Ana TL',
    );
    expect(
      forge.find((e) => e.id === 'epic-1:consolidated-pr-created')?.message,
    ).toContain('#55');
  });

  it('omite eventos del batch cuyo timestamp falta', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        enqueuedAt: null,
        forgeBranchCreatedAt: null,
        stories: [],
      }),
    );
    expect(entries).toEqual([]);
  });

  it('run completado: started info + completed info con PR y attempts', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [baseStory({ agentRuns: [baseRun({ attempts: 3 })] })],
      }),
    );

    const started = entries.find((e) => e.id === 'run-1:started');
    expect(started).toMatchObject({
      source: 'agent',
      level: 'info',
      sourceId: 'run-1',
      storyTitle: 'Login form',
      timestamp: '2026-06-10T09:00:00.000Z',
    });
    expect(started?.message).toContain('mac-mini-01');

    const completed = entries.find((e) => e.id === 'run-1:completed');
    expect(completed?.level).toBe('info');
    expect(completed?.message).toContain('PR #101');
    expect(completed?.message).toContain('3 intentos');
    // Anclado al cierre del run.
    expect(completed?.timestamp).toBe('2026-06-10T09:30:00.000Z');

    // attempts > 1 además emite el warn del DoD loop.
    const attempts = entries.find((e) => e.id === 'run-1:attempts');
    expect(attempts).toMatchObject({ source: 'dod', level: 'warn' });
  });

  it('run fallido: error con exit code y errorMessage truncado a una línea', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [
              baseRun({
                status: 'failed',
                exitCode: 65,
                errorMessage: `doom loop\ndetectado${'x'.repeat(400)}`,
              }),
            ],
          }),
        ],
      }),
    );
    const failed = entries.find((e) => e.id === 'run-1:failed');
    expect(failed?.level).toBe('error');
    expect(failed?.message).toContain('exit 65');
    expect(failed?.message).not.toContain('\n');
    expect(failed?.message.length).toBeLessThan(400);
  });

  it('run abandonado: warn anclado a lastProgressAt', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [baseRun({ status: 'abandoned', completedAt: null })],
          }),
        ],
      }),
    );
    const abandoned = entries.find((e) => e.id === 'run-1:abandoned');
    expect(abandoned).toMatchObject({
      level: 'warn',
      timestamp: '2026-06-10T09:29:00.000Z',
    });
  });

  it('run reclamado (claimed): evento live de preparación de workspace', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [baseRun({ status: 'claimed', completedAt: null })],
          }),
        ],
      }),
    );
    const live = entries.find((e) => e.id === 'run-1:live');
    expect(live).toMatchObject({
      source: 'agent',
      level: 'info',
      timestamp: '2026-06-10T09:29:00.000Z',
    });
    expect(live?.message).toContain('preparando workspace');
  });

  it('run activo (running): evento live anclado a lastProgressAt', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [baseRun({ status: 'running', completedAt: null })],
          }),
        ],
      }),
    );
    const live = entries.find((e) => e.id === 'run-1:live');
    expect(live).toMatchObject({
      source: 'agent',
      level: 'info',
      timestamp: '2026-06-10T09:29:00.000Z',
    });
  });

  it('criteriaProgress: solo milestones source=worker, con nivel por status', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [
              baseRun({
                criteriaProgress: [
                  {
                    id: 'repo_cloned',
                    label: 'Repositorio clonado',
                    status: 'completed',
                    source: 'worker',
                    startedAt: '2026-06-10T09:01:00Z',
                    completedAt: '2026-06-10T09:02:00Z',
                  },
                  {
                    id: 'push',
                    label: 'Push al remote',
                    status: 'failed',
                    source: 'worker',
                    completedAt: '2026-06-10T09:25:00Z',
                  },
                  {
                    id: 'build',
                    label: 'Build en progreso',
                    status: 'in_progress',
                    source: 'worker',
                    startedAt: '2026-06-10T09:10:00Z',
                  },
                  // pending → no es evento todavía
                  {
                    id: 'pr',
                    label: 'PR abierto',
                    status: 'pending',
                    source: 'worker',
                  },
                  // story → cubierto por los veredictos DoD, no se duplica
                  {
                    id: 'ac-1',
                    label: 'Criterio de aceptación 1',
                    status: 'completed',
                    source: 'story',
                    completedAt: '2026-06-10T09:20:00Z',
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const worker = entries.filter((e) => e.source === 'worker');
    expect(worker.map((e) => e.id).sort()).toEqual([
      'run-1:worker:build',
      'run-1:worker:push',
      'run-1:worker:repo_cloned',
    ]);
    expect(worker.find((e) => e.id === 'run-1:worker:repo_cloned')).toMatchObject({
      level: 'info',
      timestamp: '2026-06-10T09:02:00.000Z',
    });
    expect(worker.find((e) => e.id === 'run-1:worker:push')?.level).toBe('error');
    expect(worker.find((e) => e.id === 'run-1:worker:build')).toMatchObject({
      level: 'info',
      timestamp: '2026-06-10T09:10:00.000Z',
    });
  });

  it('dodVerification: un evento por veredicto por attempt, anclado al cierre', () => {
    const verdict = (criterionId: string, status: string, reason?: string) => ({
      criterionId,
      label: criterionId,
      kind: null,
      command: null,
      exitCode: null,
      output: null,
      status,
      reason,
    });
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [
              baseRun({
                dodVerification: [
                  {
                    attempt: 1,
                    verdicts: [
                      verdict('tests-passing', 'failed', 'jest exit 1'),
                      verdict('no-errors', 'skipped', 'sin lint script'),
                    ],
                  },
                  {
                    attempt: 2,
                    verdicts: [verdict('tests-passing', 'passed')],
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const dod = entries.filter((e) => e.source === 'dod');
    expect(dod.map((e) => e.id).sort()).toEqual([
      'run-1:dod:1:no-errors',
      'run-1:dod:1:tests-passing',
      'run-1:dod:2:tests-passing',
    ]);
    expect(dod.find((e) => e.id === 'run-1:dod:1:tests-passing')).toMatchObject({
      level: 'error',
    });
    expect(dod.find((e) => e.id === 'run-1:dod:1:tests-passing')?.message).toContain(
      'jest exit 1',
    );
    expect(dod.find((e) => e.id === 'run-1:dod:1:no-errors')?.level).toBe('warn');
    expect(dod.find((e) => e.id === 'run-1:dod:2:tests-passing')).toMatchObject({
      level: 'info',
      timestamp: '2026-06-10T09:30:00.000Z',
    });
  });

  it('veredictos duplicados por criterionId en el mismo attempt: last-wins (ids únicos)', () => {
    const verdict = (status: string) => ({
      criterionId: 'tests-passing',
      label: 'tests',
      kind: null,
      command: null,
      exitCode: null,
      output: null,
      status,
    });
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [
              baseRun({
                dodVerification: [
                  { attempt: 1, verdicts: [verdict('failed'), verdict('passed')] },
                ],
              }),
            ],
          }),
        ],
      }),
    );
    const dod = entries.filter((e) => e.id === 'run-1:dod:1:tests-passing');
    expect(dod).toHaveLength(1);
    // Gana el último veredicto del array.
    expect(dod[0].level).toBe('info');
  });

  it('Json malformado en criteriaProgress/dodVerification no rompe ni emite', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [
              baseRun({
                criteriaProgress: { not: 'an array' },
                dodVerification: [
                  null,
                  'garbage',
                  { attempt: 'NaN', verdicts: [] },
                  { attempt: 1, verdicts: [null, { criterionId: 42 }] },
                ],
              }),
            ],
          }),
        ],
      }),
    );
    expect(entries.filter((e) => e.source === 'worker')).toEqual([]);
    expect(entries.filter((e) => e.source === 'dod')).toEqual([]);
    // El lifecycle del run sigue intacto.
    expect(entries.find((e) => e.id === 'run-1:started')).toBeDefined();
  });

  it('timestamps inválidos del worker en criteriaProgress se omiten', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({
            agentRuns: [
              baseRun({
                criteriaProgress: [
                  {
                    id: 'clone',
                    label: 'Clone',
                    status: 'completed',
                    source: 'worker',
                    completedAt: 'no-es-una-fecha',
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    );
    expect(entries.filter((e) => e.source === 'worker')).toEqual([]);
  });

  it('status de run desconocido no emite evento terminal pero conserva started', () => {
    const entries = deriveEpicLogEntries(
      baseEpic({
        stories: [
          baseStory({ agentRuns: [baseRun({ status: 'weird-future-status' })] }),
        ],
      }),
    );
    expect(entries.find((e) => e.id === 'run-1:started')).toBeDefined();
    expect(entries.find((e) => e.id === 'run-1:completed')).toBeUndefined();
    expect(entries.find((e) => e.id === 'run-1:live')).toBeUndefined();
  });
});
