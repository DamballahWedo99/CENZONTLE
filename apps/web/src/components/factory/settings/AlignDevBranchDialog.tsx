'use client';

import { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
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
  alignDevBranch,
  type AlignDevBranchResponse,
} from '@/lib/api/factory';

interface AlignDevBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devBranch: string;
  mainBranch: string;
  /** Callback con el resultado del align para que el caller revalide el state
   *  inmediatamente — sin esperar al próximo refresh manual. */
  onAligned: (result: AlignDevBranchResponse) => void;
}

/**
 * Modal de step-up auth para alinear la branch `dev` con `main`.
 *
 * La operación es DESTRUCTIVA: hace force-update de `dev` para que apunte
 * al HEAD actual de `main`, descartando cualquier historia única de `dev`.
 * Caso de uso típico: tras setup inicial donde `dev` fue creada como branch
 * huérfana (`git checkout --orphan dev`), evitando que el consolidated PR
 * del Forge pueda mergearse por "No common ancestor".
 *
 * Solo TechLead o AltaGerencia puede ejecutar — el role check + step-up
 * (password contra Auth0) son enforced en el backend.
 */
export function AlignDevBranchDialog({
  open,
  onOpenChange,
  devBranch,
  mainBranch,
  onAligned,
}: AlignDevBranchDialogProps) {
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
      const result = await alignDevBranch({ password });
      onAligned(result);
      toast.success('Branch dev alineada con main', {
        description: `"${result.devBranch}" ahora apunta a ${result.newDevSha.slice(0, 7)} (= HEAD de "${result.mainBranch}").`,
      });
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      // Mapeo de errores tipados del backend a mensajes legibles.
      // Sincronizado con apps/api/src/modules/factory/branch-strategy/
      //   branch-strategy.service.ts (método `alignDevWithMain`).
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Contraseña incorrecta. Vuelve a intentarlo.');
        } else if (err.status === 403) {
          setError(
            'Solo Tech Lead o Alta Gerencia pueden alinear la branch dev. Tu rol actual no tiene este permiso.',
          );
        } else if (err.status === 404) {
          setError(err.message);
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
            <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            Alinear <span className="font-mono">{devBranch}</span> con{' '}
            <span className="font-mono">{mainBranch}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Acción destructiva: hace force-update de{' '}
            <code className="font-mono text-foreground/90">{devBranch}</code> para
            que apunte al HEAD actual de{' '}
            <code className="font-mono text-foreground/90">{mainBranch}</code>.
            Cualquier historia única de{' '}
            <code className="font-mono text-foreground/90">{devBranch}</code> se
            descarta (recuperable solo via reflog del lado del operador).
            Confirma tu identidad con tu contraseña — solo Tech Lead o Alta
            Gerencia puede ejecutar esto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <p className="font-medium">¿Cuándo usar este botón?</p>
            <p className="mt-1 text-amber-200/80">
              Cuando el banner de validación muestra "No common ancestor" entre
              dev y main — típicamente tras setup inicial donde dev fue creada
              como branch huérfana. Sin alineamiento, el consolidated PR del
              Forge fallará al mergear.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="align-dev-password">Contraseña</Label>
            <div className="relative">
              <Input
                id="align-dev-password"
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
            <Button
              type="submit"
              variant="destructive"
              disabled={!password || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Alineando...
                </>
              ) : (
                <>Alinear branch</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
