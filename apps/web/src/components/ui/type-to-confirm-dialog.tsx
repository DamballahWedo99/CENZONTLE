'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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

/**
 * Dialog de confirmación "type-to-confirm" para operaciones destructivas
 * irreversibles (delete de entidades, borrado de cuentas, etc.).
 *
 * El usuario debe escribir el nombre EXACTO del recurso para habilitar
 * el botón destructivo. El match es case-sensitive con trim, igual que GitHub.
 *
 * Este patrón obliga a una pausa consciente que el usuario no obtiene con
 * un simple "¿estás seguro?" — la fricción es proporcional al riesgo.
 *
 * Uso típico:
 *
 * <TypeToConfirmDialog
 *   open={deleteOpen}
 *   onOpenChange={setDeleteOpen}
 *   title="Eliminar iniciativa"
 *   resourceLabel="iniciativa"
 *   expectedValue={initiative.name}
 *   description="Esto eliminará la iniciativa y todas sus épicas, historias y documentos asociados. Esta acción NO se puede deshacer."
 *   confirmText="Eliminar iniciativa"
 *   onConfirm={async () => { await deleteInitiative(id); router.push('/proyectos'); }}
 * />
 */
interface TypeToConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Nombre legible del tipo de recurso, ej "iniciativa", "épica", "historia". */
  resourceLabel: string;
  /** El valor exacto que el usuario debe escribir para confirmar. */
  expectedValue: string;
  confirmText?: string;
  cancelText?: string;
  /**
   * Callback async. Si lanza, el dialog permanece abierto
   * (el caller debe manejar el error con try/catch + toast).
   */
  onConfirm: () => void | Promise<void>;
}

export function TypeToConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  resourceLabel,
  expectedValue,
  confirmText = 'Eliminar',
  cancelText = 'Cancelar',
  onConfirm,
}: TypeToConfirmDialogProps) {
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state cuando el dialog se cierra (para que no persista entre aperturas)
  React.useEffect(() => {
    if (!open) {
      setTyped('');
      setBusy(false);
    } else {
      // Pequeño delay para que el autofocus ocurra después de la animación de apertura
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const matches = typed.trim() === expectedValue.trim();

  const handleConfirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller manejó el error con toast; dejamos el dialog abierto
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && matches && !busy) {
      e.preventDefault();
      void handleConfirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-1.5">{description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2.5 pt-2">
          <Label htmlFor="type-to-confirm" className="text-xs font-normal text-muted-foreground leading-relaxed">
            Para confirmar, escribe el nombre exacto de la {resourceLabel}:
          </Label>
          <div className="rounded-md bg-muted/60 border border-border px-3 py-2 font-mono text-sm text-foreground select-all break-words">
            {expectedValue}
          </div>
          <Input
            id="type-to-confirm"
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder="Escribe aquí..."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!matches || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
