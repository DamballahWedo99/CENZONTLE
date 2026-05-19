-- Remove `enabled` and `required` columns from dod_criteria — both flags eran
-- scaffolding sin UI: backend tenía el schema completo (defaults, DTO, service,
-- filter en agent-run.service) pero el frontend nunca expuso toggles. Todos los
-- rows existentes tienen enabled=true y required=true|false sin que nadie haya
-- cambiado los valores via UI.
--
-- Drop simple: no hay data útil que preservar (todos están en su default desde
-- siempre). El flujo de DoD ahora es: si está en la tabla, está activo. Sin
-- ambigüedad.

ALTER TABLE "dod_criteria" DROP COLUMN "enabled";
ALTER TABLE "dod_criteria" DROP COLUMN "required";
