'use client';

import { CostAnalytics } from '@/components/factory/CostAnalytics';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryCostPage() {
  useDocumentTitle('Costos');
  return <CostAnalytics />;
}
