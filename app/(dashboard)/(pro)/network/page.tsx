import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import {
  getConnectionsForTenant,
  getNetworkInbox,
  getNetworkNotificationCounts,
} from '@/lib/data/network';
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

function NetworkErrorFallback() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">Unable to load network</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong. Please try again or contact support.
      </p>
    </div>
  );
}

export default async function NetworkPage() {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return <NoTenantMessage />;

    const [
      { connections, error: connectionsError },
      { inbox, error: inboxError },
      notificationCounts,
    ] = await Promise.all([
      getConnectionsForTenant(tenantId),
      getNetworkInbox(tenantId),
      getNetworkNotificationCounts(tenantId),
    ]);

    if (connectionsError) {
      return <NetworkErrorFallback />;
    }
    if (inboxError) {
      return <NetworkErrorFallback />;
    }

    return (
      <NetworkView
        currentTenantId={tenantId}
        initialConnections={connections}
        initialInbox={inbox}
        pendingConnections={notificationCounts.pendingConnections}
        inboxJobs={notificationCounts.inboxJobs}
      />
    );
  } catch (err) {
    console.error('[NetworkPage] Unexpected error:', err);
    return <NetworkErrorFallback />;
  }
}
