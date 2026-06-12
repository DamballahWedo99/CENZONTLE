'use client';

import { VelocityTracker } from '@/components/factory/VelocityTracker';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryVelocityPage() {
  useDocumentTitle('Velocity');
  return <VelocityTracker />;
}
