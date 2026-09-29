import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
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
  if (!products.hasRounds) redirect('/dashboard');

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
        subtitle={cancelled ? 'No charge made.' : sessionId ? 'Thanks — your texts are being added' : undefined}
      />
      <div className="space-y-4 rounded-xl border border-border/80 px-6 py-8">
        {cancelled ? (
          <p className="text-sm">No charge made.</p>
        ) : sessionId ? (
          <div className="space-y-3">
            <p className="text-sm">Thanks — your texts are being added</p>
            {usage ? (
              <ul className="text-sm text-muted-foreground">
                <li>Used this month: {usage.freeUsed}</li>
                <li>Free left: {usage.freeLeft}</li>
                <li>Bought left: {usage.packLeft}</li>
              </ul>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/messages/texts-bought?session_id=${encodeURIComponent(sessionId)}`}>Refresh</Link>
            </Button>
          </div>
        ) : null}
        {phoneBrowser ? (
          <p className="text-sm text-muted-foreground">You can go back to the WorkWise app now.</p>
        ) : null}
        <Button asChild variant="gradient">
          <Link href="/messages">Back to messages</Link>
        </Button>
      </div>
    </div>
  );
}
