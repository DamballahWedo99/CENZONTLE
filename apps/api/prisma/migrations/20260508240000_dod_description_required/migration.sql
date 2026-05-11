-- description ahora es REQUERIDO (NOT NULL). Cambio de regla de negocio:
-- todos los criterios deben dar contexto al agente vía descripción.
--
-- Estrategia:
--   1) Backfill criterios con description NULL o vacía con un placeholder
--      explícito que le señale al operador "este criterio necesita
--      atención" — distinguible de descripciones reales en searches.
--   2) Aplicar el SET NOT NULL recién después del backfill (sino falla
--      con violación de NOT NULL para los rows pre-existentes).

UPDATE "dod_criteria"
SET "description" = '(Sin descripción detallada. Edita este criterio para agregar contexto al agente.)'
WHERE "description" IS NULL OR TRIM("description") = '';

ALTER TABLE "dod_criteria" ALTER COLUMN "description" SET NOT NULL;
