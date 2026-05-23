-- Agrega `dodMaxAttempts` al singleton AgentTokenSettings — tope de intentos
-- del DoD enforcement loop del worker.
--
-- 1 (default) = una sola pasada: el verificador es no-bloqueante, los
-- criterios sin cumplir quedan como warn y la story igual completa.
--
-- >1 activa los reintentos (configurable en /factory/settings → tab Factory):
--   - ante un error duro (crash de claude / sin tokens / falló el clone o el
--     push) el worker re-corre el run con el prompt original;
--   - ante criterios del DoD sin cumplir, re-spawnea claude con un
--     retry-prompt quirúrgico.
-- Sin doom loop — es un tope simple de N intentos.

ALTER TABLE "agent_token_settings"
  ADD COLUMN "dodMaxAttempts" INTEGER NOT NULL DEFAULT 1;

-- Triángulo de validación nivel DB: el rango 1-3 ya está enforced en DTO
-- (`@Min(1) @Max(3)`) y clampado defensivamente en el service y en el worker
-- (`resolveMaxDodAttempts`). El CHECK aquí cierra el triángulo: blinda
-- contra escrituras directas vía Prisma (seeds, scripts ad-hoc) o ediciones
-- manuales en SQL que bypaseen el DTO. Si un actor escribe `0` o `99`, la
-- transacción aborta en vez de persistir un valor fuera de rango.
ALTER TABLE "agent_token_settings"
  ADD CONSTRAINT "agent_token_settings_dodMaxAttempts_range"
  CHECK ("dodMaxAttempts" BETWEEN 1 AND 3);
