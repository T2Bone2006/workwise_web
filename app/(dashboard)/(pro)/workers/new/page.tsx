import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantSkills } from '@/lib/actions/skills';
import { redirect } from 'next/navigation';
import { WorkerForm } from '@/components/workers/worker-form';
import { HistoryBackButton } from '@/components/layout/history-back-button';

export default async function NewWorkerPage() {
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    redirect('/workers');
  }

  const tenantSkills = await getTenantSkills(tenantId);

  return (
    <div className="space-y-6">
      <div>
        <HistoryBackButton fallbackHref="/workers" label="Back to workers" />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Add worker
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Onboard a new worker on your team
        </p>
      </div>

      <div className="max-w-xl">
        <WorkerForm mode="create" tenantId={tenantId} tenantSkills={tenantSkills} />
      </div>
    </div>
  );
}
