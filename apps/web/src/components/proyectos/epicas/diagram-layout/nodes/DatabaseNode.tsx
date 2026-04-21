'use client';

import { useState } from 'react';
import type { DiagramNodeGroup } from '@cenzontle/shared';
import { handleStyle, handleStyleEditing } from '../layout-constants';
import { getGroupBackground } from './node-colors';
import { normalizeNodeLabel } from './node-label';
import { MultiSideHandles } from './node-handles';

interface DatabaseNodeData {
  label: string;
  description?: string;
  group?: DiagramNodeGroup;
  editing?: boolean;
}

export function DatabaseNode({ data, selected }: { data: DatabaseNodeData; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  const [hover, setHover] = useState(false);
  const pulseCls = data.editing && hover ? 'animate-pulse ring-2 ring-primary/40' : '';
  const bg = getGroupBackground(data.group);
  return (
    <div
      className="contents"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MultiSideHandles style={hs} className={pulseCls} />
      <div className={`flex flex-col items-center transition-shadow ${selected ? 'drop-shadow-[0_0_8px_rgba(99,102,241,0.3)]' : ''}`} style={{ width: 130 }}>
        <div
          className="border border-zinc-500"
          style={{ width: 130, height: 20, borderRadius: '50%', position: 'relative', zIndex: 2, backgroundColor: bg }}
        />
        <div
          className="border-x border-b border-zinc-500 flex flex-col items-center justify-center text-center px-3 pb-2"
          style={{ width: 130, marginTop: -10, paddingTop: 14, borderBottomLeftRadius: '50% 18px', borderBottomRightRadius: '50% 18px', backgroundColor: bg }}
        >
          <span className="text-[11px] font-semibold text-[color:var(--diagram-title-color,#ffffff)] leading-tight whitespace-pre-line">{normalizeNodeLabel(data.label)}</span>
          {data.description && (
            <span className="text-[9px] text-[color:var(--diagram-description-color,#e4e4e7)] leading-tight mt-0.5 whitespace-pre-line">{normalizeNodeLabel(data.description)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
