import { apiFetch } from './client';

/**
 * Shape de un item de la cola del Forge devuelto por `GET /factory/queue`.
 * Coincide con `EnqueuedBatch` del backend (`factory-queue.service.ts`).
 *
 * Distinto del tipo `QueuedBatch` shared — este es el contrato HTTP raw,
 * el frontend mapea a `QueuedBatch` para renderizar en el dashboard.
 */
export interface ForgeQueueItem {
  batchId: string;
  epicId: string;
  epicTitle: string;
  storiesCount: number;
  totalStoryPoints: number;
  enqueuedAt: string;
  enqueuedBy: string;
  enqueuedByName: string;
}

/**
 * Lista las épicas actualmente "in queue" del Forge. Backend filtra por
 * pod intersection automáticamente (no-AltaGerencia ven solo sus pods).
 *
 * Orden: FIFO — las más antiguas primero (las que se procesarán antes).
 *
 * Llamado por `FactoryProvider` al montar para hidratar `state.factory.
 * queuedBatches`. No tiene polling — para refresh continuo, llamar manualmente
 * desde un timer o WebSocket cuando el orquestador real (Mes 1) emita eventos.
 */
export function getForgeQueue() {
  return apiFetch<ForgeQueueItem[]>('/factory/queue');
}
