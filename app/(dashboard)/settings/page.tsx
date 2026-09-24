import { getSettingsPageData } from '@/lib/data/settings';
import { getBillingSummary } from '@/lib/data/billing';
import { getTenantSkills } from '@/lib/actions/skills';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { createClient } from '@/lib/supabase/server';
import { SettingsView } from '@/components/settings/settings-view';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function SettingsPage() {
  const [data, billing, products] = await Promise.all([
    getSettingsPageData(),
    getBillingSummary(),
    getTenantProducts(),
  ]);
  const initialTenantSkills =
    products.isPro && data.tenantId != null ? await getTenantSkills(data.tenantId) : [];

  let rounds: { settings: Awaited<ReturnType<typeof getRoundsSettings>> } | null = null;
  if (products.hasRounds && data.tenantId) {
    const supabase = await createClient();
    rounds = { settings: await getRoundsSettings(supabase, data.tenantId) };
  }

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
        showSkills={products.isPro}
      />
    </div>
  );
}
