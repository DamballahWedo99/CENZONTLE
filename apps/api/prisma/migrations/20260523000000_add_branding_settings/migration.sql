-- Branding singleton: identidad de marca customizable por organización.
-- Reemplaza el logo/favicon hardcoded CENZONTLE por assets configurables
-- desde la UI (`/factory/settings?section=branding`).
--
-- La BD persiste SOLO la storage key opaca del archivo en disco — las URLs
-- públicas que ve el cliente se construyen en runtime en el service. Esto
-- evita acoplamiento entre la BD (capa de datos) y el routing del frontend
-- (capa de presentación) que puede cambiar sin migrar datos históricos.
--
-- ID fijo "singleton" — solo existe un row por instalación. El service hace
-- upsert con este ID para auto-seed la primera vez que se accede.
CREATE TABLE "branding_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "companyName" TEXT NOT NULL DEFAULT 'CENZONTLE',
    "logoStorageKey" TEXT,
    "logoCollapsedStorageKey" TEXT,
    "faviconStorageKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "branding_settings_pkey" PRIMARY KEY ("id")
);
