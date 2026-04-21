import { ServiceNode } from './ServiceNode';
import { DecisionNode } from './DecisionNode';
import { ActorNode } from './ActorNode';
import { DatabaseNode } from './DatabaseNode';
import { StateNode } from './StateNode';
import { ReferenceNode } from './ReferenceNode';

export { ServiceNode, DecisionNode, ActorNode, DatabaseNode, StateNode, ReferenceNode };

/**
 * Mapeo listo para registrar como `nodeTypes` en `<ReactFlow>`.
 * Las claves coinciden con las usadas en `nodeTypeToShape` de layout-constants,
 * salvo `reference` que es un node type SINTÉTICO generado post-layout por
 * `insertJumpConnectors` — nunca proviene del backend ni del agente.
 */
export const nodeTypes = {
  serviceNode: ServiceNode,
  decisionNode: DecisionNode,
  actorNode: ActorNode,
  databaseNode: DatabaseNode,
  stateNode: StateNode,
  reference: ReferenceNode,
} as const;
