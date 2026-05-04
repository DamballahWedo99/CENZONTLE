'use client';

import { useState } from 'react';
import { Loader2, KeyRound, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createExternalSecret } from '@/lib/api/external-secrets';
import type { ExternalSecret } from '@cenzontle/shared';

interface CreateExternalSecretInlineFormProps {
  /** Pre-llenado: name sugerido (ej: `STRIPE_API_KEY`). Editable. */
  defaultName?: string;
  /** Pre-llenado: vendor sugerido (ej: `Stripe`). Editable. */
  defaultVendor?: string;
  /** Pre-llenado: descripción sugerida. Editable. */
  defaultDescription?: string;
  /** Si viene, al crear el secret se auto-resuelve la dep que lo originó. */
  sourceDependencyId?: string;
  /** Callback post-crear; recibe el secret creado (enmascarado). */
  onCreated?: (secret: ExternalSecret) => void;
  /** Callback al cancelar (cierra el form sin crear). */
  onCancel: () => void;
}

/**
 * Variante inline del `CreateExternalSecretDialog`. Misma lógica de
 * persistencia (CryptoService AES-256-GCM, auto-resolve de dep via
 * `sourceDependencyId`), pero sin Dialog wrapper — pensada para expandirse
 * dentro de una card existente (típicamente la dep card que originó la
 * resolución, manteniendo contexto visual).
 *
 * Visualmente mira al `DependencyForm` de StoryDependencies para que el
 * usuario perciba paridad UX: misma border-2/primary, mismos labels
 * uppercase + tracking-wider, mismo Cancel/CTA layout en el footer.
 *
 * El `Dialog` original sigue existiendo para los casos standalone
 * (Settings > External secrets) donde no hay una "card padre" donde
 * expandirse y el modal-flotante sigue siendo el patrón natural.
 */
export function CreateExternalSecretInlineForm({
  defaultName = '',
  defaultVendor = '',
  defaultDescription = '',
  sourceDependencyId,
  onCreated,
  onCancel,
}: CreateExternalSecretInlineFormProps) {
  const [name, setName] = useState(defaultName);
  const [vendor, setVendor] = useState(defaultVendor);
  const [description, setDescription] = useState(defaultDescription);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameValid = /^[A-Z][A-Z0-9_]*$/.test(name.trim());
  const canSubmit = nameValid && value.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const secret = await createExternalSecret({
        name: name.trim(),
        value: value.trim(),
        vendor: vendor.trim() || undefined,
        description: description.trim() || undefined,
        sourceDependencyId,
      });
      toast.success(`Secret ${secret.name} guardado`, {
        description: sourceDependencyId
          ? 'La dependencia se marcó como resuelta automáticamente'
          : 'Disponible para el runtime vía ExternalSecretsService.getByName()',
      });
      onCreated?.(secret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setError(message);
      toast.error('No se pudo guardar el secret', { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-primary/40 p-4 space-y-3 bg-card shadow-sm">
      <div className="flex items-center gap-2 pb-1">
        <KeyRound className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-sm font-semibold">Guardar credencial externa</h4>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        El valor se encripta con AES-256-GCM antes de persistir. Nunca se
        devuelve en claro por la API — solo el runtime interno puede leerlo.
      </p>

      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Nombre (UPPER_SNAKE_CASE)
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          placeholder="STRIPE_API_KEY"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {!nameValid && name.length > 0 && (
          <p className="text-[10px] text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Debe ser UPPER_SNAKE_CASE (solo A-Z, 0-9, _; empezar con letra).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Proveedor (opcional)
          </label>
          <Input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Stripe"
            className="text-sm"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Descripción (opcional)
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tokenización de pagos checkout"
            className="text-sm"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Valor
        </label>
        <Input
          name="__no_store"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk_live_..."
          className="font-mono text-xs"
          autoComplete="new-password"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
        />
        <p className="text-[10px] text-muted-foreground">
          Se encripta con `CryptoService` (AES-256-GCM + scrypt). Solo visible
          enmascarado en la UI.
        </p>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="gap-1.5"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <KeyRound className="h-3.5 w-3.5" />
          )}
          Guardar credencial
        </Button>
      </div>
    </div>
  );
}
