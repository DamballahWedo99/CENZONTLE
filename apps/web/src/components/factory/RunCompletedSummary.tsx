'use client';

import { CheckCircle2, GitBranch, GitPullRequest, ListChecks } from 'lucide-react';

interface RunCompletedSummaryProps {
  /** Branch del run completado — referencia, no se abre ninguna sesión. */
  branch: string;
  /** Número del PR que abrió el run, o null si no llegó a abrirlo. */
  prNumber: number | null;
  /** Criterios DoD evaluados del run (texto + si se cumplió). */
  dod: { text: string; done: boolean }[];
}

/**
 * Panel de cierre para un AgentRun que terminó con éxito (status
 * `completed`). Es el contenido del área de terminal en
 * `/factory/agents/:runId/terminal` para ese caso.
 *
 * Por qué un resumen y no una terminal: cuando un run termina, el worker
 * cierra su ttyd — no hay terminal en vivo. Los runs con error embeben un
 * Claude Code NUEVO (`ClaudeCodeTerminal`) para que el operador trabaje la
 * deuda; un run exitoso no tiene deuda que trabajar, así que basta con un
 * resumen estático. Ambos caminos reemplazan al spinner infinito que la
 * página mostraba antes para todo run terminado.
 *
 * El header de `AgentTerminal` ya muestra el contexto rico (título, badge
 * de status, pills de DoD/acceptance/workflow); este panel solo confirma
 * el cierre y deja a mano la branch y el PR.
 */
export function RunCompletedSummary({
  branch,
  prNumber,
  dod,
}: RunCompletedSummaryProps) {
  const dodDone = dod.filter((c) => c.done).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-[#0d1117] px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
        <CheckCircle2 className="h-6 w-6 text-green-400" aria-hidden="true" />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Run completado</p>
        <p className="text-xs text-muted-foreground/70 max-w-sm leading-relaxed">
          El agente terminó esta historia. La terminal en vivo se cerró al
          completar el run.
        </p>
      </div>

      {/* Datos esenciales del run cerrado — el header ya cubre el resto. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {branch.length > 0 && (
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="font-mono truncate max-w-[260px]">{branch}</span>
          </span>
        )}
        {dod.length > 0 && (
          <span className="flex items-center gap-1.5">
            <ListChecks className="h-3 w-3 shrink-0" aria-hidden="true" />
            {dodDone}/{dod.length} DoD
          </span>
        )}
        {prNumber !== null && (
          <span className="flex items-center gap-1.5">
            <GitPullRequest className="h-3 w-3 shrink-0" aria-hidden="true" />
            PR #{prNumber}
          </span>
        )}
      </div>
    </div>
  );
}
