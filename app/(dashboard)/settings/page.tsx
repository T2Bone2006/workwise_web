import { getSettingsPageData } from '@/lib/data/settings';
import { getBillingSummary } from '@/lib/data/billing';
import { getTenantSkills } from '@/lib/actions/skills';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { getCardPanelData } from '@/lib/data/payments/card-panel';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import { goCardlessConfig, isGoCardlessConfigured } from '@/lib/gocardless/config';
import { createClient } from '@/lib/supabase/server';
import { SettingsView } from '@/components/settings/settings-view';
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

  const verifyUrl = isGoCardlessConfigured() ? goCardlessConfig().verifyUrl : null;
  const companyLogoUrl = data.tenant?.settings?.company?.logo_url ?? null;

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
            billing={billing}
            rounds={rounds}
            payments={payments}
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
          billing={billing}
          rounds={rounds}
          payments={payments}
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
