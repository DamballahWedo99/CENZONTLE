'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Dialog de confirmación reutilizable para acciones destructivas (eliminar, desactivar,
 * rollback, etc.). Reemplaza el `window.confirm()` nativo con un modal stylado que
 * respeta el design system y bloquea navegación con un botón destructivo explícito.
 *
 * Uso típico:
 *
 * const [open, setOpen] = useState(false);
 * <ConfirmDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title='Eliminar vault "Default"'
 *   description='Esta acción no se puede deshacer. El repositorio en GitHub NO será eliminado.'
 *   confirmText="Eliminar"
 *   onConfirm={async () => { await deleteVault(id); }}
 *   destructive
 * />
 */
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /**
   * Callback async. Si lanza una excepción, el dialog permanece abierto
   * y muestra el estado "pendiente" hasta que termine (sin consumir el error —
   * el caller debe manejarlo con try/catch interno y toast).
   */
  onConfirm: () => void | Promise<void>;
  /**
   * Cambia el botón confirm al estilo destructive (rojo). Para acciones
   * irreversibles como delete.
   */
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm,
  destructive = false,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Error ya manejado por el caller (toast). El dialog se queda abierto
      // para que el usuario pueda cancelar o reintentar.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            {destructive && (
              <div className="h-9 w-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-1.5">{description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelText}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
