import 'server-only';

import { cache } from 'react';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserRow } from '@/lib/data/tenant';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { isWebsiteStatus, type WebsiteStatus } from '@/lib/website-offer';

type SubRow = { product: string | null; source: string | null; status: string | null };

export type WebsiteEligible = { tenantId: string; userId: string };

/**
 * A paying Lite customer who owns the account: a live Stripe `lite` row, an admin login, not closed, and nothing
 * hand-set-up (so RS Locksmiths, Eden's own account and test businesses never see the card). Any failure means
 * not eligible; the page must keep working.
 */
export const getWebsiteEligible = cache(async (): Promise<WebsiteEligible | null> => {
  try {
    const { user, error: authError } = await getAuthUser();
    if (authError || !user?.id) return null;
    const row = await getCurrentUserRow();
    if (row?.role !== 'admin' || typeof row.tenant_id !== 'string' || row.tenant_id === '') return null;

    const supabase = await createClient();
    const [{ data: tenant, error: tenantError }, { data: subs, error: subsError }] = await Promise.all([
      supabase.from('tenants').select('closed_at').eq('id', row.tenant_id).maybeSingle(),
      supabase.from('subscriptions').select('product, source, status').eq('tenant_id', row.tenant_id),
    ]);
    if (tenantError || !tenant || tenant.closed_at) return null;
    if (subsError || !subs) return null;

    const rows = subs as SubRow[];
    if (rows.some((r) => r.source === 'manual')) return null;
    const entitled = new Set<string>(ENTITLED_STATUSES);
    const liveLite = rows.some(
      (r) => r.product === 'lite' && r.source === 'stripe' && r.status != null && entitled.has(r.status),
    );
    if (!liveLite) return null;
    return { tenantId: row.tenant_id, userId: user.id };
  } catch (err) {
    console.error('[website-offer]', err instanceof Error ? err.name : 'Error');
    return null;
  }
});

export type WebsiteCardState =
  | { kind: 'ask' }
  | { kind: 'working'; status: 'needs' | 'building' }
  | { kind: 'live'; liveUrl: string | null };

/**
 * What the Lite pages show: null (nothing), the question, or where their free website has got to. Reads the owner's
 * table with the service role, scoped to the session's own business. If the table is not there yet, show nothing.
 */
export const getWebsiteCard = cache(async (): Promise<WebsiteCardState | null> => {
  const eligible = await getWebsiteEligible();
  if (!eligible) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('website_requests')
      .select('status, live_url')
      .eq('tenant_id', eligible.tenantId)
      .maybeSingle();
    if (error) return null;
    if (!data) return { kind: 'ask' };
    const status = (data as { status?: unknown }).status;
    if (!isWebsiteStatus(status)) return null;
    const liveUrl = (data as { live_url?: unknown }).live_url;
    return cardFor(status, typeof liveUrl === 'string' && liveUrl.trim() ? liveUrl.trim() : null);
  } catch {
    return null;
  }
});

function cardFor(status: WebsiteStatus, liveUrl: string | null): WebsiteCardState | null {
  if (status === 'needs' || status === 'building') return { kind: 'working', status };
  if (status === 'done') return { kind: 'live', liveUrl };
  return null; // has_one, taken_down: nothing to show
}
