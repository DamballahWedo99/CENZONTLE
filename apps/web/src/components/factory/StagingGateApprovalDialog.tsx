'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import {
  approveStagingGate,
  type ApproveStagingGateResponse,
} from '@/lib/api/factory';

interface StagingGateApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  /** Notas opcionales del review — pre-populated del textarea del PendingGateCard. */
  initialNotes?: string;
  /** Callback con el resultado del approval para que el caller actualice
   *  state local (mover batch a Staged) y muestre la confirmación. */
  onApproved: (result: ApproveStagingGateResponse) => void;
}

/**
 * Modal de step-up auth para aprobar el staging gate de un batch del Forge.
 * El usuario debe re-ingresar su contraseña (validada contra Auth0) y debe
 * tener rol `TechLead` (o `AltaGerencia` como admin override).
 *
 * Diferente del EpicApprovalDialog (proyectos):
 *  - Backend endpoint: `POST /factory/queue/:batchId/approve-staging`
 *  - Rol estricto: solo TechLead (no PO ni QA — esos roles aprueban en epics)
 *  - Effect: mergea consolidated PR a DEV + mueve el batch a Staged
 *  - Persiste epic.stagingApprovedAt para que el currentLayer derive a Staging
 *
 * Estados de loading y error son visibles en el botón principal — sin
 * spinners separados para mantener el modal compacto.
 */
export function StagingGateApprovalDialog({
  open,
  onOpenChange,
  batchId,
  initialNotes,
  onApproved,
}: StagingGateApprovalDialogProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPassword('');
    setShowPassword(false);
    setError(null);
  };

  const handleClose = (next: boolean) => {
    if (submitting) return; // No cerrar mientras se procesa
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await approveStagingGate(batchId, {
        password,
        notes: initialNotes,
      });

      onApproved(result);

      toast.success('Staging gate aprobado', {
        description: result.consolidatedPrMergedAt
          ? `PR #${result.consolidatedPrNumber} mergeado a DEV.`
          : result.consolidatedPrNumber
            ? `PR #${result.consolidatedPrNumber} pendiente de merge — revisa GitHub.`
            : 'Approval registrado. El merge a DEV debe hacerse manualmente (branch en mock mode o sin pushes reales).',
      });

      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      // Mapeo de errores tipados del backend a mensajes legibles. Mantener
      // sincronizado con apps/api/src/modules/factory/queue/factory-queue.service.ts
      // (método `approveStagingGate`).
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Contraseña incorrecta. Vuelve a intentarlo.');
        } else if (err.status === 403) {
          setError(
            'Solo Tech Lead puede aprobar el merge a DEV. Tu rol actual no tiene este permiso.',
          );
        } else if (err.status === 400) {
          setError(err.message);
        } else if (err.status === 409) {
          setError(
            'Este batch ya fue aprobado y mergeado a DEV. No hay nada que reintentar.',
          );
        } else if (err.status === 503) {
          setError(
            'La verificación de contraseña no está disponible. Contacta a un administrador.',
          );
        } else {
          setError(err.message);
        }
      } else {
        setError('Error desconocido. Vuelve a intentarlo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
            Approve & Merge to DEV
          </DialogTitle>
          <DialogDescription>
            Confirma tu identidad con tu contraseña para aprobar el merge del
            consolidated PR a DEV. Solo Tech Lead puede aprobar este gate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="staging-gate-password">Contraseña</Label>
            <div className="relative">
              <Input
                id="staging-gate-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={submitting}
                autoFocus
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={submitting}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleClose(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!password || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Aprobando...
                </>
              ) : (
                <>Approve &amp; Merge</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
