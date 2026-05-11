-- AlterTable: opt-in defensivo para que el Forge escriba en un CodeRepository.
-- Default false → repos existentes NO permiten escritura del Forge hasta que
-- el operador active explícitamente desde la UI (botón "Activar escritura").
ALTER TABLE "code_repositories" ADD COLUMN "forgeWritable" BOOLEAN NOT NULL DEFAULT false;
