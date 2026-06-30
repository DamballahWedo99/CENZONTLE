'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2, Rocket } from 'lucide-react';
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
import { approveReleaseGate, type ReleaseGateApprovalResponse } from '@/lib/api/factory';

interface ReleaseGateApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  onApproved: (result: ReleaseGateApprovalResponse) => void;
}

/**
 * Modal de step-up auth para aprobar el release gate (rollout) de un batch.
 * Clon del StagingGateApprovalDialog: el usuario re-ingresa su contraseña
 * (Auth0) y debe ser TechLead/AltaGerencia. Effect: marca releaseApprovedAt →
 * el batch pasa a RELEASED.
 */
export function ReleaseGateApprovalDialog({
  open,
  onOpenChange,
  batchId,
  onApproved,
}: ReleaseGateApprovalDialogProps) {
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
    if (submitting) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await approveReleaseGate(batchId, { password });
      onApproved(result);
      toast.success('Batch liberado', {
        description: `Aprobado por ${result.approvedByName}. El batch pasó a Released.`,
      });
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError('Contraseña incorrecta. Vuelve a intentarlo.');
        else if (err.status === 403)
          setError('Solo Tech Lead o Alta Gerencia puede aprobar el release gate.');
        else if (err.status === 400) setError(err.message);
        else if (err.status === 409) setError('Este batch ya fue liberado.');
        else setError(err.message);
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
            <Rocket className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            Aprobar rollout
          </DialogTitle>
          <DialogDescription>
            Confirma tu identidad para aprobar el rollout de este batch tras
            revisar el QAReport. Solo Tech Lead o Alta Gerencia puede aprobar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="release-gate-password">Contraseña</Label>
            <div className="relative">
              <Input
                id="release-gate-password"
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
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => handleClose(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!password || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Aprobando...
                </>
              ) : (
                <>Aprobar rollout</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
