import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getImportSourcesForTenant } from '@/lib/data/import-sources';
import { ImportWizard } from '@/components/import/import-wizard';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

export default async function ImportPage() {
  const tenantId = await getTenantIdForCurrentUser();
  const { sources } = await getImportSourcesForTenant(tenantId ?? '');

  if (!tenantId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is not linked to a tenant. Please contact your administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Import Jobs"
        subtitle="Upload CSV and map columns with AI or manually. Save mappings to reuse."
      />
      <ImportWizard tenantId={tenantId} initialSources={sources} />
    </div>
  );
}
