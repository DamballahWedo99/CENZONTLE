'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { EDGE_LABEL_HTML_STYLE, makeEdgeStyle } from '../layout-constants';
import type { EdgeWaypoints } from '../elk-layout';

// Ex-dependencia `@tisoap/react-flow-smart-edge` removida del flow: el A*
// sobre grid producía paths con efecto escalera (múltiples vertices
// alternando) que visualmente es peor que un L-shape simple. La dep sigue
// instalada en package.json por si se necesita un día; no se importa aquí.
// Ver `buildRoundedPath` para la ortogonalización de ELK waypoints cuando
// el layout ELK sí emite bends útiles.

const EDGE_STYLE_DEFAULTS = makeEdgeStyle();
// Radius = 0: esquinas estrictamente a 90°, sin curva suavizada. Requisito
// explícito del user — los trazos deben sentirse arquitectónicos (estilo
// C4 / draw.io), no orgánicos. Si en el futuro se quisieran esquinas
// suaves, subir este valor (8 da un radio discreto; >16 se ve demasiado
// curvado para un diagrama técnico).
const CORNER_RADIUS = 0;

/**
 * Shape de `data` que WaypointEdge lee. `waypoints` viene del routing
 * ortogonal calculado por ELK (`edge.sections[0]`). Reutilizamos el tipo
 * `EdgeWaypoints` exportado desde `elk-layout.ts` para mantener un solo
 * source of truth — si la shape evoluciona allí, este componente falla
 * tipo al compilar en vez de silenciar el drift.
 *
 * Si `waypoints` está ausente o `bends` está vacío, el edge cae a
 * `getSmoothStepPath` — mismo fallback que usamos en el fast-path manual
 * y para edges editados tras el layout.
 */
export interface WaypointEdgeData {
  waypoints?: EdgeWaypoints;
  onLabelDoubleClick?: (edgeId: string) => void;
  [key: string]: unknown;
}

/**
 * Edge que renderiza una polilínea ortogonal usando los bendPoints que ELK
 * calcula durante la fase `elk.edgeRouting: ORTHOGONAL`.
 *
 * Por qué no usamos `wp.start` / `wp.end` como endpoints reales:
 *   ELK produce esos puntos sobre el borde del nodo que VIO al layouter.
 *   React Flow expone `sourceX/sourceY` (handle renderizado real) que puede
 *   haber drifteado si el user arrastró el nodo sin re-ejecutar ELK. Usar
 *   los handles de RF como endpoints y los `bends` de ELK como vértices
 *   intermedios mantiene el trazo estable bajo drag sin perder la
 *   navegación por bends que evita cruces.
 *
 * Cuando `bends` está vacío (edge recto directo entre capas adyacentes),
 * delegamos al `getSmoothStepPath` nativo de React Flow — así respetamos
 * la estética step del resto del diagrama sin introducir una línea
 * diagonal de más.
 */
export function WaypointEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    style,
    markerEnd,
    label,
    labelStyle,
    data,
  } = props;

  const edgeData = data as WaypointEdgeData | undefined;
  const hasDblClick = typeof edgeData?.onLabelDoubleClick === 'function';
  const wp = edgeData?.waypoints;

  // Inicializamos todas las variables con el smoothstep default —
  // garantía de que `edgePath/labelX/labelY` siempre quedan definidos
  // antes del render aunque no haya waypoints ni obstáculos (útil para
  // el control flow analysis de TypeScript).
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: CORNER_RADIUS,
  });
  let edgePath: string = smoothPath;
  let labelX: number = smoothLabelX;
  let labelY: number = smoothLabelY;

  // Tras introducir `ports` en el grafo ELK (ver elk-layout.ts), los
  // `wp.start/end` de ELK corresponden a las coords del puerto (borde
  // del nodo), mientras que `sourceX/sourceY` de React Flow vienen del
  // handle visual. Estas dos coords siempre difieren por más de 1 px —
  // la antigua detección `sourceMoved/targetMoved` se disparaba falsamente
  // y hacía que NINGÚN edge usara bends de ELK, forzando todo a smoothstep.
  //
  // Eliminamos esa detección: siempre usamos los bends de ELK si existen.
  // Trade-off: si el user arrastra un nodo, los bends quedan anclados a
  // las coords ELK originales (no siguen al drag). Solución: recalcular
  // layout tras drag (ya hay `resolveCollisions` post-drag) o usar
  // "Recalcular layout" desde la UI.
  if (wp && wp.bends.length > 0) {
    // Ortogonalizamos la secuencia de puntos: si dos vértices consecutivos
    // NO están alineados horizontal ni verticalmente, insertamos un corner
    // intermedio para que cada segmento sea estrictamente 90°. Sin esto,
    // los bends que ELK devuelve desalineados respecto a source/target
    // producen tramos L diagonales (observado en layouts con decision
    // nodes — ELK puede emitir bends alineados entre sí pero no con el
    // endpoint del nodo que conecta).
    const rawPoints = [
      { x: sourceX, y: sourceY },
      ...wp.bends,
      { x: targetX, y: targetY },
    ];
    const points = orthogonalizePoints(rawPoints);
    edgePath = buildRoundedPath(points, CORNER_RADIUS);
    const midIdx = Math.floor(points.length / 2);
    labelX = points[midIdx].x;
    labelY = points[midIdx].y;
  }
  // Cuando ELK no devolvió bends útiles, queda el `smoothstep` nativo de
  // React Flow (calculado arriba con `borderRadius: 0`). Produce un
  // path L-shape simple: source → 1 corner → target — limpio y legible.
  //
  // Anteriormente había un fallback al A* de `@tisoap/react-flow-smart-edge`
  // que rodeaba nodos intermedios. Lo removimos porque el A* sobre grid
  // devuelve muchos vertices (cada celda del grid cruzada), generando un
  // path con efecto **escalera** — múltiples segmentos ortogonales
  // alternando horizontal/vertical — que visualmente es peor que un
  // edge L-shape simple aunque este último cruce un nodo.
  //
  // Tradeoff aceptado: ciertos edges pueden cruzar visualmente nodos
  // intermedios si ELK no emitió bends para ellos. El user puede mover
  // los nodos en modo edición si le molesta.

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`absolute ${
              hasDblClick
                ? 'pointer-events-auto nodrag nopan cursor-text'
                : 'pointer-events-none'
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              ...EDGE_LABEL_HTML_STYLE,
            }}
            onDoubleClick={
              hasDblClick
                ? (e) => {
                    e.stopPropagation();
                    edgeData?.onLabelDoubleClick?.(id);
                  }
                : undefined
            }
          >
            <span
              style={{
                ...EDGE_STYLE_DEFAULTS.labelStyle,
                ...(labelStyle as React.CSSProperties | undefined),
              }}
            >
              {label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Construye un path SVG con esquinas redondeadas desde una secuencia de
 * puntos. Para cada vértice interior, reemplaza la esquina dura (L…L) con
 * un arco cuadrático: entra al arco `radius` px antes del vértice y sale
 * `radius` px después, usando el vértice como punto de control de la Q.
 *
 * El radio real se clampa a la mitad del segmento más corto adyacente para
 * que dos bends muy próximos no generen arcos que se traslapan.
 *
 * Exportado únicamente para tests unitarios — no se usa fuera de este
 * archivo en tiempo de runtime.
 */
export function buildRoundedPath(
  points: Array<{ x: number; y: number }>,
  radius: number,
): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const distPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const distNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, distPrev / 2, distNext / 2);

    if (r === 0) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const enterX = curr.x - (r * (curr.x - prev.x)) / distPrev;
    const enterY = curr.y - (r * (curr.y - prev.y)) / distPrev;
    const exitX = curr.x + (r * (next.x - curr.x)) / distNext;
    const exitY = curr.y + (r * (next.y - curr.y)) / distNext;

    d += ` L ${enterX} ${enterY} Q ${curr.x} ${curr.y} ${exitX} ${exitY}`;
  }

  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}

/**
 * Garantiza ortogonalidad (90°) entre cada par de puntos consecutivos.
 *
 * Recibe una secuencia de puntos (source, …bends, target). Si dos puntos
 * consecutivos NO están alineados horizontal ni verticalmente (es decir,
 * difieren tanto en X como en Y más de un epsilon de 0.5 px para
 * tolerancia de jitter fractional), inserta un corner intermedio. El
 * corner elige el eje dominante (el delta más grande) como primer tramo
 * para minimizar el detour visual.
 *
 * Exportado para tests. Invariante: el path resultante puede trazarse
 * conectando puntos consecutivos con `L` sin producir diagonales.
 *
 * Contexto: ELK con `elk.edgeRouting: ORTHOGONAL` debería emitir bends
 * alineados entre sí, pero los endpoints (source/target) de React Flow
 * vienen de los handles de los nodos, que pueden no coincidir exactamente
 * con donde ELK "vio" el edge salir/entrar — especialmente con
 * DecisionNode cuyos handles están en las esquinas del rombo. Esta
 * función es la garantía defensiva de 90° en el renderer.
 */
export function orthogonalizePoints(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points;
  const EPS = 0.5;
  const result: Array<{ x: number; y: number }> = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const dx = Math.abs(curr.x - prev.x);
    const dy = Math.abs(curr.y - prev.y);
    const aligned = dx < EPS || dy < EPS;
    if (!aligned) {
      // Insertar corner. Elegimos el eje dominante como primer tramo:
      // si dx > dy, avanzamos primero horizontal (corner en { x: curr.x, y: prev.y }).
      // Si dy >= dx, primero vertical (corner en { x: prev.x, y: curr.y }).
      if (dx >= dy) {
        result.push({ x: curr.x, y: prev.y });
      } else {
        result.push({ x: prev.x, y: curr.y });
      }
    }
    result.push(curr);
  }
  return result;
}
