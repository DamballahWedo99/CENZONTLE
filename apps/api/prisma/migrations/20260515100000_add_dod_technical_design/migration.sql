-- Inserta el criterio DoD `technical-design` en installs existentes que ya
-- tenían los criterios estándar pre-existentes seedeados. Idempotente via
-- ON CONFLICT (kind). El position lo metemos entre acceptance-criteria
-- (typically position 1) y tests-passing (typically position 2) para que el
-- flow de validación sea: spec → diseño → tests.
--
-- Si el operador ya hizo un "Restaurar defaults" manual después de este
-- deploy, este insert es no-op (kind ya existe). Si NO hizo restore, este
-- insert agrega el criterio sin tocar position de los existentes — la UI
-- los renderea ordenados por position ASC, el nuevo aparece al final visual
-- hasta que el operador haga drag&drop o restore-defaults.
INSERT INTO "dod_criteria" (
  "id",
  "kind",
  "text",
  "description",
  "position",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'technical-design',
  'Sigue el diseño técnico del Tech Lead',
  'El código debe respetar la arquitectura, contratos API, patrones, validaciones y manejo de errores documentados en la sección Técnica de la story. Cada item del checklist técnico, cada endpoint/type/interface del contrato, cada regla de validación y cada flujo de errores definidos por el TL DEBEN estar visibles en el código (archivos, funciones, módulos correspondientes). NO improvisar decisiones que el TL ya tomó: si el TL dijo "usar repository pattern", no inventes un service pattern; si definió `interface LoginDto { email, password }`, el código debe tener esa interface con esos campos. El verifier evalúa per-item con grep determinístico + judgment semántico.',
  -- Position 99 para que aparezca al final de la lista por default — el
  -- operador puede reordenar via drag&drop si quiere otro orden.
  99,
  NOW(),
  NOW()
)
ON CONFLICT ("kind") DO NOTHING;
