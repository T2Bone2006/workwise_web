'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { openBillingPortal } from '@/lib/actions/billing';
import type { BillingSummary } from '@/lib/data/billing';
import { PRODUCT_LABELS } from '@/lib/stripe/products';

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  paused: 'Paused',
  manual: 'Managed by WorkWise',
};

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function SettingsBillingTab({ billing }: { billing: BillingSummary }) {
  const [pending, startTransition] = useTransition();

  const manage = () =>
    startTransition(async () => {
      const result = await openBillingPortal();
      if (result && !result.success) toast.error(result.error);
    });

  return (
    <div className="space-y-6">
      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>What your account includes and when it renews.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {billing.subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subscription on this account.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {billing.subscriptions.map((sub) => (
                <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium">{PRODUCT_LABELS[sub.product]}</p>
                    <p className="text-muted-foreground">
                      {sub.status === 'trialing' && sub.trialEndsAt
                        ? `Trial ends ${formatDate(sub.trialEndsAt)}`
                        : sub.cancelAtPeriodEnd && sub.currentPeriodEnd
                          ? `Ends ${formatDate(sub.currentPeriodEnd)}`
                          : sub.currentPeriodEnd
                            ? `Renews ${formatDate(sub.currentPeriodEnd)}`
                            : sub.source === 'manual'
                              ? 'No renewal date'
                              : ''}
                    </p>
                  </div>
                  <Badge variant={sub.status === 'past_due' || sub.status === 'unpaid' ? 'destructive' : 'secondary'}>
                    {STATUS_LABELS[sub.status] ?? sub.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          {billing.hasStripeCustomer ? (
            <Button onClick={manage} disabled={pending} variant="gradient">
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
              Manage billing
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your plan is managed by WorkWise. Contact us to make changes.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
