import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { employeeFeatures, getTenantFeatures, withWorkerBlock } from '@/lib/data/tenant-features';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { getWorkerLiteOffer } from '@/lib/data/worker-lite-offer';
import { getUnreadThreadCount } from '@/lib/data/messaging/threads';
import { getNetworkNotificationCounts } from '@/lib/data/network';
import { addLiteInterval, shouldShowAddLite } from '@/lib/data/add-lite-nudge';
import { referralKind } from '@/lib/data/referral-nudge';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isPaymentOverdue } from '@/lib/billing/pro-restart-core';
import { getTenantLook } from '@/lib/data/tenant-look';
import { getWorkerRoundsExtras } from '@/lib/data/worker/rounds-extras';
import { isAdmin } from '@/lib/utils/admin';
import { getViewAsState, recoverAbandonedViewAsIfNeeded } from '@/lib/impersonation/session';

/** Amber banner for a Stripe-billed row that is past_due, Pro tiers included. Manual (hand-run) accounts never see it. */
async function paymentOverdue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string | null,
): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const [{ data, error }, { data: tenant, error: tenantError }] = await Promise.all([
      supabase.from('subscriptions').select('status, source, product').eq('tenant_id', tenantId),
      supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
    ]);
    if (error || tenantError) return false;
    return isPaymentOverdue(data, Boolean(tenant?.stripe_customer_id));
  } catch (err) {
    console.error('[overdue]', err instanceof Error ? err.name : 'Error');
    return false;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>();

  if (profile?.role === 'customer_portal') {
    redirect('/portal');
  }

  // An employee (a worker with no business of their own) gets the frame with the worker area
  // only. They are never given their employer's features, which would show the office links,
  // and the worker area is always the new look whatever the employer's look is.
  if (profile?.role === 'worker') {
    const [link, roundsExtras] = await Promise.all([getWorkerLink(), getWorkerRoundsExtras()]);
    return (
      <DashboardShell
        tenantName={link?.employerName ?? 'WorkWise'}
        userEmail={user.email ?? undefined}
        features={employeeFeatures(link?.employerName ?? null, roundsExtras.employerIsRounds)}
        look="new"
      >
        {children}
      </DashboardShell>
    );
  }

  await recoverAbandonedViewAsIfNeeded();

  const [tenantName, admin, tenantId, baseFeatures, viewAs, products, showAddLite, referralKindNow] = await Promise.all([
    getTenantNameForCurrentUser(),
    isAdmin(),
    getTenantIdForCurrentUser(),
    getTenantFeatures(),
    getViewAsState(),
    getTenantProducts(),
    shouldShowAddLite(),
    referralKind(),
  ]);
  // A self-employed worker keeps their own business's blocks and gains a 'Work for …' block.
  // Only asked of logins with no Pro or Rounds plan, so offices and Rounds traders pay nothing extra.
  const workerLink = !products.isPro && !products.hasRounds ? await getWorkerLink() : null;
  const features = workerLink ? withWorkerBlock(baseFeatures, workerLink.employerName) : baseFeatures;
  const workerLite = workerLink && !products.hasLite ? Boolean(await getWorkerLiteOffer()) : false;

  const addLiteYearly = showAddLite && (await addLiteInterval()) === 'year';

  // TODO: route protection — add per-page checks instead (layout has no pathname access in this codebase)

  const [networkCounts, messagesBadge] = await Promise.all([
    tenantId ? getNetworkNotificationCounts(tenantId) : Promise.resolve(null),
    tenantId && products.hasRounds
      ? getUnreadThreadCount(supabase, tenantId)
      : Promise.resolve(undefined),
  ]);
  const networkBadge = networkCounts
    ? networkCounts.pendingConnections + networkCounts.inboxJobs
    : undefined;
  const overdue = await paymentOverdue(supabase, tenantId);
  const look = await getTenantLook(products);

  return (
    <DashboardShell
      tenantName={tenantName}
      userEmail={user.email ?? undefined}
      isAdmin={admin}
      networkBadge={networkBadge}
      messagesBadge={messagesBadge}
      features={features}
      viewAsTenantName={viewAs.active ? viewAs.tenantName : null}
      look={look}
      showAddLite={showAddLite}
      addLiteYearly={addLiteYearly}
      showReferral={referralKindNow !== null}
      referralKind={referralKindNow ?? 'rounds_lite'}
      workerLite={workerLite}
      overdue={overdue}
      assistant={
        // Pro offices get Lily once their dashboard is on the new look; RS Locksmiths stay as they are until then.
        (products.isPro ? look === 'new' : products.hasRounds || products.hasLite)
          ? { hasRounds: products.hasRounds, hasLite: products.hasLite, hasPro: products.isPro }
          : null
      }
    >
      {children}
    </DashboardShell>
  );
}
