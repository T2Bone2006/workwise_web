'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Mail, ShieldCheck, Inbox, Building2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import {
  acceptNetworkJob,
  createConnection,
  respondToConnection,
  revokeConnection,
  declineEntireDispatch,
  declineNetworkJob,
  updateConnectionSettings,
} from '@/lib/actions/network';
import type { NetworkConnectionRow, NetworkInboxRow } from '@/lib/data/network';

interface NetworkViewProps {
  currentTenantId: string;
  initialConnections: NetworkConnectionRow[];
  initialInbox: NetworkInboxRow[];
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function getSnapshotField(
  snapshot: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!snapshot) return null;
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function NetworkView({
  currentTenantId,
  initialConnections,
  initialInbox,
}: NetworkViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [declineAllDialog, setDeclineAllDialog] = useState<{ open: boolean; dispatchId: string | null }>({
    open: false,
    dispatchId: null,
  });
  const [settingsDialog, setSettingsDialog] = useState<{
    open: boolean;
    connectionId: string | null;
    tradeTypes: string[];
    radiusMiles: number;
  }>({ open: false, connectionId: null, tradeTypes: [], radiusMiles: 50 });
  const [connections, setConnections] = useState(initialConnections);

  useEffect(() => {
    setConnections(initialConnections);
  }, [initialConnections]);

  const pendingSentInvites = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.status === 'pending' &&
          connection.invited_by_tenant_id === currentTenantId
      ),
    [connections, currentTenantId]
  );

  const pendingReceivedInvites = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.status === 'pending' &&
          connection.invited_by_tenant_id !== currentTenantId
      ),
    [connections, currentTenantId]
  );

  const activeConnections = useMemo(
    () => connections.filter((connection) => connection.status === 'active'),
    [connections]
  );

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      toast.error('Please enter an email address.');
      return;
    }

    setBusyKey('invite');
    startTransition(async () => {
      const result = await createConnection(inviteEmail.trim(), inviteMessage.trim() || undefined);
      if (!result.success) {
        toast.error(result.error ?? 'Unable to send invite.');
      } else {
        toast.success('Connection invite sent.');
        setInviteEmail('');
        setInviteMessage('');
        router.refresh();
      }
      setBusyKey(null);
    });
  };

  const handleRespond = (connectionId: string, accept: boolean) => {
    setBusyKey(`${accept ? 'accept' : 'decline'}-${connectionId}`);
    startTransition(async () => {
      const result = await respondToConnection(connectionId, accept);
      if (!result.success) {
        toast.error(result.error ?? 'Unable to update invite.');
      } else {
        toast.success(accept ? 'Connection accepted.' : 'Connection declined.');
        router.refresh();
      }
      setBusyKey(null);
    });
  };

  const handleRevoke = (connectionId: string) => {
    setBusyKey(`revoke-${connectionId}`);
    startTransition(async () => {
      const result = await revokeConnection(connectionId);
      if (!result.success) {
        toast.error(result.error ?? 'Unable to revoke connection.');
      } else {
        toast.success('Connection revoked.');
        router.refresh();
      }
      setBusyKey(null);
    });
  };

  const handleInboxAccept = (row: NetworkInboxRow) => {
    setBusyKey(`inbox-accept-${row.id}`);
    startTransition(async () => {
      const result = await acceptNetworkJob(row.id);
      if (!result.success) {
        toast.error(result.error ?? 'Unable to accept network job.');
      } else {
        toast.success('Network job accepted.');
        router.refresh();
      }
      setBusyKey(null);
    });
  };

  const handleInboxDecline = (row: NetworkInboxRow) => {
    setBusyKey(`inbox-decline-${row.id}`);
    startTransition(async () => {
      const result = await declineNetworkJob(row.id);
      if (!result.success) {
        toast.error(result.error ?? 'Unable to decline network job.');
      } else {
        toast.success('Network job declined.');
        router.refresh();
      }
      setBusyKey(null);
    });
  };

  const handleSaveSettings = () => {
    if (!settingsDialog.connectionId) return;
    setBusyKey('settings-save');
    startTransition(async () => {
      const result = await updateConnectionSettings(settingsDialog.connectionId!, {
        trade_types: settingsDialog.tradeTypes,
        coverage_radius_miles: settingsDialog.radiusMiles,
      });
      if (!result.success) {
        toast.error(result.error ?? 'Unable to save settings.');
      } else {
        toast.success('Settings saved.');
        const connectionId = settingsDialog.connectionId!;
        setConnections((prev) =>
          prev.map((connection) =>
            connection.id === connectionId
              ? {
                  ...connection,
                  trade_types: result.data.trade_types,
                  coverage_radius_miles: result.data.coverage_radius_miles,
                }
              : connection
          )
        );
        setSettingsDialog({ open: false, connectionId: null, tradeTypes: [], radiusMiles: 50 });
        router.refresh();
      }
      setBusyKey(null);
    });
  };

  const handleDeclineAll = () => {
    if (!declineAllDialog.dispatchId) return;
    const dispatchId = declineAllDialog.dispatchId;
    setBusyKey(`inbox-decline-all-${dispatchId}`);
    startTransition(async () => {
      const result = await declineEntireDispatch(dispatchId);
      if (!result.success) {
        toast.error(result.error ?? 'Unable to decline dispatch jobs.');
      } else {
        if (result.data.failed > 0) {
          toast.success(
            `Declined ${result.data.success} job${result.data.success === 1 ? '' : 's'} (${result.data.failed} failed).`
          );
        } else {
          toast.success(
            `Declined ${result.data.success} job${result.data.success === 1 ? '' : 's'} from this dispatch.`
          );
        }
        router.refresh();
      }
      setDeclineAllDialog({ open: false, dispatchId: null });
      setBusyKey(null);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <PageGradientHeader
          title="Network"
          subtitle="Manage business connections and incoming network jobs."
        />
      </div>

      <Tabs defaultValue="connections" className="space-y-6">
          <TabsList className="bg-muted/80">
            <TabsTrigger value="connections" className="gap-2">
              <ShieldCheck className="size-4" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2">
              <Inbox className="size-4" />
              Inbox
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connections" className="space-y-6">
            <Card className="rounded-xl border border-border/60">
              <CardHeader>
                <CardTitle>Invite a business</CardTitle>
                <CardDescription>
                  Send a network invitation to another business by email.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleInviteSubmit} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="network-invite-email">Email</Label>
                    <Input
                      id="network-invite-email"
                      type="email"
                      placeholder="partner@business.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="network-invite-message">Message (optional)</Label>
                    <Input
                      id="network-invite-message"
                      placeholder="We can cover overflow plumbing jobs in West London."
                      value={inviteMessage}
                      onChange={(e) => setInviteMessage(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="submit"
                      variant="gradient"
                      disabled={isPending && busyKey === 'invite'}
                    >
                      {isPending && busyKey === 'invite' ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Mail className="size-4" />
                      )}
                      Send invite
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="rounded-xl border border-border/60">
              <CardHeader>
                <CardTitle>Pending sent invites</CardTitle>
                <CardDescription>Invitations you have sent and are awaiting response.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingSentInvites.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pending sent invites.</p>
                )}
                {pendingSentInvites.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex flex-col gap-3 rounded-lg border border-border/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {connection.invite_email ?? connection.other_tenant_name ?? 'Unknown email'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Sent on {formatDate(connection.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleRevoke(connection.id)}
                      disabled={isPending && busyKey === `revoke-${connection.id}`}
                    >
                      {isPending && busyKey === `revoke-${connection.id}` && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      Revoke
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-xl border border-border/60">
              <CardHeader>
                <CardTitle>Pending received invites</CardTitle>
                <CardDescription>Invitations sent to your business awaiting your response.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingReceivedInvites.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pending received invites.</p>
                )}
                {pendingReceivedInvites.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex flex-col gap-3 rounded-lg border border-border/50 p-4"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {connection.other_tenant_name ?? 'Unknown business'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {connection.message?.trim() || 'No message provided.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="gradient"
                        onClick={() => handleRespond(connection.id, true)}
                        disabled={isPending && busyKey === `accept-${connection.id}`}
                      >
                        {isPending && busyKey === `accept-${connection.id}` && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Accept
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleRespond(connection.id, false)}
                        disabled={isPending && busyKey === `decline-${connection.id}`}
                      >
                        {isPending && busyKey === `decline-${connection.id}` && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-xl border border-border/60">
              <CardHeader>
                <CardTitle>Active connections</CardTitle>
                <CardDescription>Businesses currently connected to your network.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {activeConnections.length === 0 && (
                  <p className="text-sm text-muted-foreground">No active connections yet.</p>
                )}
                {activeConnections.map((connection) => (
                  <div key={connection.id} className="rounded-xl border border-border/50 p-4">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">
                          {connection.other_tenant_name ?? 'Connected business'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Coverage radius: {connection.coverage_radius_miles ?? '—'} miles
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSettingsDialog({
                              open: true,
                              connectionId: connection.id,
                              tradeTypes: [...(connection.trade_types ?? [])],
                              radiusMiles: connection.coverage_radius_miles ?? 50,
                            })
                          }
                        >
                          Settings
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRevoke(connection.id)}
                          disabled={isPending && busyKey === `revoke-${connection.id}`}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(connection.trade_types ?? []).length === 0 && (
                        <Badge variant="secondary">No trade types set</Badge>
                      )}
                      {(connection.trade_types ?? []).map((trade) => (
                        <Badge key={`${connection.id}-${trade}`} variant="secondary">
                          {trade}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inbox">
            <Card className="rounded-xl border border-border/60">
              <CardHeader>
                <CardTitle>Incoming network jobs</CardTitle>
                <CardDescription>
                  Jobs shared by connected businesses that are waiting for your decision.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {initialInbox.length === 0 && (
                  <p className="text-sm text-muted-foreground">No network jobs in your inbox.</p>
                )}
                {initialInbox.map((item) => {
                  const description = getSnapshotField(item.originating_customer_snapshot, [
                    'job_description',
                    'description',
                    'notes',
                  ]);
                  const address = getSnapshotField(item.originating_customer_snapshot, [
                    'address',
                    'site_address',
                    'full_address',
                  ]);
                  const scheduledDate = getSnapshotField(item.originating_customer_snapshot, [
                    'scheduled_date',
                    'date',
                  ]);

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-border/50 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Building2 className="size-4 text-muted-foreground" />
                            <p className="font-medium text-foreground">
                              {item.originating_tenant_name ?? 'Unknown business'}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Ref: {item.originating_reference_number ?? '—'}
                          </p>
                          <p className="text-sm text-foreground">
                            {description ?? 'No job description provided.'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Address: {address ?? '—'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Scheduled: {scheduledDate ?? '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="gradient"
                            onClick={() => handleInboxAccept(item)}
                            disabled={isPending && busyKey === `inbox-accept-${item.id}`}
                          >
                            {isPending && busyKey === `inbox-accept-${item.id}` && (
                              <Loader2 className="size-4 animate-spin" />
                            )}
                            Accept
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleInboxDecline(item)}
                            disabled={isPending && busyKey === `inbox-decline-${item.id}`}
                          >
                            {isPending && busyKey === `inbox-decline-${item.id}` && (
                              <Loader2 className="size-4 animate-spin" />
                            )}
                            Decline
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setDeclineAllDialog({
                                open: true,
                                dispatchId: item.id,
                              })
                            }
                            disabled={isPending && busyKey === `inbox-decline-all-${item.id}`}
                          >
                            {isPending && busyKey === `inbox-decline-all-${item.id}` && (
                              <Loader2 className="size-4 animate-spin" />
                            )}
                            Decline all
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
      </Tabs>
      <Dialog
        open={declineAllDialog.open}
        onOpenChange={(open) =>
          setDeclineAllDialog((prev) => ({
            open,
            dispatchId: open ? prev.dispatchId : null,
          }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline all jobs in this dispatch</DialogTitle>
            <DialogDescription>
              Are you sure? This will decline every pending job linked to this dispatch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeclineAllDialog({ open: false, dispatchId: null })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeclineAll}
              disabled={
                !declineAllDialog.dispatchId ||
                (isPending &&
                  busyKey === `inbox-decline-all-${declineAllDialog.dispatchId}`)
              }
            >
              {isPending &&
              declineAllDialog.dispatchId &&
              busyKey === `inbox-decline-all-${declineAllDialog.dispatchId}` ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Decline all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={settingsDialog.open}
        onOpenChange={(open) =>
          setSettingsDialog((prev) => ({
            open,
            connectionId: open ? prev.connectionId : null,
            tradeTypes: open ? prev.tradeTypes : [],
            radiusMiles: open ? prev.radiusMiles : 50,
          }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connection settings</DialogTitle>
            <DialogDescription>
              Update coverage radius and trade types for this connection.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="settings-radius">Coverage radius (miles)</Label>
              <Input
                id="settings-radius"
                type="number"
                min={1}
                value={settingsDialog.radiusMiles}
                onChange={(e) =>
                  setSettingsDialog((prev) => ({
                    ...prev,
                    radiusMiles: Number(e.target.value) || 50,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-trade-type">Trade types</Label>
              <Input
                id="settings-trade-type"
                placeholder="Type a trade and press Enter"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const value = e.currentTarget.value.trim();
                  if (!value) return;
                  setSettingsDialog((prev) =>
                    prev.tradeTypes.includes(value)
                      ? prev
                      : { ...prev, tradeTypes: [...prev.tradeTypes, value] }
                  );
                  e.currentTarget.value = '';
                }}
              />
              <div className="flex flex-wrap gap-2">
                {settingsDialog.tradeTypes.map((trade) => (
                  <Badge key={trade} variant="secondary" className="gap-1 pr-1">
                    {trade}
                    <button
                      type="button"
                      className="ml-1 rounded-sm hover:bg-muted"
                      onClick={() =>
                        setSettingsDialog((prev) => ({
                          ...prev,
                          tradeTypes: prev.tradeTypes.filter((t) => t !== trade),
                        }))
                      }
                      aria-label={`Remove ${trade}`}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() =>
                setSettingsDialog({
                  open: false,
                  connectionId: null,
                  tradeTypes: [],
                  radiusMiles: 50,
                })
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSettings}
              disabled={!settingsDialog.connectionId || (isPending && busyKey === 'settings-save')}
            >
              {isPending && busyKey === 'settings-save' && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
