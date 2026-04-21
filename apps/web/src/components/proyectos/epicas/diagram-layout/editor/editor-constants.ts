import type { DiagramNodeType } from '@cenzontle/shared';

/**
 * Catálogo de los 9 tipos de node soportados por el editor, con metadatos
 * de UI (label, description). Vive como constante module-level en vez de
 * dentro del hook `useDiagramEditor` (Arch M1 del review): la state machine
 * no debería ser fuente de constantes de UI. Los consumidores son:
 *
 *   - `EditToolbar.tsx` — renderiza los 9 tools con icono + tooltip.
 *   - `PropertyPanel.tsx` — popula el Select de "Tipo" al editar un node.
 *   - `useDropNode.ts` — deriva la whitelist `VALID_NODE_TYPE_SET` para
 *     validar el drag MIME antes de colocar un node.
 *
 * Añadir un tipo nuevo aquí lo hace disponible automáticamente en los 3
 * consumidores — single source of truth para el catálogo.
 */
// `reference` NO es creable desde la palette — los refs se generan
// automáticamente por `insertJumpConnectors` al partir edges largos. El
// type del array excluye `reference` explícitamente para que los
// consumidores (EditToolbar, dropHandlers) sepan que el array no los
// contiene.
export const TOOL_DEFINITIONS: Array<{
  type: Exclude<DiagramNodeType, 'reference'>;
  label: string;
  description: string;
}> = [
  { type: 'service', label: 'Servicio', description: 'Microservicio, API, worker' },
  { type: 'database', label: 'Base de datos', description: 'PostgreSQL, Redis, cache' },
  { type: 'queue', label: 'Cola', description: 'Kafka, RabbitMQ, SQS' },
  { type: 'gateway', label: 'Gateway', description: 'API Gateway, proxy, CDN' },
  { type: 'external', label: 'Externo', description: 'Terceros (Stripe, Sabre)' },
  { type: 'client', label: 'Cliente', description: 'Usuario final, UI' },
  { type: 'process', label: 'Proceso', description: 'Paso genérico, transformación' },
  { type: 'decision', label: 'Decisión', description: 'Rombo de decisión' },
  { type: 'actor', label: 'Actor', description: 'Rol interno (analista, SRE)' },
];
