'use client';

import { useState } from 'react';
import type { DiagramNodeGroup } from '@cenzontle/shared';
import { handleStyle, handleStyleEditing } from '../layout-constants';
import { getGroupBackground } from './node-colors';
import { normalizeNodeLabel } from './node-label';
import { MultiSideHandles } from './node-handles';

interface StateNodeData {
  label: string;
  description?: string;
  group?: DiagramNodeGroup;
  editing?: boolean;
}

/**
 * StateNode = `client` (actor humano externo).
 *
 * Renderiza la convención UML Use Case Actor: un **stick figure** (muñeco
 * de palo) con el label debajo. Universalmente reconocido en la industria
 * de software como "usuario/persona externa".
 *
 * El color del stick figure responde a `data.group` via `currentColor`:
 * el stroke del SVG hereda del `color` CSS del wrapper, que viene de la
 * config org-wide (useOrgDiagramTheme). Alta Gerencia configura la paleta
 * per-group para toda la organización.
 *
 * Antes era un círculo blanco (identidad pragmática pero no conforme).
 * El cambio a stick figure se alinea con ISO 5807 / BPMN 2.0 / UML
 * Use Case — en flowcharts el círculo se reserva para eventos start/end,
 * usarlo para actores humanos era inconsistente con el estándar.
 */
export function StateNode({ data, selected }: { data: StateNodeData; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  const [hover, setHover] = useState(false);
  const pulseCls = data.editing && hover ? 'animate-pulse ring-2 ring-primary/40' : '';
  return (
    <div
      className="contents"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MultiSideHandles style={hs} className={pulseCls} />
      <div
        className={`flex flex-col items-center justify-end rounded-md transition-shadow ${
          selected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : ''
        }`}
        style={{ width: 90, height: 90, color: getGroupBackground(data.group) }}
      >
        <svg
          width="50"
          height="60"
          viewBox="0 0 50 60"
          aria-hidden="true"
          className="mt-1"
        >
          {/* Cabeza */}
          <circle cx="25" cy="10" r="7" stroke="currentColor" strokeWidth="2.2" fill="none" />
          {/* Cuerpo */}
          <line x1="25" y1="17" x2="25" y2="37" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          {/* Brazos horizontales */}
          <line x1="10" y1="25" x2="40" y2="25" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          {/* Piernas */}
          <line x1="25" y1="37" x2="14" y2="55" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="25" y1="37" x2="36" y2="55" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="text-[10px] font-bold text-[color:var(--diagram-title-color,#ffffff)] leading-tight max-w-[84px] mb-1 px-1 text-center whitespace-pre-line">
          {normalizeNodeLabel(data.label)}
        </span>
      </div>
    </div>
  );
}
