import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { redirect } from 'next/navigation';
import { WorkerForm } from '@/components/workers/worker-form';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function NewWorkerPage() {
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    redirect('/workers');
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/workers"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to workers
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Add worker
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Onboard a new locksmith subcontractor
        </p>
      </div>

      <div className="max-w-xl">
        <WorkerForm mode="create" tenantId={tenantId} />
      </div>
    </div>
  );
}
