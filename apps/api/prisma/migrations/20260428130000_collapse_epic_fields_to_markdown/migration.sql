-- Collapse 12 narrative epic fields into a single `markdown` column.
-- Decision Opción B (destructive): drop existing columns. Sistema pre-producción
-- por lo que no hay data crítica en columnas viejas. Si se requiere preservar
-- contenido existente, correr este script ANTES en una transacción aparte:
--
--   UPDATE "epics" SET "description" = CONCAT(
--     '## Descripción', E'\n\n', "description", E'\n\n',
--     '## Beneficios cualitativos', E'\n\n', "qualitativeBenefits", E'\n\n',
--     '## Beneficios cuantitativos', E'\n\n', "quantitativeBenefits", E'\n\n',
--     '## Medición de beneficios', E'\n\n', "benefitsMeasurement", E'\n\n',
--     '## Alcance', E'\n\n', "scopeDescription", E'\n\n',
--     '## Criterios de aceptación', E'\n\n', "acceptanceCriteria", E'\n\n',
--     '## Mejoras tecnológicas', E'\n\n', "technologicalImprovements", E'\n\n',
--     '## Canales y flujos impactados', E'\n\n',
--     "impactedChannels", E'\n\n', "impactedFlows", E'\n\n',
--     '## Dependencias de terceros', E'\n\n', "thirdPartyDependencies"
--   );
--
-- y luego renombrar la columna `description` → `markdown` antes de correr esta
-- migration. Para este worktree (clean slate) la migration ejecuta drop directo.

ALTER TABLE "epics" ADD COLUMN "markdown" TEXT NOT NULL DEFAULT '';

ALTER TABLE "epics" DROP COLUMN "description";
ALTER TABLE "epics" DROP COLUMN "qualitativeBenefits";
ALTER TABLE "epics" DROP COLUMN "quantitativeBenefits";
ALTER TABLE "epics" DROP COLUMN "benefitsMeasurement";
ALTER TABLE "epics" DROP COLUMN "scopeDescription";
ALTER TABLE "epics" DROP COLUMN "acceptanceCriteria";
ALTER TABLE "epics" DROP COLUMN "technologicalImprovements";
ALTER TABLE "epics" DROP COLUMN "businessPriority";
ALTER TABLE "epics" DROP COLUMN "teamsInvolved";
ALTER TABLE "epics" DROP COLUMN "impactedChannels";
ALTER TABLE "epics" DROP COLUMN "impactedFlows";
ALTER TABLE "epics" DROP COLUMN "impactSabreLevel";
ALTER TABLE "epics" DROP COLUMN "thirdPartyDependencies";
