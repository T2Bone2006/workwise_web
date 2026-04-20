import { getSettingsPageData } from '@/lib/data/settings';
import { SettingsView } from '@/components/settings/settings-view';

export default async function SettingsPage() {
  const data = await getSettingsPageData();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure your company, integrations, and preferences.
        </p>
      </div>
      <SettingsView initialData={data} />
    </div>
  );
}
