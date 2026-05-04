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
  /**
   * Override del label que aparece sobre el input. Por defecto es:
   * "Para confirmar, escribe el nombre exacto de la {resourceLabel}:".
   * Útil para bulk delete donde el expectedValue NO es un nombre individual
   * sino una palabra fija como "ELIMINAR".
   */
  confirmLabel?: React.ReactNode;
  /**
   * Contenido extra opcional renderizado entre la description y el bloque
   * del expectedValue. Útil para mostrar la lista de items afectados en
   * un bulk delete, para que el user verifique scope antes de confirmar.
   */
  extraContent?: React.ReactNode;
  /**
   * Si `true`, oculta el bloque mono con el `expectedValue` (el "cajón"
   * para copiar). Útil cuando el valor es corto (ej. "ELIMINAR") y ya
   * está resaltado dentro del `confirmLabel` — mostrarlo aparte duplica
   * info y carga el dialog visualmente. Default `false` (comportamiento
   * histórico para delete individual donde el valor es un título largo).
   */
  hideExpectedValueBlock?: boolean;
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
  confirmLabel,
  extraContent,
  hideExpectedValueBlock,
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
      <DialogContent
        className="sm:max-w-lg gap-4 p-5"
        showCloseButton={!busy}
      >
        {/* Header compacto: title con icon inline + description sutil. Sin
            el círculo grande de warning — el title ya comunica "Eliminar X"
            y el contexto destructive viene del color del botón final. */}
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-xs leading-relaxed">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {extraContent}

        <div className="space-y-1.5">
          <Label
            htmlFor="type-to-confirm"
            className="text-xs font-normal text-muted-foreground leading-relaxed"
          >
            {confirmLabel ?? <>Para confirmar, escribe el nombre exacto de la {resourceLabel}:</>}
          </Label>
          {!hideExpectedValueBlock && (
            <div className="rounded-md bg-muted/60 border border-border px-3 py-2 font-mono text-sm text-foreground select-all break-words">
              {expectedValue}
            </div>
          )}
          <Input
            id="type-to-confirm"
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="font-mono h-9"
            placeholder={hideExpectedValueBlock ? expectedValue : 'Escribe aquí...'}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelText}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={!matches || busy}
            className="gap-1.5"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
