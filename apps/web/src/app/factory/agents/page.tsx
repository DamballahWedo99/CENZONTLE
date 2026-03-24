'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AgentGrid } from '@/components/factory/AgentGrid';

function AgentsContent() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get('agent');
  return <AgentGrid initialAgentId={agentId} />;
}

export default function FactoryAgentsPage() {
  return (
    <Suspense>
      <AgentsContent />
    </Suspense>
  );
}
