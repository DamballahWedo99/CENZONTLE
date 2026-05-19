-- Add staging gate approval fields to Epic.
--
-- Cuando un TechLead aprueba el batch consolidated PR para mergear a DEV
-- (después del Forge done), persistimos quién y cuándo. Visible en
-- getBatchDetail/listQueue para que el frontend derive `currentLayer:Staging`
-- y mueva la épica al column Staged del Pipeline Board.
--
-- Step-up auth requerida en el endpoint que setea estos campos (password via
-- Auth0 + role check estricto). stagingApprovedByName es snapshot del display
-- name del aprobador al momento del approval para que el changelog persista
-- aunque el user se renombre o sea desactivado luego.
ALTER TABLE "epics" ADD COLUMN "stagingApprovedAt" TIMESTAMP(3);
ALTER TABLE "epics" ADD COLUMN "stagingApprovedBy" TEXT;
ALTER TABLE "epics" ADD COLUMN "stagingApprovedByName" TEXT;
