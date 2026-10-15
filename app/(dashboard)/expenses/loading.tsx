'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExpensesPageSkeleton, InOutSkeleton } from '@/components/layout/page-skeletons';

function ExpensesBody() {
  return useSearchParams().get('tab') === 'in-out' ? <InOutSkeleton /> : <ExpensesPageSkeleton />;
}

export default function ExpensesLoading() {
  return (
    <Suspense fallback={<ExpensesPageSkeleton />}>
      <ExpensesBody />
    </Suspense>
  );
}
