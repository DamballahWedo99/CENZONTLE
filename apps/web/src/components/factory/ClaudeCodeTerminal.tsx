'use client';

import { useEffect } from 'react';
import { SquareTerminal, AlertCircle } from 'lucide-react';
import type { UseAgentTerminalReturn } from '@/hooks/use-agent-terminal';

/**
 * Raíz del repo en el host del API. DEBE venir de NEXT_PUBLIC_PROJECT_ROOT
 * — sin fallback hardcoded (un path absoluto se filtraría al bundle). Si no
 * está, el componente no arranca la sesión y muestra un aviso.
 */
const PROJECT_ROOT = process.env.NEXT_PUBLIC_PROJECT_ROOT ?? '';

interface ClaudeCodeTerminalProps {
  /**
   * Sesión de terminal. El hook `useAgentTerminal` vive en `AgentTerminal`
   * (lifting state up), NO aquí — así el botón de subir imagen del header
   * puede operar sobre esta MISMA sesión. `AgentTerminal` lo crea con
   * `enabled: false` (sin hidratación); el auto-start de abajo la arranca.
   */
  terminal: UseAgentTerminalReturn;
  /** Branch sobre la que se abre la sesión de Claude Code. */
  branch: string;
}

/**
 * Terminal interactivo de Claude Code embebido — abre una sesión NUEVA de
 * Claude Code sobre una branch (en un worktree aislado del host del API) y
 * la renderiza en un `<iframe>` ttyd a pantalla completa, sin chrome propio.
 *
 * Lo usa `AgentTerminal` para llenar el área de un run que terminó CON
 * ERROR (failed/abandoned): ese run ya no tiene un ttyd vivo (el worker lo
 * cerró al terminar), así que en vez de un spinner infinito mostramos un
 * Claude Code vivo donde el operador puede trabajar la deuda técnica de la
 * story sobre su branch. Los runs completados con éxito muestran en cambio
 * un resumen estático (`RunCompletedSummary`), no esta terminal.
 *
 * La sesión arranca sola al montar (auto-start). Para cerrarla, el operador
 * escribe `/exit` DENTRO de Claude Code: al salir `claude`, su pane de tmux
 * muere, el hook `pane-died` mata el tmux server y el ttyd termina. Por eso
 * el componente no tiene toolbar ni botón de cerrar.
 */
export function ClaudeCodeTerminal({ terminal, branch }: ClaudeCodeTerminalProps) {
  const projectRootConfigured = PROJECT_ROOT.length > 0;
  // Un run real SIEMPRE trae branch (el backend la construye desde UUIDs).
  // El check es defensivo: si por data malformada llegara vacía, abrir la
  // sesión sin branch arrancaría `claude` sin worktree aislado sobre el
  // repo real — preferimos no arrancar y avisar.
  const branchValid = branch.trim().length > 0;

  // Auto-start: arrancamos la sesión de Claude Code apenas monta el
  // componente — sin pantalla intermedia ni clicks. El operador llegó a esta
  // página justamente para trabajar la deuda de la story. El backend
  // `startSession` es idempotente por sessionId (si ya hay una sesión viva
  // la reusa). Para terminar la sesión, el operador escribe `/exit` dentro
  // de Claude Code — no hay botón de cerrar.
  useEffect(() => {
    if (!projectRootConfigured || !branchValid) return;
    if (!terminal.sessionActive && !terminal.loading && !terminal.ttydUrl) {
      void terminal.startSession(PROJECT_ROOT, undefined, branch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0d1117]">
      {/* Error */}
      {terminal.error && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/30 shrink-0">
          <AlertCircle
            className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-xs text-red-300 leading-snug break-words">
            {terminal.error}
          </p>
        </div>
      )}

      {/* Terminal embebido o placeholder mientras arranca */}
      <div className="flex-1 relative min-h-0">
        {terminal.ttydUrl ? (
          <iframe
            src={terminal.ttydUrl}
            className="absolute inset-0 w-full h-full border-0"
            // sandbox: scripts (xterm.js) + same-origin (WebSocket del ttyd),
            // sin popups ni top-navigation (security-reviewer 2026-05-19).
            sandbox="allow-scripts allow-same-origin"
            allow="clipboard-read; clipboard-write"
            title={`Claude Code — ${branch}`}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <SquareTerminal
              className="h-8 w-8 text-muted-foreground/30"
              aria-hidden="true"
            />
            <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
              {!projectRootConfigured
                ? 'Configura la variable NEXT_PUBLIC_PROJECT_ROOT para habilitar el workspace de Claude Code.'
                : !branchValid
                  ? 'Este run no tiene una branch asociada — no se puede abrir un workspace de Claude Code.'
                  : 'Creando worktree y arrancando Claude Code…'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
