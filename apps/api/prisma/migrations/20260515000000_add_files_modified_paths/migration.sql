-- Agrega filesModifiedPaths al AgentRun para que el backend pueda inyectar
-- los paths concretos producidos por stories previas del DAG al prompt del
-- próximo agente — sin esto el agente solo recibía el COUNT (filesModified)
-- sin saber qué archivos leer para respetar contratos previos.
--
-- Default '{}' (array vacío) para que runs legacy NO null-pointers en
-- los consumers; equivalente semánticamente a "no se conocen paths".
ALTER TABLE "agent_runs"
ADD COLUMN "filesModifiedPaths" TEXT[] NOT NULL DEFAULT '{}';
