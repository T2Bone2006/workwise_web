import { getSettingsPageData } from '@/lib/data/settings';
import { getBillingSummary } from '@/lib/data/billing';
import { getTenantSkills } from '@/lib/actions/skills';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { getCardPanelData } from '@/lib/data/payments/card-panel';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import { createClient } from '@/lib/supabase/server';
import { SettingsView } from '@/components/settings/settings-view';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
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
  if (products.hasRounds && data.tenantId) {
    const supabase = await createClient();
    const [roundsSettings, paymentSettings, cardPanel] = await Promise.all([
      getRoundsSettings(supabase, data.tenantId),
      getPaymentSettings(supabase, data.tenantId),
      getCardPanelData(supabase, data.tenantId),
    ]);
    rounds = { settings: roundsSettings };
    payments = { settings: paymentSettings, cardPanel };
  }

  const companyLogoUrl = data.tenant?.settings?.company?.logo_url ?? null;

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Settings"
        subtitle="Configure your company, billing, and preferences."
      />
      <SettingsView
        initialData={data}
        initialTenantSkills={initialTenantSkills}
        billing={billing}
        rounds={rounds}
        payments={payments}
        companyLogoUrl={companyLogoUrl}
        showSkills={products.isPro}
        defaultTab={raw.tab}
      />
    </div>
  );
}
