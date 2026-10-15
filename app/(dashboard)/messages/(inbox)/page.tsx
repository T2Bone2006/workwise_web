import { MessagesEmptyPane } from '@/components/messaging/messages-empty-pane';
import { getTextUsage } from '@/lib/data/messaging/texts';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { createClient } from '@/lib/supabase/server';

/** Nothing open yet: the right-hand side shows the texts left and the top-up packs. */
export default async function MessagesPage() {
  const tenantId = await getTenantIdForCurrentUser();
  let usage = null;
  if (tenantId) {
    const supabase = await createClient();
    usage = await getTextUsage(supabase, tenantId).catch(() => null);
  }
  return <MessagesEmptyPane usage={usage} />;
}
