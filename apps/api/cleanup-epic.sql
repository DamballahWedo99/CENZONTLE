-- ═════════════════════════════════════════════════════════════════════
-- CLEANUP: re-encolado de épica para regenerar integration branch
-- ═════════════════════════════════════════════════════════════════════
-- Epic ID: 5f3db0a3-f3f2-4eb8-ae35-e625952a31a1 (de los logs del user)
--
-- Pasos:
-- 1. Aborta cualquier AgentRun activo (claimed|running) de stories de
--    esta épica → status='abandoned'
-- 2. Reset de todas las stories → status='backlog', claimedAt=NULL
-- 3. Des-encola la épica → enqueuedAt=NULL, enqueuedBatchId=NULL
--
-- Después de esto, el operador re-encola desde el dashboard y mi código
-- de Fase 2 (enqueueEpic) creará la integration branch en GitHub.
-- ═════════════════════════════════════════════════════════════════════

-- 1. Abortar runs activos asociados a esta épica
UPDATE agent_runs
SET
  status = 'abandoned',
  "completedAt" = NOW(),
  "errorMessage" = 'Manual reset (re-enqueue para crear forge integration branch)'
WHERE
  status IN ('claimed', 'running')
  AND "storyId" IN (
    SELECT id FROM stories
    WHERE "epicId" = '5f3db0a3-f3f2-4eb8-ae35-e625952a31a1'
  );

-- 2. Reset stories al backlog (en caso de que sandbox mode las haya marcado done)
UPDATE stories
SET
  status = 'backlog',
  "claimedAt" = NULL
WHERE
  "epicId" = '5f3db0a3-f3f2-4eb8-ae35-e625952a31a1';

-- 3. Des-encolar la épica (clear forgeBranch fields para que el re-enqueue cree fresh)
UPDATE epics
SET
  "enqueuedAt" = NULL,
  "enqueuedBatchId" = NULL,
  "forgeBranch" = NULL,
  "forgeBranchCreatedAt" = NULL,
  "forgeBranchBaseSha" = NULL
WHERE
  id = '5f3db0a3-f3f2-4eb8-ae35-e625952a31a1';
