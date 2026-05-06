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
import { approveEpic, type ApprovalRole } from '@/lib/api/epics';

interface EpicApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  epicId: string;
  role: ApprovalRole;
  roleLabel: string;
  /** Callback con el approval persistido para que el caller actualice state local. */
  onApproved: (result: {
    role: ApprovalRole;
    approvedBy: string;
    approvedByName: string;
    approvedAt: string;
    comment: string | null;
  }) => void;
}

/**
 * Modal de step-up authentication para dar el Visto Bueno (VoBo) a una
 * épica. El usuario debe re-ingresar su contraseña — el backend la valida
 * contra Auth0 (Resource Owner Password Grant) antes de persistir el
 * approval.
 *
 * El comentario es opcional pero se incluye en el ChangelogEntry para
 * trazabilidad. Tipo de aprobador (PO/TL/QA) viene del prop `role` y debe
 * coincidir con el rol del usuario autenticado — el backend valida el
 * match estricto y retorna 403 si no coincide.
 *
 * Estados de loading y error son visibles en el botón principal — sin
 * spinners separados para mantener el modal compacto.
 */
export function EpicApprovalDialog({
  open,
  onOpenChange,
  epicId,
  role,
  roleLabel,
  onApproved,
}: EpicApprovalDialogProps) {
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
      const result = await approveEpic(epicId, role, { password });

      // El comment lo dejamos siempre null — la UI ya no expone el campo.
      // El DTO del backend acepta `comment?: string` opcional, así que
      // omitirlo en el body es seguro (no rompe contratos existentes).
      onApproved({
        role,
        approvedBy: result.approvedBy,
        approvedByName: result.approvedByName,
        approvedAt: result.approvedAt,
        comment: result.comment,
      });

      toast.success(`VoBo de ${roleLabel} registrado`, {
        description: 'La aprobación quedó persistida en el changelog.',
      });

      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      // Mapeo de errores tipados del backend a mensajes legibles. Mantener
      // sincronizado con apps/api/src/modules/proyectos/epics/epics.service.ts
      // (método `approve`).
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Contraseña incorrecta. Vuelve a intentarlo.');
        } else if (err.status === 403) {
          setError(
            `Tu rol no coincide con el VoBo de ${roleLabel}. Sólo un usuario con ese rol puede aprobar.`,
          );
        } else if (err.status === 400) {
          setError(err.message);
        } else if (err.status === 409) {
          setError('Esta épica ya tiene este VoBo aprobado.');
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
            Visto Bueno — {roleLabel}
          </DialogTitle>
          <DialogDescription>
            Confirma tu identidad con tu contraseña para registrar tu VoBo
            sobre esta épica. Tu aprobación queda en el changelog con tu
            nombre y fecha.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="vobo-password">Contraseña</Label>
            <div className="relative">
              <Input
                id="vobo-password"
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
                  Verificando...
                </>
              ) : (
                <>Dar VoBo</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
