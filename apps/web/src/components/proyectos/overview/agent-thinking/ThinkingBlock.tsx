'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface ThinkingBlockProps {
  text: string;
  isActive: boolean;
}

const MAX_COLLAPSED_LENGTH = 400;

export function ThinkingBlock({ text, isActive }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > MAX_COLLAPSED_LENGTH;
  const displayText = !expanded && isLong ? text.slice(0, MAX_COLLAPSED_LENGTH) + '\u2026' : text;

  return (
    <div className="animate-[agent-slide-in_200ms_ease-out] py-1.5">
      <div className="text-xs text-muted-foreground/80 italic leading-relaxed whitespace-pre-wrap">
        {displayText}
        {isActive && (
          <span className="inline-block w-[2px] h-3.5 bg-primary ml-0.5 -mb-0.5 animate-[agent-cursor-blink_1s_steps(2)_infinite]" />
        )}
      </div>
      {isLong && !isActive && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Mostrar menos' : 'Mostrar m\u00e1s'}
        </button>
      )}
    </div>
  );
}
