'use client';

import { use } from 'react';
import { useFactory } from '@/context/FactoryContext';
import { BatchDetail } from '@/components/factory/BatchDetail';
import { ArrowLeft, PackageOpen } from 'lucide-react';
import Link from 'next/link';

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state } = useFactory();

  const batch = state.factory.activeBatches.find((b) => b.id === id);

  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#141419] border border-[#2A2A35]">
          <PackageOpen className="h-7 w-7 text-[#5A5A6E]" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-[#EDEDF0]">Batch not found</h1>
        <p className="text-sm text-[#8B8B9A] max-w-sm text-center">
          The batch <span className="font-mono text-[#EDEDF0]">{id}</span> does not exist
          in active batches or may have been completed.
        </p>
        <Link
          href="/factory"
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#141419] border border-[#2A2A35] px-4 py-2 text-sm text-[#EDEDF0] hover:bg-[#1A1A22] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Factory
        </Link>
      </div>
    );
  }

  return <BatchDetail batchId={id} />;
}
