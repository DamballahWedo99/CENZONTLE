-- Agrega la columna `componentsCovered` a la tabla `stories`.
--
-- Contexto: el PO agent (story-generation.service.ts) emite el campo
-- `componentsCovered: string[]` para cada story cuando la épica tiene
-- un design bundle con componentManifest. El coverage gate
-- (GET /epics/:id/coverage-check) verifica que cada componente del
-- manifest aparezca en `componentsCovered` de al menos una story.
--
-- Hasta ahora el código emitía el campo pero el INSERT en BD no lo
-- persistía porque la columna no existía. Esta migration cierra ese gap.
--
-- Default `'{}'` (array vacío) preserva el comportamiento de stories
-- existentes (sin coverage) — no requiere backfill manual.

ALTER TABLE "stories"
  ADD COLUMN "componentsCovered" TEXT[] NOT NULL DEFAULT '{}';
