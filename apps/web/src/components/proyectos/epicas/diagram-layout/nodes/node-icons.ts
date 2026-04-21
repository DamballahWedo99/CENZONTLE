import {
  Server,
  Database,
  Inbox,
  Route,
  Cloud,
  UserRound,
  Cog,
  Diamond,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { DiagramNodeType } from '@cenzontle/shared';

/**
 * Mapeo `DiagramNodeType → LucideIcon`. Los iconos siguen convenciones de
 * diagramas estándar (C4 Model, ArchiMate, BPMN simplificado):
 *
 * - `service` → Server: caja de servicio/API.
 * - `database` → Database: disco/storage.
 * - `queue` → Inbox: bandeja de mensajes.
 * - `gateway` → Route: enrutamiento.
 * - `external` → Cloud: sistema externo (nube = "no es nuestro").
 * - `client` → UserRound: usuario humano.
 * - `process` → Cog: engranaje (proceso genérico).
 * - `decision` → Diamond: rombo (mismo shape que el node en sí).
 * - `actor` → UserCog: usuario con rol (personal + config).
 *
 * El mismo mapa lo usa `EditToolbar.tsx` para los iconos de la palette —
 * se podría unificar en el futuro, pero vive aquí porque los custom nodes
 * lo consumen en runtime mientras que la palette lo consume para iconografía
 * estática. Ambos usos son válidos y cohesivos con lucide.
 */
// Excluimos `reference` del map porque el user no crea refs desde la
// palette — los genera `insertJumpConnectors` automáticamente cuando
// parte edges largos. El ReferenceNode tiene su propio render (círculo
// con letra) y no necesita Lucide icon.
export const NODE_TYPE_ICONS: Record<Exclude<DiagramNodeType, 'reference'>, LucideIcon> = {
  service: Server,
  database: Database,
  queue: Inbox,
  gateway: Route,
  external: Cloud,
  client: UserRound,
  process: Cog,
  decision: Diamond,
  actor: UserCog,
};
