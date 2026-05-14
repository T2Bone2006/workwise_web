import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getConnectionsForTenant, getNetworkInbox } from '@/lib/data/network';
import { NetworkView } from '@/components/network/network-view';

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

function NetworkErrorFallback({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">Unable to load network</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default async function NetworkPage() {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return <NoTenantMessage />;

    const [{ connections, error: connectionsError }, { inbox, error: inboxError }] = await Promise.all([
      getConnectionsForTenant(tenantId),
      getNetworkInbox(tenantId),
    ]);

    if (connectionsError) {
      return <NetworkErrorFallback message={connectionsError.message} />;
    }
    if (inboxError) {
      return <NetworkErrorFallback message={inboxError.message} />;
    }

    return (
      <NetworkView currentTenantId={tenantId} initialConnections={connections} initialInbox={inbox} />
    );
  } catch (err) {
    return (
      <NetworkErrorFallback
        message={err instanceof Error ? err.message : 'An unexpected error occurred.'}
      />
    );
  }
}
