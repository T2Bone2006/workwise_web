import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CircleCheck, CircleX } from 'lucide-react';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { IconChip } from '@/components/look';
import { Button } from '@/components/ui/button';
import { getTextUsage } from '@/lib/data/messaging/texts';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';

export default async function TextsBoughtPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; cancelled?: string }>;
}) {
  const products = await getTenantProducts();
  if (!products.hasRounds && !products.hasLite) redirect('/dashboard');
  const backHref = products.hasRounds ? '/messages' : '/lite/widget#texts';
  const backLabel = products.hasRounds ? 'Back to messages' : 'Back';

  const params = await searchParams;
  const cancelled = params.cancelled === '1';
  const sessionId = params.session_id?.trim() || null;
  const userAgent = (await headers()).get('user-agent') ?? '';
  const phoneBrowser = /Android|iPhone|iPad|Mobile/i.test(userAgent);

  let usage: Awaited<ReturnType<typeof getTextUsage>> | null = null;
  if (sessionId) {
    const tenantId = await getTenantIdForCurrentUser();
    if (tenantId) {
      const supabase = await createClient();
      usage = await getTextUsage(supabase, tenantId);
    }
  }

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Texts"
        subtitle={cancelled ? 'No charge made.' : sessionId ? 'Your payment went through.' : undefined}
      />
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 shadow-(--look-card-shadow) sm:p-8">
        <div className="flex items-start gap-4">
          <IconChip icon={cancelled ? CircleX : CircleCheck} tone={cancelled ? 'slate' : 'emerald'} />
          <div className="min-w-0 flex-1 space-y-3">
            {cancelled ? (
              <>
                <h2 className="text-lg font-semibold tracking-tight">No charge made</h2>
                <p className="text-sm text-muted-foreground">You can buy texts any time from Messages.</p>
              </>
            ) : sessionId ? (
              <>
                <h2 className="text-lg font-semibold tracking-tight">Thanks, your texts are being added</h2>
                <p className="text-sm text-muted-foreground">
                  They usually show up within a minute. Refresh if the numbers below haven&apos;t moved yet.
                </p>
                {usage ? (
                  <dl className="grid grid-cols-3 gap-3 rounded-xl bg-muted/50 p-3 text-center">
                    <div>
                      <dd className="text-xl font-semibold tabular-nums">{usage.freeUsed}</dd>
                      <dt className="text-xs text-muted-foreground">Used this month</dt>
                    </div>
                    <div>
                      <dd className="text-xl font-semibold tabular-nums">{usage.freeLeft}</dd>
                      <dt className="text-xs text-muted-foreground">Free left</dt>
                    </div>
                    <div>
                      <dd className="text-xl font-semibold tabular-nums text-(--tone-emerald-solid)">{usage.packLeft}</dd>
                      <dt className="text-xs text-muted-foreground">Bought left</dt>
                    </div>
                  </dl>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/messages/texts-bought?session_id=${encodeURIComponent(sessionId)}`}>Refresh</Link>
                </Button>
              </>
            ) : (
              <h2 className="text-lg font-semibold tracking-tight">Texts</h2>
            )}
            {phoneBrowser ? (
              <p className="text-sm text-muted-foreground">You can go back to the WorkWise app now.</p>
            ) : null}
            <div>
              <Button asChild>
                <Link href={backHref}>{backLabel}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
