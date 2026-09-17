import { PageGradientHeader } from '@/components/layout/page-gradient-header';

/**
 * Rounds home. Placeholder until today's stops, unpaid totals, and the
 * needs-attention inbox are built (Phase 1 onwards).
 */
export function RoundsHome({ tenantName }: { tenantName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageGradientHeader title="Rounds" subtitle={tenantName} />
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Today&apos;s round, customers, payments and bank matching will appear here.
      </div>
    </div>
  );
}
