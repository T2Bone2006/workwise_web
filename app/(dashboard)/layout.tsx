import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import {
  getCurrentUserRow,
  getTenantIdForCurrentUser,
  getTenantNameForCurrentUser,
} from '@/lib/data/tenant';
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

  const profile = await getCurrentUserRow();

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

  // One batch: the badge and overdue reads only need the tenant id, so they start with
  // everything else instead of waiting for it in later rounds.
  const tenantIdPromise = getTenantIdForCurrentUser();
  const productsPromise = getTenantProducts();
  const [
    tenantName,
    admin,
    baseFeatures,
    viewAs,
    products,
    showAddLite,
    referralKindNow,
    networkCounts,
    messagesBadge,
    overdue,
  ] = await Promise.all([
    getTenantNameForCurrentUser(),
    isAdmin(),
    getTenantFeatures(),
    getViewAsState(),
    productsPromise,
    shouldShowAddLite(),
    referralKind(),
    tenantIdPromise.then((id) => (id ? getNetworkNotificationCounts(id) : null)),
    Promise.all([tenantIdPromise, productsPromise]).then(([id, p]) =>
      id && p.hasRounds ? getUnreadThreadCount(supabase, id) : undefined,
    ),
    tenantIdPromise.then((id) => paymentOverdue(supabase, id)),
  ]);
  // A self-employed worker keeps their own business's blocks and gains a 'Work for …' block.
  // Only asked of logins with no Pro or Rounds plan, so offices and Rounds traders pay nothing extra.
  const workerLink = !products.isPro && !products.hasRounds ? await getWorkerLink() : null;
  const features = workerLink ? withWorkerBlock(baseFeatures, workerLink.employerName) : baseFeatures;
  const [workerLite, addLiteYearly, look] = await Promise.all([
    workerLink && !products.hasLite ? getWorkerLiteOffer().then(Boolean) : false,
    showAddLite ? addLiteInterval().then((interval) => interval === 'year') : false,
    getTenantLook(products),
  ]);

  // TODO: route protection — add per-page checks instead (layout has no pathname access in this codebase)

  const networkBadge = networkCounts
    ? networkCounts.pendingConnections + networkCounts.inboxJobs
    : undefined;

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
