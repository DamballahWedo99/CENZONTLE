-- Make Initiative.startDate and Initiative.targetDate nullable.
-- Permite crear iniciativas en borrador/planning sin fechas comprometidas.
-- El frontend pide las fechas cuando se transiciona el status fuera de 'planning'.

ALTER TABLE "initiatives" ALTER COLUMN "startDate" DROP NOT NULL;
ALTER TABLE "initiatives" ALTER COLUMN "targetDate" DROP NOT NULL;
