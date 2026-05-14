import { getSettingsPageData } from '@/lib/data/settings';
import { getTenantSkills } from '@/lib/actions/skills';
import { SettingsView } from '@/components/settings/settings-view';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function SettingsPage() {
  const data = await getSettingsPageData();
  const initialTenantSkills =
    data.tenantId != null ? await getTenantSkills(data.tenantId) : [];
  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Settings"
        subtitle="Configure your company, integrations, and preferences."
      />
      <SettingsView initialData={data} initialTenantSkills={initialTenantSkills} />
    </div>
  );
}
