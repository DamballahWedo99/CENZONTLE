'use client';

import { useState } from 'react';
import { Loader2, ListChecks } from 'lucide-react';
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
import { ApiError } from '@/lib/api/client';
import { enqueueEpicToForge, type EnqueueEpicResponse } from '@/lib/api/epics';

interface EpicEnqueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  epicId: string;
  epicTitle: string;
  storiesCount: number;
  totalStoryPoints: number;
  /** Callback al confirmar exitosamente — recibe el batch persistido para que el caller actualice state local. */
  onEnqueued: (result: EnqueueEpicResponse) => void;
}

/**
 * Modal de confirmación final del Protocolo de Visto Bueno: envía la épica
 * + todas sus historias al Forge ("in queue") para que un agente IA empiece
 * a procesarlas.
 *
 * Esta es la acción de no-retorno del flujo: una vez enviada, la épica
 * abandona la zona de gobernanza humana y entra al pipeline autónomo.
 * Por eso el modal:
 *  - Resume CLARAMENTE qué se va a subir (épica + N historias + total SP)
 *  - Advierte que el proceso es irreversible (los agentes consumen tokens)
 *  - Usa un CTA explícito ("Enviar al Forge") que no se confunde con un
 *    flujo más reversible.
 *
 * Por ahora la integración con el backend es un placeholder — cuando
 * implementemos el endpoint POST /factory/queue/enqueue/:epicId, el
 * `handleSubmit` lo llama y propaga el batchId resultante via `onEnqueued`.
 */
export function EpicEnqueueDialog({
  open,
  onOpenChange,
  epicId,
  epicTitle,
  storiesCount,
  totalStoryPoints,
  onEnqueued,
}: EpicEnqueueDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await enqueueEpicToForge(epicId);

      toast.success('Épica enviada al Forge', {
        description: `${result.storiesCount} historia${result.storiesCount !== 1 ? 's' : ''} en cola para procesamiento autónomo.`,
      });
      onEnqueued(result);
      onOpenChange(false);
    } catch (err: unknown) {
      // Mapeo de errores tipados del backend (ver factory-queue.service.ts):
      //  - 400: artefactos incompletos o VoBos faltantes
      //  - 403: el user no comparte pod con la épica
      //  - 404: épica no encontrada
      //  - 409: ya fue encolada antes (idempotency)
      let message = 'Intenta de nuevo en un momento.';
      if (err instanceof ApiError) {
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }
      toast.error('Error al subir la épica al Forge', { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (next: boolean) => {
    if (submitting) return; // No cerrar mientras procesa
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir épica al Forge</DialogTitle>
          <DialogDescription>
            La épica y todas sus tarjetas pasarán a la cola{' '}
            <span className="font-medium text-foreground">in queue</span> de la
            fábrica. Un agente IA comenzará a procesarlas tan pronto haya
            capacidad disponible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Resumen de lo que se va a subir */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-start gap-2.5">
              <ListChecks className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight line-clamp-2">
                  {epicTitle}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {storiesCount} historia{storiesCount !== 1 ? 's' : ''} · {totalStoryPoints} SP
                </p>
              </div>
            </div>
          </div>

        </div>

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
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>Enviar al Forge</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
