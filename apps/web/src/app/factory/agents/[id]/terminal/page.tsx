'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFactory } from '@/context/FactoryContext';
import { AgentTerminal } from '@/components/factory/AgentTerminal';
import { Bot } from 'lucide-react';

export default function AgentTerminalPage() {
  const params = useParams();
  const agentId = params.id as string;
  const { state } = useFactory();

  const agent = useMemo(
    () => state.agents.find((a) => a.id === agentId) ?? null,
    [state.agents, agentId],
  );

  if (!agent) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Bot className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <h1 className="text-lg font-semibold text-foreground">Agente no encontrado</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No se encontró el agente <span className="font-mono">{agentId}</span>
          </p>
          <button
            onClick={() => window.close()}
            className="mt-4 rounded-lg bg-muted px-4 py-2 text-sm text-foreground hover:bg-muted/80 transition-colors"
          >
            Cerrar pestaña
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page h-full w-full bg-background dark">
      <AgentTerminal agent={agent} onClose={() => window.close()} />
    </div>
  );
}
