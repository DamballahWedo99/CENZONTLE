'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AgentGrid } from '@/components/factory/AgentGrid';
import { useDocumentTitle } from '@/hooks/use-document-title';

function AgentsContent() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get('agent');
  return <AgentGrid initialAgentId={agentId} />;
}

export default function FactoryAgentsPage() {
  useDocumentTitle('Agentes');
  return (
    <Suspense>
      <AgentsContent />
    </Suspense>
  );
}
