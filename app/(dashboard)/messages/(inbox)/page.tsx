import { MessagesEmptyPane } from '@/components/messaging/messages-empty-pane';
import { getNotDelivered } from '@/lib/data/messaging/not-delivered';
import { getTextsStatus } from '@/lib/data/messaging/texts-status';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { createClient } from '@/lib/supabase/server';

/** Nothing open yet: the right-hand side shows the texts left and the top-up packs. */
export default async function MessagesPage() {
  const tenantId = await getTenantIdForCurrentUser();
  let usage = null;
  let notDelivered: Awaited<ReturnType<typeof getNotDelivered>> = [];
  if (tenantId) {
    const supabase = await createClient();
    usage = await getTextsStatus(supabase, tenantId).catch(() => null);
    notDelivered = await getNotDelivered(supabase, tenantId).catch(() => []);
  }
  return <MessagesEmptyPane usage={usage} notDelivered={notDelivered} />;
}
