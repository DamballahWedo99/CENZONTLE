-- Agrega `description` a dod_criteria. El campo se inyecta en el prompt
-- del agente durante el run para darle contexto sobre cada criterio.
-- Nullable porque es enrichment, no requerement: criterios sin descripción
-- siguen funcionando, el agente solo ve el `text` corto.

ALTER TABLE "dod_criteria" ADD COLUMN "description" TEXT;

-- Backfill descripciones para los criterios estándar sembrados en la
-- migration anterior (20260508233000_add_dod_criteria). Match por `kind`
-- estable. Custom criteria que el operador haya agregado quedan con
-- description=NULL (correcto — el operador puede editar después).

UPDATE "dod_criteria" SET "description" =
  'El código implementado debe ejecutarse sin errores de runtime y cumplir el comportamiento descrito en la historia. Si la story define un endpoint, debe responder; si define un componente, debe renderearse; si define una función, debe retornar valores correctos para los casos descritos. No basta con que compile — debe correr.'
  WHERE "kind" = 'code-written';

UPDATE "dod_criteria" SET "description" =
  'La cobertura de tests automáticos para el código nuevo o modificado debe ser ≥ 90%. Esto cubre tests unitarios, de integración o e2e según el tipo de código. Tests deben pasar localmente (npm test / pnpm test) antes de pushear. NO bypasear coverage con flags ni excluir archivos del coverage report para alcanzar el threshold.'
  WHERE "kind" = 'tests-passing';

UPDATE "dod_criteria" SET "description" =
  'Al terminar el trabajo, debes pushear la branch al remote y abrir un Pull Request en GitHub apuntando a la branch base de la épica (forge/sprint-batch-{epicId}). El PR debe tener título descriptivo y body explicando qué se implementó. La aprobación humana del PR es la confirmación final.'
  WHERE "kind" = 'pr-created';

UPDATE "dod_criteria" SET "description" =
  'No debe haber errores de lint (ESLint/Biome/etc.) ni de TypeScript en el código modificado. Corre `pnpm lint` y `pnpm type-check` antes de cerrar el run. Si encontrás errores pre-existentes en archivos que NO estás modificando, déjalos — no expandas el scope.'
  WHERE "kind" = 'no-errors';

UPDATE "dod_criteria" SET "description" =
  'Si tu cambio modifica APIs públicas, comportamiento del usuario, comandos CLI, variables de entorno, o flujos de auth, actualiza la documentación correspondiente (README, docs/, CLAUDE.md) en el mismo PR. Cambios internos sin impacto visible no requieren docs.'
  WHERE "kind" = 'docs-updated';

UPDATE "dod_criteria" SET "description" =
  'Tu código no debe introducir vulnerabilidades de severidad crítica/alta detectables por herramientas estándar (npm audit, dependabot, semgrep). En particular: cero command injection, cero SQL injection, cero secretos hardcoded, cero XSS en componentes que renderean input del usuario. Validá inputs en boundaries.'
  WHERE "kind" = 'security-scan';

UPDATE "dod_criteria" SET "description" =
  'El código no debe degradar performance medible: latencia de endpoints ≤ +20% del baseline, bundle size ≤ +5% del baseline. Para cambios en hot paths (login, dashboard, queries N+1 sospechosas), considera profiling antes de pushear.'
  WHERE "kind" = 'perf-budget';

UPDATE "dod_criteria" SET "description" =
  'Componentes UI nuevos o modificados deben cumplir WCAG 2.1 nivel AA: contraste de color ≥ 4.5:1 para texto normal y ≥ 3:1 para texto grande, navegación por teclado funcional, aria-labels en controles sin texto, focus-visible en todos los interactive elements.'
  WHERE "kind" = 'accessibility';
