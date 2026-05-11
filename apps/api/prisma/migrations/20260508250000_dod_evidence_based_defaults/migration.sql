-- Refresh del default DoD basado en research de industria (Atlassian, Scrum.org,
-- Codacy AI agents, DORA/Accelerate). Cambios:
--
--   1. NUEVO: acceptance-criteria (cumple criterios de aceptación de la historia)
--      → el más citado por las fuentes; gap más universalmente identificado.
--   2. REACTIVADO: security-scan (sin vulnerabilidades críticas)
--      → enabled=true. Codacy lo marca must-have especialmente para AI agents
--      (probabilísticos → generan código inseguro con cierta frecuencia).
--   3. REFINADO: tests-passing
--      → quita el threshold "≥ 90% cobertura" (DORA: "Move beyond line coverage
--      to risk-based testing"). Reemplaza por "tests pasando + casos edge cubiertos".
--      Solo aplica si el operador NO personalizó el text — para preservar ediciones.
--
-- Defensive: usa NOT EXISTS para inserts (idempotente vs runs previas) y
-- WHERE matching para updates (no pisa lo que el operador editó).

-- 1) Insertar acceptance-criteria si no existe (operador puede haberlo agregado
--    como custom con otro kind, pero como kind es UNIQUE no puede duplicarse).
INSERT INTO "dod_criteria" ("id", "kind", "text", "description", "enabled", "required", "position", "updatedAt")
SELECT
  gen_random_uuid(),
  'acceptance-criteria',
  'Cumple criterios de aceptación de la historia',
  'El código no solo debe ejecutarse, debe cumplir TODOS los criterios de aceptación descritos en la historia. Lee la story como una spec: cada bullet es un test mental. Si la story dice "el botón debe ser azul", verifica el color. Si dice "el endpoint retorna 404 cuando no encuentra el recurso", escribe el caso. No marques el criterio como cumplido si solo parte de los acceptance criteria están cubiertos — todos o ninguno.',
  true,
  true,
  1,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "dod_criteria" WHERE "kind" = 'acceptance-criteria');

-- 2a) Reactivar security-scan si existe + enabled=false (operador no lo borró,
--     solo estaba en estado disabled del seed original).
UPDATE "dod_criteria"
SET "enabled" = true,
    "required" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "kind" = 'security-scan' AND "enabled" = false;

-- 2b) Insertar security-scan si NO existe (operador lo borró completamente).
INSERT INTO "dod_criteria" ("id", "kind", "text", "description", "enabled", "required", "position", "updatedAt")
SELECT
  gen_random_uuid(),
  'security-scan',
  'Sin vulnerabilidades críticas de seguridad',
  'Tu código no debe introducir vulnerabilidades de severidad crítica/alta detectables por herramientas estándar (npm audit, dependabot, semgrep). En particular: cero command injection, cero SQL injection, cero secretos hardcoded, cero XSS en componentes que renderean input del usuario. Validá inputs en los boundaries del sistema (endpoints, queries DB, exec de comandos shell).',
  true,
  true,
  4,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "dod_criteria" WHERE "kind" = 'security-scan');

-- 3) Refinar tests-passing SOLO si el operador NO personalizó el text. La
--    detección por texto exacto del seed original es ruda pero conservadora —
--    si el operador editó aunque sea una palabra, dejamos su versión intacta.
UPDATE "dod_criteria"
SET "text" = 'Tests pasando + casos edge cubiertos',
    "description" = 'Los tests automáticos del repo deben pasar localmente (npm test / pnpm test) antes de pushear. Más importante que la cobertura numérica es la CALIDAD de los tests: cubrí el happy path + casos edge (inputs vacíos, valores límite, condiciones de error) + manejo de errores. NO bypasear tests con flags ni excluir archivos del coverage para alcanzar un threshold. NO escribir tests triviales solo para subir el coverage % — eso es teatro de cobertura sin valor real.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "kind" = 'tests-passing'
  AND "text" = 'Tests pasando ≥ 90% cobertura';

-- 4) Reordenar los criterios estándar a las posiciones canónicas del modelo
--    nuevo (0..6). Usa CASE para que sea atómico — un solo UPDATE.
UPDATE "dod_criteria" SET "position" = CASE
  WHEN "kind" = 'code-written'        THEN 0
  WHEN "kind" = 'acceptance-criteria' THEN 1
  WHEN "kind" = 'tests-passing'       THEN 2
  WHEN "kind" = 'no-errors'           THEN 3
  WHEN "kind" = 'security-scan'       THEN 4
  WHEN "kind" = 'pr-created'          THEN 5
  WHEN "kind" = 'docs-updated'        THEN 6
  ELSE "position"
END
WHERE "kind" IN (
  'code-written', 'acceptance-criteria', 'tests-passing',
  'no-errors', 'security-scan', 'pr-created', 'docs-updated'
);

-- 5) Empujar criterios CUSTOM (kind=null) detrás de los estándar. Mantienen
--    su orden relativo entre sí pero quedan a partir de position=7.
WITH ranked_custom AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "position" ASC, "createdAt" ASC) - 1 + 7 AS new_pos
  FROM "dod_criteria"
  WHERE "kind" IS NULL
)
UPDATE "dod_criteria"
SET "position" = ranked_custom.new_pos,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_custom
WHERE "dod_criteria"."id" = ranked_custom."id";
