'use client';

import { useState } from 'react';
import { UserCog } from 'lucide-react';
import type { DiagramNodeGroup } from '@cenzontle/shared';
import { handleStyle, handleStyleEditing } from '../layout-constants';
import { getGroupBackground } from './node-colors';
import { normalizeNodeLabel } from './node-label';
import { MultiSideHandles } from './node-handles';

interface ActorNodeData {
  label: string;
  description?: string;
  group?: DiagramNodeGroup;
  editing?: boolean;
}

/**
 * ActorNode = `actor` (rol interno identificado — ej: "ANALISTA FINANCIERO").
 *
 * Usa la misma convención UML Use Case Actor que StateNode (stick figure)
 * pero añade un **badge con icono `UserCog`** arriba-derecha para
 * comunicar "rol interno con configuración/permisos" — diferenciándolo
 * visualmente del `client` (actor externo, stick figure solo).
 *
 * Ambos nodes (StateNode y ActorNode) comparten la misma geometría base
 * del stick figure; la única diferencia es el badge. El color del stick
 * figure se controla con `currentColor` heredado del wrapper — responde
 * al `data.group` vía el sistema de colores org-wide.
 */
export function ActorNode({ data, selected }: { data: ActorNodeData; selected?: boolean }) {
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
        className={`relative flex flex-col items-center justify-end rounded-md transition-shadow ${
          selected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : ''
        }`}
        style={{ width: 100, height: 100, color: getGroupBackground(data.group) }}
      >
        <svg
          width="54"
          height="64"
          viewBox="0 0 54 64"
          aria-hidden="true"
          className="mt-1"
        >
          {/* Cabeza */}
          <circle cx="27" cy="11" r="7.5" stroke="currentColor" strokeWidth="2.2" fill="none" />
          {/* Cuerpo */}
          <line x1="27" y1="18.5" x2="27" y2="39" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          {/* Brazos */}
          <line x1="11" y1="27" x2="43" y2="27" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          {/* Piernas */}
          <line x1="27" y1="39" x2="15" y2="58" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="27" y1="39" x2="39" y2="58" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {/*
          Badge "rol interno": diferenciación visual de ActorNode vs StateNode.
          Posicionado arriba-derecha con z-index alto para que se vea sobre
          el stick figure si hay solapamiento en viewports reducidos.
        */}
        <div
          className="absolute top-0 right-2 flex items-center justify-center rounded-full bg-primary shadow-md ring-1 ring-zinc-900/50"
          style={{ width: 20, height: 20 }}
          aria-label="Rol interno"
        >
          <UserCog className="h-3 w-3 text-white" />
        </div>
        <span className="text-[10px] font-bold text-[color:var(--diagram-title-color,#ffffff)] leading-tight max-w-[88px] mb-1 px-1 text-center whitespace-pre-line">
          {normalizeNodeLabel(data.label)}
        </span>
      </div>
    </div>
  );
}
