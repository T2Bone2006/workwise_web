import { redirect } from 'next/navigation';
import { MessagesWorkspace } from '@/components/messaging/messages-workspace';
import { getTextUsage, type TextUsage } from '@/lib/data/messaging/texts';
import { getThreads } from '@/lib/data/messaging/threads';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';

/**
 * The inbox: the conversation list stays put on the left while a conversation opens on the right
 * (on a phone, the list and the conversation take turns). Texts-bought sits outside this group.
 */
export default async function MessagesInboxLayout({ children }: { children: React.ReactNode }) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const supabase = await createClient();
  const [threads, usageResult] = await Promise.all([
    getThreads(supabase, tenantId, { filter: 'all' }),
    getTextUsage(supabase, tenantId).then(
      (value) => ({ usage: value, error: null as string | null }),
      (error: unknown) => ({
        usage: null as TextUsage | null,
        error: error instanceof Error ? error.message : 'Could not load texts',
      }),
    ),
  ]);

  return (
    <MessagesWorkspace threads={threads} usage={usageResult.usage} usageError={usageResult.error}>
      {children}
    </MessagesWorkspace>
  );
}
