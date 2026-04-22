'use client';

import { useEffect, useState } from 'react';
import { Loader2, KeyRound, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createExternalSecret } from '@/lib/api/external-secrets';
import type { ExternalSecret } from '@cenzontle/shared';

interface CreateExternalSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}

/**
 * Dialog compartido entre dos entry points:
 *  - Settings > Secretos externos > botón "Crear nuevo"
 *  - `EpicDependencies` > card de dep IA con `requiresCredential` > botón "Resolver con secret"
 *
 * En el segundo caso el caller pre-llena `defaultName`, `defaultVendor`,
 * `defaultDescription`, y `sourceDependencyId` para que el backend
 * auto-resuelva la dep con `linkedSecretId`.
 */
export function CreateExternalSecretDialog({
  open,
  onOpenChange,
  defaultName = '',
  defaultVendor = '',
  defaultDescription = '',
  sourceDependencyId,
  onCreated,
}: CreateExternalSecretDialogProps) {
  const [name, setName] = useState(defaultName);
  const [vendor, setVendor] = useState(defaultVendor);
  const [description, setDescription] = useState(defaultDescription);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset cuando el dialog abre/cierra para no persistir valor plaintext.
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setVendor(defaultVendor);
      setDescription(defaultDescription);
      setValue('');
      setError(null);
    } else {
      // Hard reset al cerrar — evita que un valor quede en memoria del componente.
      setValue('');
    }
  }, [open, defaultName, defaultVendor, defaultDescription]);

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
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setError(message);
      toast.error('No se pudo guardar el secret', { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Guardar credencial externa
          </DialogTitle>
          <DialogDescription>
            El valor se encripta con AES-256-GCM antes de persistir. Nunca se devuelve en claro por la API —
            solo el runtime interno puede leerlo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="secret-name">Nombre (UPPER_SNAKE_CASE)</Label>
            <Input
              id="secret-name"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              placeholder="STRIPE_API_KEY"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            {!nameValid && name.length > 0 && (
              <p className="text-[10px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Debe ser UPPER_SNAKE_CASE (solo A-Z, 0-9, _; empezar con letra).
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="secret-vendor">Proveedor (opcional)</Label>
            <Input
              id="secret-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Stripe"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="secret-description">Descripción (opcional)</Label>
            <Input
              id="secret-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tokenización de pagos checkout"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="secret-value">Valor</Label>
            <Input
              id="secret-value"
              name="__no_store"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk_live_..."
              className="font-mono text-xs"
              autoComplete="new-password"
              spellCheck={false}
              // Evitar que 1Password, LastPass, Bitwarden lo detecten como
              // credencial de login y ofrezcan guardarlo en el keychain del
              // usuario — este valor ya está protegido server-side.
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
            />
            <p className="text-[10px] text-muted-foreground">
              Se encripta con `CryptoService` (AES-256-GCM + scrypt). Solo visible enmascarado en la UI.
            </p>
          </div>

          {error && (
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="gap-1.5">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Guardar secret
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
