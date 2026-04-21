'use client';

import { useState } from 'react';
import type { DiagramNodeType, DiagramNodeGroup } from '@cenzontle/shared';
import { handleStyle, handleStyleEditing } from '../layout-constants';
import { NODE_TYPE_ICONS } from './node-icons';
import { getGroupBackground } from './node-colors';
import { normalizeNodeLabel } from './node-label';
import { MultiSideHandles } from './node-handles';

interface ServiceNodeData {
  label: string;
  description?: string;
  nodeType: DiagramNodeType;
  group?: DiagramNodeGroup;
  editing?: boolean;
}

/**
 * Clip-path para el hexágono del Gateway. Usa porcentajes para escalar
 * con cualquier tamaño del node. Los vértices izquierdo/derecho están a
 * 0%/100% horizontal y 50% vertical — los handles left/right caen ahí
 * exactamente, así siguen siendo visibles en el shape.
 */
const HEXAGON_CLIP = 'polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)';

/**
 * Devuelve la configuración visual específica del shape según el type.
 * Mantenemos el bounding box rectangular (el padre del Handle sigue siendo
 * rectangular) pero el visual interior se distingue con clip-path / border
 * / radius.
 */
function getShapeConfig(
  nodeType: DiagramNodeType,
  isFilled: boolean,
): { className: string; style: React.CSSProperties } {
  const base = 'flex flex-col items-center justify-center text-center px-4 py-3 min-w-[120px] max-w-[160px] border transition-shadow';

  if (!isFilled) {
    // External: rect dashed, el único "no filled" — convención C4.
    // Título configurable via CSS var `--diagram-title-color`; fallback al
    // blanco canónico si la var no está presente (ej: renderizado fuera
    // del viewer, en snapshots de tests).
    return {
      className: `${base} rounded-lg border-zinc-500 border-dashed text-[color:var(--diagram-title-color,#ffffff)]`,
      style: {},
    };
  }

  const colorCls = 'border-zinc-600 text-[color:var(--diagram-title-color,#ffffff)]';

  switch (nodeType) {
    case 'process':
      // Pill muy redondeado — convención flowchart para "paso de proceso".
      return {
        className: `${base} ${colorCls} rounded-[28px]`,
        style: {},
      };
    case 'gateway':
      // Hexágono via clip-path (industry standard: Kong, Gateway API, etc.).
      // Borde se aplica con outline interno porque clip-path corta borders.
      return {
        className: `${base} ${colorCls} rounded-none`,
        style: { clipPath: HEXAGON_CLIP, paddingLeft: '1.5rem', paddingRight: '1.5rem' },
      };
    case 'queue':
      // Rect con borde izquierdo grueso — simboliza "pipe" de entrada del
      // message queue. El borde del lado se siente como un buffer entrante.
      return {
        className: `${base} ${colorCls} rounded-lg border-l-4 border-l-primary/70`,
        style: {},
      };
    case 'service':
    default:
      // Default: rect rounded-lg (C4 Container).
      return {
        className: `${base} ${colorCls} rounded-lg`,
        style: {},
      };
  }
}

export function ServiceNode({ data, selected }: { data: ServiceNodeData; selected?: boolean }) {
  const isFilled = ['service', 'process', 'gateway', 'queue'].includes(data.nodeType);
  const hs = data.editing ? handleStyleEditing : handleStyle;
  const [hover, setHover] = useState(false);
  const pulseCls = data.editing && hover ? 'animate-pulse ring-2 ring-primary/40' : '';
  // `nodeType` nunca es 'reference' aquí: `nodeTypeToShape.reference` mapea
  // a `ReferenceNode` (otro componente), así que React Flow jamás instancia
  // ServiceNode con type='reference'. Cast para satisfacer el tipo estricto
  // de `NODE_TYPE_ICONS`.
  const nodeTypeNonRef = data.nodeType as Exclude<DiagramNodeType, 'reference'>;
  const Icon = NODE_TYPE_ICONS[nodeTypeNonRef];
  const shape = getShapeConfig(data.nodeType, isFilled);
  const selectionRing = selected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : '';

  return (
    <div
      className="contents"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MultiSideHandles style={hs} className={pulseCls} />
      <div
        className={`${shape.className} ${selectionRing}`}
        style={{
          ...shape.style,
          backgroundColor: isFilled
            ? getGroupBackground(data.group)
            : `color-mix(in srgb, ${getGroupBackground(data.group)} 60%, transparent)`,
        }}
      >
        {Icon && <Icon className="h-3.5 w-3.5 mb-1 opacity-80" />}
        <span className="text-[11px] font-semibold leading-tight whitespace-pre-line">{normalizeNodeLabel(data.label)}</span>
        {data.description && (
          <span className="text-[9px] text-[color:var(--diagram-description-color,#e4e4e7)] leading-tight mt-0.5 whitespace-pre-line">{normalizeNodeLabel(data.description)}</span>
        )}
      </div>
    </div>
  );
}
