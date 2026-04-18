'use client';

import type { EpicGenerationPhase } from '@cenzontle/shared';

interface PhaseProgressBarProps {
  currentPhase: EpicGenerationPhase;
}

type ActivePhase = 'researching' | 'analyzing' | 'proposing';

const PHASES: { key: ActivePhase; label: string }[] = [
  { key: 'researching', label: 'Investigando' },
  { key: 'analyzing', label: 'Analizando' },
  { key: 'proposing', label: 'Proponiendo' },
];

const PHASE_ORDER: Record<string, number> = {
  idle: -1,
  researching: 0,
  analyzing: 1,
  proposing: 2,
  done: 3,
};

export function PhaseProgressBar({ currentPhase }: PhaseProgressBarProps) {
  const currentIdx = PHASE_ORDER[currentPhase] ?? -1;

  return (
    <div className="space-y-1">
      <div className="flex gap-0.5 h-1 rounded-full overflow-hidden">
        {PHASES.map((phase, idx) => {
          let segmentClass = 'bg-muted';
          if (idx < currentIdx || currentPhase === 'done') {
            segmentClass = 'bg-primary';
          } else if (idx === currentIdx) {
            segmentClass = 'bg-primary/60 animate-[agent-pulse_2s_ease-in-out_infinite]';
          }
          return (
            <div
              key={phase.key}
              className={`flex-1 rounded-full transition-colors duration-300 ${segmentClass}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between">
        {PHASES.map((phase, idx) => {
          const isActive = idx === currentIdx;
          const isDone = idx < currentIdx || currentPhase === 'done';
          return (
            <span
              key={phase.key}
              className={`text-[9px] ${isActive ? 'text-foreground font-medium' : isDone ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}
            >
              {phase.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
