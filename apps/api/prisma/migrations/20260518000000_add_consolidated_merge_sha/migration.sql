-- Agrega `consolidatedMergeSha` al modelo Epic — SHA del merge commit del PR
-- consolidated a DEV. Persistido en el mismo CAS transaction que ya guarda
-- `consolidatedPrMergedAt` cuando `approveStagingGate` ejecuta el merge.
--
-- Por qué: tras el fix del cleanup automático (2026-05-17), las integration
-- branches del Forge se borran post-merge. Esto rompía el feature de preview
-- (PreviewService clonaba la branch para mostrar el estado del batch). Con
-- este SHA persistido, el preview tiene un fallback robusto:
--   1. Branch viva → usa la branch (path actual, sin cambios)
--   2. Branch borrada + sha persistido → clone dev + checkout SHA
--   3. Branch borrada + sin SHA pero con consolidatedPrNumber → lookup PR
--      via GitHub API → merge_commit_sha → checkout
--
-- Nullable y retro-compatible: epics pre-existentes mergeados antes de este
-- deploy no tienen el SHA en DB; el preview cae al fallback 3 (PR API) en
-- esos casos.

ALTER TABLE "epics" ADD COLUMN "consolidatedMergeSha" TEXT;
