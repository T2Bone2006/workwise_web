import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getWorkerAllowance } from '@/lib/data/worker-allowance';
import { BulkAddWorkers } from '@/components/workers/bulk-add-workers';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function AddSeveralWorkersPage() {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) redirect('/workers');
  // null for a manual account or when the plan can't be read: no live cost line (the server still checks everything).
  const allowance = await getWorkerAllowance();

  return (
    <div className="space-y-6">
      <div>
        <HistoryBackButton fallbackHref="/workers" label="Back to workers" />
      </div>
      <PageGradientHeader
        title="Add several workers"
        subtitle="Put your whole team on WorkWise in one go, and see exactly what it costs before you confirm."
      />
      <BulkAddWorkers allowance={allowance} />
    </div>
  );
}
