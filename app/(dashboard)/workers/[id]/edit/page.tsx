import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { redirect } from 'next/navigation';
import { WorkerForm } from '@/components/workers/worker-form';
import { WorkerDeleteButton } from '@/components/workers/worker-delete-button';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { WorkerInviteStatus, WorkerRow } from '@/lib/types/worker';

async function getWorkerById(
  workerId: string,
  tenantId: string
): Promise<WorkerRow | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .eq('id', workerId)
    .eq('primary_tenant_id', tenantId)
    .single();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    primary_tenant_id: String(row.primary_tenant_id),
    full_name: String(row.full_name ?? ''),
    phone: row.phone != null ? String(row.phone) : null,
    email: row.email != null ? String(row.email) : null,
    invite_status:
      row.invite_status === 'pending' ? 'pending' : ('active' as WorkerInviteStatus),
    home_postcode: row.home_postcode != null ? String(row.home_postcode) : null,
    home_lat: typeof row.home_lat === 'number' ? row.home_lat : null,
    home_lng: typeof row.home_lng === 'number' ? row.home_lng : null,
    worker_type: row.worker_type as WorkerRow['worker_type'],
    status: row.status as WorkerRow['status'],
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : null,
    created_at: row.created_at != null ? String(row.created_at) : undefined,
    updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
  };
}

interface WorkerEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkerEditPage({ params }: WorkerEditPageProps) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) redirect('/workers');

  const { id: workerId } = await params;
  const worker = await getWorkerById(workerId, tenantId);

  if (!worker) {
    redirect('/workers?error=Worker+not+found');
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/workers/${workerId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to worker
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Edit worker
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {worker.full_name}
        </p>
      </div>

      <div className="max-w-xl space-y-6">
        <WorkerForm mode="edit" tenantId={tenantId} worker={worker} />
        <div className="pt-4 border-t border-border/80">
          <WorkerDeleteButton workerId={worker.id} workerName={worker.full_name} />
        </div>
      </div>
    </div>
  );
}
