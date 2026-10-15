'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PaymentsListSkeleton, PaymentsOverviewSkeleton } from '@/components/layout/page-skeletons';

function PaymentsBody() {
  const params = useSearchParams();
  const view = params.get('view');
  const tab = params.get('tab');
  const list =
    view === 'overdue' ||
    view === 'received' ||
    view === 'invoices' ||
    tab === 'invoices' ||
    tab === 'payments';
  return list ? <PaymentsListSkeleton /> : <PaymentsOverviewSkeleton />;
}

export default function PaymentsLoading() {
  return (
    <Suspense fallback={<PaymentsOverviewSkeleton />}>
      <PaymentsBody />
    </Suspense>
  );
}
