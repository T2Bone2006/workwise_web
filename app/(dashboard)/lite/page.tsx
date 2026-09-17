import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { getTenantNameForCurrentUser } from '@/lib/data/tenant';

/**
 * Lite home. Placeholder until the leads board, conversations list and widget
 * settings land (Phase 6).
 */
export default async function LiteHomePage() {
  const tenantName = await getTenantNameForCurrentUser();

  return (
    <div className="flex flex-col gap-4">
      <PageGradientHeader title="Lite" subtitle={tenantName} />
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Your chatbot leads, conversations and widget settings will appear here.
      </div>
    </div>
  );
}
