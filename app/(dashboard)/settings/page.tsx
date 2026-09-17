import { getSettingsPageData } from '@/lib/data/settings';
import { getBillingSummary } from '@/lib/data/billing';
import { getTenantSkills } from '@/lib/actions/skills';
import { SettingsView } from '@/components/settings/settings-view';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function SettingsPage() {
  const [data, billing] = await Promise.all([getSettingsPageData(), getBillingSummary()]);
  const initialTenantSkills =
    data.tenantId != null ? await getTenantSkills(data.tenantId) : [];
  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Settings"
        subtitle="Configure your company, billing, and preferences."
      />
      <SettingsView initialData={data} initialTenantSkills={initialTenantSkills} billing={billing} />
    </div>
  );
}
