'use client';

import { EvolutionView } from '@/components/factory/EvolutionView';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryEvolutionPage() {
  useDocumentTitle('Evolución');
  return <EvolutionView />;
}
