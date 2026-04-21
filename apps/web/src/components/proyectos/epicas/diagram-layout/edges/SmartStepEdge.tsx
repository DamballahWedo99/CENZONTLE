'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useNodes,
  type EdgeProps,
} from '@xyflow/react';
import { getSmartEdge } from '@tisoap/react-flow-smart-edge';
import { EDGE_LABEL_HTML_STYLE, makeEdgeStyle } from '../layout-constants';

// Evaluado una sola vez a nivel módulo — el shape default del texto es global
// y estable. Se combina con el prop `labelStyle` si el consumidor lo pasa
// explícitamente, para permitir overrides per-edge del color del texto.
const EDGE_STYLE_DEFAULTS = makeEdgeStyle();

/**
 * Shape del `data` que SmartStepEdge lee. React Flow v12 pasa `data` a
 * custom edges como prop tipada genéricamente; hacemos cast local al shape
 * conocido. Mantener en sync con lo que el `useDiagramEditor` inyecta al
 * construir edges.
 */
export interface SmartStepEdgeData {
  /**
   * Handler disparado por double-click sobre el PILL HTML del label. React
   * Flow v12 emite `onEdgeDoubleClick` a nivel `<ReactFlow>` para hits sobre
   * el PATH SVG, pero el label vive en un `<div>` overlay vía
   * `EdgeLabelRenderer` — los hits allí no propagan al path.
   *
   * El integrador inyecta este callback via `edge.data.onLabelDoubleClick`
   * para abrir el `EdgeLabelEditor` inline.
   */
  onLabelDoubleClick?: (edgeId: string) => void;
  [key: string]: unknown;
}

/**
 * Edge con routing A* sobre grid que EVITA atravesar otros nodos.
 *
 * Basado en `getSmartEdge` de `@tisoap/react-flow-smart-edge` v4 (la v4 ya no
 * exporta un componente listo — solo el helper). Este wrapper:
 *   1. Lee los nodos actuales del store via `useNodes()`.
 *   2. Llama a `getSmartEdge` para obtener un path SVG que rodea nodos.
 *   3. Si falla (grid demasiado grande, nodos no colocados, etc.) cae a
 *      `getSmoothStepPath` — comportamiento determinista sin crashes.
 *   4. Renderiza `BaseEdge` con el path y la etiqueta centrada.
 *   5. Si `data.onLabelDoubleClick` está presente, el label HTML dispara
 *      ese callback al double-click (con `stopPropagation` para no disparar
 *      el handler de node nearby).
 */
export function SmartStepEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    label,
    labelStyle,
    data,
  } = props;

  const nodes = useNodes();
  const edgeData = data as SmartStepEdgeData | undefined;
  const hasDblClick = typeof edgeData?.onLabelDoubleClick === 'function';

  // Fallback path — siempre calculable, sirve como default si el A* falla.
  const [fallbackPath, fallbackLabelX, fallbackLabelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 10,
  });

  let edgePath = fallbackPath;
  let labelX = fallbackLabelX;
  let labelY = fallbackLabelY;

  // Only intentar A* si hay nodos válidos distintos a source/target. El paquete
  // puede throw (no solo devolver Error) si el grafo está vacío, hay NaN en
  // posiciones, o el grid es inválido. Lo envolvemos en try/catch defensivo.
  const obstacles = nodes.filter(
    (n) =>
      n.id !== source &&
      n.id !== target &&
      typeof n.position?.x === 'number' &&
      typeof n.position?.y === 'number' &&
      Number.isFinite(n.position.x) &&
      Number.isFinite(n.position.y),
  );

  if (obstacles.length > 0 && Number.isFinite(sourceX) && Number.isFinite(targetX)) {
    try {
      const smartResult = getSmartEdge({
        sourcePosition,
        targetPosition,
        sourceX,
        sourceY,
        targetX,
        targetY,
        nodes: obstacles,
        options: { gridRatio: 16, nodePadding: 14 },
      });
      if (smartResult && !(smartResult instanceof Error)) {
        edgePath = smartResult.svgPathString;
        labelX = smartResult.edgeCenterX;
        labelY = smartResult.edgeCenterY;
      }
    } catch {
      // Silencioso — ya tenemos fallback. No spammeamos consola.
    }
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          {/*
            NOTA DE DISEÑO: el prop `labelBgStyle` del edge (shape SVG) se
            ignora intencionalmente aquí — `EdgeLabelRenderer` renderiza HTML
            y los atributos SVG (`fill`, `rx`, `ry`) no son CSS válido. El
            estilo del pill de fondo viene SIEMPRE de `EDGE_LABEL_HTML_STYLE`
            para mantener apariencia consistente entre todos los SmartStepEdge.
            Si algún día se requiere override per-edge, expónlo vía `data.*` y
            agrega el merge aquí.

            pointer-events: cuando hay double-click handler, el div DEBE ser
            interactivo para capturar el evento — xyflow envuelve el
            `EdgeLabelRenderer` en un contenedor `pointer-events: none` por
            default, así que usamos `pointer-events-auto` + `nodrag nopan`
            para permitir el click sin activar el pan del viewport.
          */}
          <div
            className={`absolute ${
              hasDblClick ? 'pointer-events-auto nodrag nopan cursor-text' : 'pointer-events-none'
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
