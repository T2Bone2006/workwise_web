import { Suspense } from 'react';
import { getSettingsPageData } from '@/lib/data/settings';
import { getBillingSummary, type BillingSummary } from '@/lib/data/billing';
import { getPlanSummary } from '@/lib/billing/manage';
import { getReferralData } from '@/lib/data/referral-page';
import { getTenantSkills } from '@/lib/actions/skills';
import { getTenantProducts, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { listAccess, type AccessSummary } from '@/lib/accountant/access';
import { createAdminClient } from '@/lib/supabase/admin';
import { taxYearFor } from '@/lib/books/periods';
import { todayInLondon } from '@/lib/rounds/dates';
import { getCardPanelData } from '@/lib/data/payments/card-panel';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import { goCardlessConfig, isGoCardlessConfigured } from '@/lib/gocardless/config';
import { createClient } from '@/lib/supabase/server';
import { SettingsBillingTab } from '@/components/settings/settings-billing-tab';
import { SettingsView } from '@/components/settings/settings-view';
import {
  PlanBillingLoadError,
  PlanBillingOwnerNotice,
  PlanBillingSkeleton,
  PlanBillingTab,
} from '@/components/settings/plan-billing/plan-billing-tab';
import { MessagingSectionProvider } from '@/components/settings/settings-messages-section';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; gc?: string }>;
}) {
  const raw = await searchParams;
  const [data, billing, products] = await Promise.all([
    getSettingsPageData(),
    getBillingSummary(),
    getTenantProducts(),
  ]);
  const initialTenantSkills =
    products.isPro && data.tenantId != null ? await getTenantSkills(data.tenantId) : [];

  let rounds: { settings: Awaited<ReturnType<typeof getRoundsSettings>> } | null = null;
  let payments: {
    settings: Awaited<ReturnType<typeof getPaymentSettings>>;
    cardPanel: Awaited<ReturnType<typeof getCardPanelData>>;
  } | null = null;
  let messaging: {
    settings: Omit<
      Awaited<ReturnType<typeof getMessagingSettings>>,
      'companyPhone' | 'businessName'
    >;
    companyPhone: string | null;
    businessName: string;
  } | null = null;
  if (products.hasRounds && data.tenantId) {
    const supabase = await createClient();
    const tenantId = data.tenantId;
    const [roundsSettings, paymentSettings, cardPanel, messagingSettings] = await Promise.all([
      getRoundsSettings(supabase, tenantId),
      getPaymentSettings(supabase, tenantId),
      getCardPanelData(supabase, tenantId),
      getMessagingSettings(supabase, tenantId),
    ]);
    rounds = { settings: roundsSettings };
    payments = { settings: paymentSettings, cardPanel };
    const { companyPhone, businessName, ...messageSettings } = messagingSettings;
    messaging = {
      settings: messageSettings,
      companyPhone,
      businessName,
    };
  }

  // Accountant access is for the account owner of a Rounds business only.
  let accountant: { accountants: AccessSummary[] | null; currentTaxYear: number } | null = null;
  if (products.hasRounds && data.tenantId && data.user?.role === 'admin') {
    accountant = {
      accountants: await listAccess(createAdminClient(), data.tenantId).catch(() => null),
      currentTaxYear: taxYearFor(todayInLondon()),
    };
  }

  const verifyUrl = isGoCardlessConfigured() ? goCardlessConfig().verifyUrl : null;
  const companyLogoUrl = data.tenant?.settings?.company?.logo_url ?? null;
  const selfServeBilling = isSelfServeBilling(billing, products.isPro);
  const hasRoundsAccount =
    products.hasRounds || billing.subscriptions.some((sub) => sub.product === 'rounds');
  const billingPanel =
    selfServeBilling && data.user?.role === 'admin' && data.tenantId ? (
      <Suspense fallback={<PlanBillingSkeleton />}>
        <SelfServeBilling tenantId={data.tenantId} billing={billing} />
      </Suspense>
    ) : selfServeBilling ? (
      <PlanBillingOwnerNotice />
    ) : (
      <SettingsBillingTab billing={billing} />
    );

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Settings"
        subtitle="Configure your company, billing, and preferences."
      />
      {messaging ? (
        <MessagingSectionProvider value={messaging}>
          <SettingsView
            initialData={data}
            initialTenantSkills={initialTenantSkills}
            billingPanel={billingPanel}
            selfServeBilling={selfServeBilling}
            hasRounds={hasRoundsAccount}
            rounds={rounds}
            payments={payments}
            accountant={accountant}
            companyLogoUrl={companyLogoUrl}
            showSkills={products.isPro}
            defaultTab={raw.tab}
            gc={raw.gc ?? null}
            verifyUrl={verifyUrl}
          />
        </MessagingSectionProvider>
      ) : (
        <SettingsView
          initialData={data}
          initialTenantSkills={initialTenantSkills}
          billingPanel={billingPanel}
          selfServeBilling={selfServeBilling}
          hasRounds={hasRoundsAccount}
          rounds={rounds}
          payments={payments}
          accountant={accountant}
          companyLogoUrl={companyLogoUrl}
          showSkills={products.isPro}
          defaultTab={raw.tab}
          gc={raw.gc ?? null}
          verifyUrl={verifyUrl}
        />
      )}
    </div>
  );
}

/** Pro and hand-set-up businesses stay on the managed billing tab. */
function isSelfServeBilling(billing: BillingSummary, isPro: boolean): boolean {
  if (isPro) return false;
  if (!billing.hasStripeCustomer) return false;
  const proTiers = new Set<string>(PRO_TIER_PRODUCTS);
  return !billing.subscriptions.some((sub) => sub.source === 'manual' || proTiers.has(sub.product));
}

async function SelfServeBilling({ tenantId, billing }: { tenantId: string; billing: BillingSummary }) {
  let summary: Awaited<ReturnType<typeof getPlanSummary>> | null = null;
  try {
    summary = await getPlanSummary(tenantId);
  } catch (err) {
    console.error('[billing] summary', err instanceof Error ? err.name : 'Error');
  }
  if (!summary) return <PlanBillingLoadError />;
  if (summary.kind === 'managed') return <SettingsBillingTab billing={billing} />;
  const referral = summary.kind === 'stripe' ? await getReferralData(tenantId, summary.choice.plan) : null;
  return <PlanBillingTab summary={summary} referral={referral} />;
}
