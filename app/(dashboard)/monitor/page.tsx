import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getImportBatchesForTenant, type JobStatus } from '@/lib/data/jobs';
import { getConnectionsForTenant, getDispatchedJobs } from '@/lib/data/network';
import { MonitorView } from '@/components/monitor/monitor-view';

interface MonitorPageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    receiving_tenant_id?: string;
    batchId?: string;
    page?: string;
  }>;
}

type MonitorStatus = JobStatus | 'declined';

const VALID_STATUS: MonitorStatus[] = [
  'pending',
  'pending_send',
  'assigned',
  'in_progress',
  'paused',
  'declined',
  'completed',
  'cancelled',
];

function NoTenantMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your administrator.
      </p>
    </div>
  );
}

function MonitorErrorFallback({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">Unable to load monitor</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default async function MonitorPage({ searchParams }: MonitorPageProps) {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return <NoTenantMessage />;

    const raw = await searchParams;
    const parsedStatus =
      raw.status && VALID_STATUS.includes(raw.status as MonitorStatus)
        ? (raw.status as MonitorStatus)
        : undefined;
    const page = raw.page ? Math.max(1, parseInt(raw.page, 10) || 1) : 1;

    const [dispatchesResult, connectionsResult, batchesResult] = await Promise.all([
      getDispatchedJobs(tenantId, {
        search: raw.search?.trim() || undefined,
        status: parsedStatus as JobStatus | undefined,
        receiving_tenant_id: raw.receiving_tenant_id?.trim() || undefined,
        import_source_id: raw.batchId?.trim() || undefined,
        page,
      }),
      getConnectionsForTenant(tenantId),
      getImportBatchesForTenant(tenantId),
    ]);

    if (dispatchesResult.error) {
      return <MonitorErrorFallback message={dispatchesResult.error.message} />;
    }
    if (connectionsResult.error) {
      return <MonitorErrorFallback message={connectionsResult.error.message} />;
    }

    const activeConnections = connectionsResult.connections.filter(
      (connection) => connection.status === 'active' && connection.other_tenant_id
    );

    return (
      <MonitorView
        initialJobs={dispatchesResult.dispatches}
        totalCount={dispatchesResult.totalCount}
        initialFilters={{
          search: raw.search?.trim() || undefined,
          status: parsedStatus,
          receiving_tenant_id: raw.receiving_tenant_id?.trim() || undefined,
          batchId: raw.batchId?.trim() || undefined,
          page,
        }}
        connections={activeConnections}
        batches={batchesResult.error ? [] : batchesResult.batches}
      />
    );
  } catch (err) {
    return (
      <MonitorErrorFallback
        message={err instanceof Error ? err.message : 'An unexpected error occurred.'}
      />
    );
  }
}
