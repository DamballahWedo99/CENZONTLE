-- Definition of Done criteria — catálogo global aplicable a todas las stories.
-- Reemplaza el local-state hardcoded del frontend. Editable desde
-- /factory/settings/Definition of Done por Alta Gerencia.

CREATE TABLE "dod_criteria" (
  "id"        TEXT          NOT NULL,
  "kind"      TEXT,
  "text"      TEXT          NOT NULL,
  "enabled"   BOOLEAN       NOT NULL DEFAULT true,
  "required"  BOOLEAN       NOT NULL DEFAULT false,
  "position"  INTEGER       NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "dod_criteria_pkey" PRIMARY KEY ("id")
);

-- `kind` es un identificador estable opcional (nullable) que el frontend
-- usa para mapear a lógica de evaluación determinística. UNIQUE permite
-- múltiples NULLs (custom criteria) en Postgres.
CREATE UNIQUE INDEX "dod_criteria_kind_key" ON "dod_criteria" ("kind");

-- Seed inicial: los 5 criterios que estaban hardcoded en el frontend
-- (DEFAULT_DOD_CRITERIA en SettingsDashboard.tsx). Manteniendo el mismo
-- orden, enabled y required que el shape original. Custom criteria que
-- el operador agregue después tendrán kind=NULL.
INSERT INTO "dod_criteria" ("id", "kind", "text", "enabled", "required", "position", "updatedAt") VALUES
  (gen_random_uuid(), 'code-written',   'Código escrito y funcional',                     true,  true,  0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tests-passing',  'Tests pasando ≥ 90% cobertura',                  true,  true,  1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'pr-created',     'PR creado y aprobado',                           true,  true,  2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'no-errors',      'Sin errores de lint/typecheck',                  true,  true,  3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'docs-updated',   'Documentación actualizada',                      true,  false, 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'security-scan',  'Scan de seguridad sin vulnerabilidades críticas', false, false, 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'perf-budget',    'Dentro del presupuesto de performance',          false, false, 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'accessibility',  'Cumple WCAG 2.1 AA',                             false, false, 7, CURRENT_TIMESTAMP);
