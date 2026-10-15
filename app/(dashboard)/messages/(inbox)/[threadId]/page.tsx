import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshAfterRead } from '@/components/messaging/refresh-after-read';
import { ThreadView } from '@/components/messaging/thread-view';
import { markThreadReadAction } from '@/lib/actions/messaging';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { getThread } from '@/lib/data/messaging/threads';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { createClient } from '@/lib/supabase/server';

interface ThreadPageProps {
  params: Promise<{ threadId: string }>;
}

export default async function MessageThreadPage({ params }: ThreadPageProps) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const { threadId } = await params;
  const supabase = await createClient();
  const detail = await getThread(supabase, tenantId, threadId);
  if (!detail) notFound();

  await markThreadReadAction(threadId);

  const settings = await getMessagingSettings(supabase, tenantId);
  const brand = {
    businessName: settings.businessName,
    contactPhone: settings.contact_phone ?? normalizeUkPhoneE164(settings.companyPhone),
  };

  return (
    <div className="space-y-4">
      <RefreshAfterRead unread={detail.thread.unread} />
      <div className="lg:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/messages">
            <ArrowLeft className="size-4" />
            All messages
          </Link>
        </Button>
      </div>
      <ThreadView detail={detail} brand={brand} />
    </div>
  );
}
