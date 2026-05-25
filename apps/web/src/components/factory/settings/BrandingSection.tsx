'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  BRANDING_ASSET_CONSTRAINTS,
  BRANDING_ASSET_DESCRIPTIONS,
  BRANDING_ASSET_LABELS,
  BRANDING_ASSET_TYPES,
  type BrandingAssetType,
  type BrandingSettings,
} from '@cenzontle/shared';
import { BRANDING_ASSET_FALLBACKS } from '@/lib/branding-fallbacks';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Check, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react';
import {
  deleteBrandingAsset,
  getBrandingSettings,
  updateBrandingSettings,
  uploadBrandingAsset,
} from '@/lib/api/branding';
import { useBranding } from '@/context/BrandingContext';
import { ApiError } from '@/lib/api/client';

/**
 * Sección "Identidad de marca" del dashboard de configuraciones.
 *
 * Permite a Alta Gerencia customizar:
 *  - companyName: nombre que aparece en <title> y aria-label del logo
 *  - logo: imagen del sidebar expandido
 *  - logoCollapsed: imagotipo del sidebar colapsado
 *  - favicon: icono de la pestaña del navegador
 *
 * Cada asset tiene su propio dropzone con preview. El upload es atómico
 * (un POST por asset) — el companyName se guarda con un PATCH separado al
 * presionar "Guardar".
 *
 * Tras cada mutación llamamos a `refresh()` del BrandingContext para que
 * el sidebar y el favicon se actualicen sin reload completo.
 */
export function BrandingSection() {
  const { branding: ctxBranding, refresh } = useBranding();
  const [branding, setBranding] = useState<BrandingSettings>(ctxBranding);
  const [companyName, setCompanyName] = useState(ctxBranding.companyName);
  const [savingName, setSavingName] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sync desde el endpoint al montar — el context ya tiene un valor (de
  // SSR), pero refetcheamos por si el admin abrió la página después de
  // alguien más actualizó el branding desde otra sesión.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBrandingSettings()
      .then((data) => {
        if (cancelled) return;
        setBranding(data);
        setCompanyName(data.companyName);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          toast.error('No tienes permiso para ver la configuración de branding');
        } else if (!(err instanceof ApiError) || err.status !== 401) {
          toast.error('No se pudo cargar la configuración de branding');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only refetch del singleton público; sin deps porque queremos un solo fire por mount del componente (el BrandingContext ya gestiona refetch reactivo tras mutaciones)
  }, []);

  const handleSaveName = useCallback(async () => {
    const trimmed = companyName.trim();
    if (!trimmed) {
      toast.error('El nombre de la empresa no puede estar vacío');
      return;
    }
    if (trimmed === branding.companyName) {
      toast.info('No hay cambios para guardar');
      return;
    }
    setSavingName(true);
    try {
      const updated = await updateBrandingSettings({ companyName: trimmed });
      setBranding(updated);
      setCompanyName(updated.companyName);
      await refresh();
      toast.success('Nombre de la empresa actualizado');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al guardar';
      toast.error(message);
    } finally {
      setSavingName(false);
    }
  }, [branding.companyName, companyName, refresh]);

  const handleAssetUploaded = useCallback(
    async (updated: BrandingSettings) => {
      setBranding(updated);
      await refresh();
    },
    [refresh],
  );

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="branding-section"
    >
      {/* Card 1: Nombre de la empresa */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-foreground">
            Nombre de la organización
          </h3>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Se muestra en la pestaña del navegador y como texto alternativo del
            logo. Visible para todos los usuarios.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="branding-company-name"
              className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Nombre
            </label>
            <Input
              id="branding-company-name"
              data-testid="branding-company-name-input"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Aeroméxico"
              maxLength={80}
              disabled={loading || savingName}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground/70 text-sm h-9"
            />
          </div>
          <Button
            onClick={handleSaveName}
            disabled={savingName || loading || companyName.trim() === branding.companyName}
            data-testid="branding-save-name-button"
            className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2"
            size="sm"
          >
            {savingName ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Guardar
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Card 2-4: Assets */}
      {BRANDING_ASSET_TYPES.map((type) => (
        <AssetUploadCard
          key={type}
          type={type}
          currentUrl={
            type === 'logo'
              ? branding.logoUrl
              : type === 'logoCollapsed'
              ? branding.logoCollapsedUrl
              : branding.faviconUrl
          }
          onUploaded={handleAssetUploaded}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AssetUploadCard({
  type,
  currentUrl,
  onUploaded,
}: {
  type: BrandingAssetType;
  currentUrl: string | null;
  onUploaded: (updated: BrandingSettings) => void | Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = () => inputRef.current?.click();

  const handleFile = useCallback(
    async (file: File) => {
      // Validación client-side antes de gastar el round-trip al server.
      if (file.size > BRANDING_ASSET_CONSTRAINTS.maxFileSizeBytes) {
        toast.error(
          `El archivo excede ${BRANDING_ASSET_CONSTRAINTS.maxFileSizeBytes / 1024 / 1024}MB`,
        );
        return;
      }
      if (file.size < BRANDING_ASSET_CONSTRAINTS.minFileSizeBytes) {
        toast.error('El archivo está vacío o es demasiado pequeño');
        return;
      }
      const accepted = BRANDING_ASSET_CONSTRAINTS.acceptedMimeTypes as readonly string[];
      if (!accepted.includes(file.type)) {
        toast.error(
          `Formato no aceptado: ${file.type || 'desconocido'}. Acepta PNG, JPG, WebP, ICO.`,
        );
        return;
      }
      setUploading(true);
      try {
        const updated = await uploadBrandingAsset(type, file);
        await onUploaded(updated);
        toast.success(`${BRANDING_ASSET_LABELS[type]} actualizado`);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Error al subir el archivo';
        toast.error(message);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onUploaded, type],
  );

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      const updated = await deleteBrandingAsset(type);
      await onUploaded(updated);
      toast.success(`${BRANDING_ASSET_LABELS[type]} restaurado al default`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al eliminar';
      toast.error(message);
    } finally {
      setRemoving(false);
    }
  }, [onUploaded, type]);

  const isCustom = currentUrl !== null;
  const previewSrc = currentUrl ?? BRANDING_ASSET_FALLBACKS[type];

  return (
    <div
      className="rounded-xl border border-border bg-card p-6"
      data-testid={`branding-asset-card-${type}`}
    >
      <div className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {BRANDING_ASSET_LABELS[type]}
          </h3>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
              isCustom
                ? 'bg-indigo-500/10 text-indigo-400'
                : 'bg-muted text-muted-foreground/70'
            }`}
          >
            {isCustom ? 'Personalizado' : 'Default CENZONTLE'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/70">
          {BRANDING_ASSET_DESCRIPTIONS[type]}
        </p>
      </div>

      <div className="flex items-start gap-5">
        {/* Preview */}
        <div
          className={`flex h-24 w-32 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 ${
            type === 'favicon' ? 'p-4' : 'p-3'
          }`}
          data-testid={`branding-asset-preview-${type}`}
        >
          {/* Image unoptimized para SVG dinámicos del backend; Next.js Image
              no permite host runtime variable sin domain whitelist. */}
          <Image
            key={previewSrc}
            src={previewSrc}
            alt={BRANDING_ASSET_LABELS[type]}
            width={type === 'favicon' ? 48 : 120}
            height={type === 'favicon' ? 48 : 48}
            unoptimized
            className="max-h-full max-w-full object-contain dark:invert"
          />
        </div>

        {/* Controls */}
        <div className="flex flex-1 flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={BRANDING_ASSET_CONSTRAINTS.acceptedMimeTypes.join(',')}
            className="hidden"
            data-testid={`branding-file-input-${type}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSelect}
              disabled={uploading || removing}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2"
              data-testid={`branding-upload-button-${type}`}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Subiendo...
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  {isCustom ? 'Reemplazar' : 'Subir archivo'}
                </>
              )}
            </Button>
            {isCustom && (
              <Button
                onClick={handleRemove}
                disabled={uploading || removing}
                size="sm"
                variant="ghost"
                className="gap-2 text-muted-foreground hover:text-foreground"
                data-testid={`branding-remove-button-${type}`}
              >
                {removing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Restaurando...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restaurar default
                  </>
                )}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60">
            Máximo {BRANDING_ASSET_CONSTRAINTS.maxFileSizeBytes / 1024 / 1024}MB.
            Formatos: PNG, JPG, WebP, ICO.
          </p>
        </div>
      </div>
    </div>
  );
}
