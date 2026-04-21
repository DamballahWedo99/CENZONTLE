'use client';

import { useState } from 'react';
import type { DiagramNodeGroup } from '@cenzontle/shared';
import { handleStyle, handleStyleEditing } from '../layout-constants';
import { getGroupBackground } from './node-colors';
import { normalizeNodeLabel } from './node-label';
import { MultiSideHandles } from './node-handles';

interface DecisionNodeData {
  label: string;
  description?: string;
  group?: DiagramNodeGroup;
  editing?: boolean;
}

export function DecisionNode({ data, selected }: { data: DecisionNodeData; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  const [hover, setHover] = useState(false);
  const pulseCls = data.editing && hover ? 'animate-pulse ring-2 ring-primary/40' : '';
  return (
    <div
      className="relative"
      style={{ width: 120, height: 120 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MultiSideHandles style={hs} className={pulseCls} includeLeftOut />
      <div
        className={`absolute border border-zinc-500 transition-shadow ${
          selected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : ''
        }`}
        style={{
          width: 84,
          height: 84,
          transform: 'rotate(45deg)',
          borderRadius: 4,
          top: 18,
          left: 18,
          backgroundColor: getGroupBackground(data.group),
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10">
        {/* max-h + overflow-hidden previenen desborde vertical cuando el LLM
            emite labels multi-línea que exceden el rombo de 84×84px. */}
        <span className="text-[10px] font-bold text-[color:var(--diagram-title-color,#ffffff)] leading-tight max-w-[76px] max-h-[76px] overflow-hidden whitespace-pre-line">{normalizeNodeLabel(data.label)}</span>
      </div>
    </div>
  );
}
