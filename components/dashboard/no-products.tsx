import Link from 'next/link';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

/**
 * Shown when a login belongs to a tenant with no entitled subscription
 * (trial expired and not paid, cancelled, or never provisioned).
 */
export function NoProducts({ tenantName }: { tenantName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageGradientHeader title="Dashboard" subtitle={tenantName} />
      <div className="rounded-xl border border-border bg-card p-6 text-sm">
        <p className="font-medium">Your account doesn&apos;t have an active subscription.</p>
        <p className="mt-1 text-muted-foreground">
          Manage billing in{' '}
          <Link href="/settings" className="underline underline-offset-2">
            Settings
          </Link>
          , or contact us if you think this is a mistake.
        </p>
      </div>
    </div>
  );
}
