'use client';

import { Handle, Position } from '@xyflow/react';

/**
 * Renderiza **8 handles bidireccionales** (4 lados × 2 tipos), más el
 * `left-out` opcional del DecisionNode. Cada lado tiene un handle
 * `target` y uno `source` en posiciones separadas (35% y 65% del lado)
 * — se ven como dos puntos pequeños distintos, uno para recibir
 * conexiones y otro para emitirlas.
 *
 * Por qué **separados y no superpuestos**: si los ponemos en exactamente
 * la misma Position, el último en el DOM tiene z-index mayor y captura
 * todos los clicks — el otro queda inaccesible, y cuando el user
 * intenta usar el "tapado" React Flow no encuentra el handle correcto
 * y emite el error #008 ("Couldn't create edge for source handle id").
 * Separándolos con `left: 35%` / `left: 65%` cada uno tiene su propia
 * zona clickable sin conflicto.
 *
 * Naming convention (preserva backward-compat con edges persistidos):
 *   - `top`, `right`, `bottom`, `left` = IDs HISTÓRICOS que el LLM
 *     y ELK siguen usando (top/left=target, bottom/right=source).
 *     Edges en Redis cache con estos IDs siguen resolviendo bien.
 *   - `top-source`, `right-target`, `bottom-target`, `left-source` =
 *     handles nuevos que cubren el rol inverso. Se usan cuando el user
 *     arrastra una conexión en dirección "contraria" al flow canónico.
 *   - `left-out` = legacy source para rama REJECT del DecisionNode
 *     (posición 75% del lado izquierdo).
 */
export function MultiSideHandles({
  style,
  className,
  includeLeftOut = false,
}: {
  style?: React.CSSProperties;
  className?: string;
  includeLeftOut?: boolean;
}) {
  return (
    <>
      {/* ─── Position.Top ─── target + source superpuestos en centro ─── */}
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        style={style}
        className={className}
      />
      <Handle
        id="top-source"
        type="source"
        position={Position.Top}
        style={style}
        className={className}
      />

      {/* ─── Position.Left ─── */}
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        style={style}
        className={className}
      />
      {!includeLeftOut && (
        <Handle
          id="left-source"
          type="source"
          position={Position.Left}
          style={style}
          className={className}
        />
      )}

      {/* ─── Position.Bottom ─── */}
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        style={style}
        className={className}
      />
      <Handle
        id="bottom-target"
        type="target"
        position={Position.Bottom}
        style={style}
        className={className}
      />

      {/* ─── Position.Right ─── */}
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        style={style}
        className={className}
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        style={style}
        className={className}
      />

      {/* ─── DecisionNode REJECT branch (legacy) ─── */}
      {includeLeftOut ? (
        <Handle
          id="left-out"
          type="source"
          position={Position.Left}
          style={{ ...style, top: '75%' }}
          className={className}
        />
      ) : null}
    </>
  );
}
