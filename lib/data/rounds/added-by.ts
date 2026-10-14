import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const A_TEAM_MEMBER = 'a team member';

/**
 * The names of the people who added customers: the team_people name first, then the worker's own name, then
 * "a team member" (someone removed keeps their name this way). Never throws: a read problem gives an empty map.
 */
export async function loadAdderNames(db: SupabaseClient, tenantId: string, workerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(workerIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const [people, workers] = await Promise.all([
      db.from('team_people').select('worker_id, name').eq('tenant_id', tenantId).in('worker_id', ids),
      db.from('workers').select('id, full_name').in('id', ids),
    ]);
    for (const w of (workers.data ?? []) as Array<{ id: string; full_name: string | null }>) if (w.full_name?.trim()) out.set(w.id, w.full_name.trim());
    for (const p of (people.data ?? []) as Array<{ worker_id: string; name: string }>) if (p.name?.trim()) out.set(p.worker_id, p.name.trim());
  } catch (err) {
    console.error('[added-by] names', err instanceof Error ? err.message : 'failed');
  }
  return out;
}

export type CustomerAddedBy = { name: string; checkedAt: string | null; addedOn: string | null };

/** Who added one customer, and whether the owner has checked them. Null for a customer the owner added themselves. */
export async function getCustomerAddedBy(tenantId: string, customerId: string): Promise<CustomerAddedBy | null> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from('customers')
      .select('added_by_worker_id, added_checked_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('id', customerId)
      .maybeSingle();
    const row = data as { added_by_worker_id: string | null; added_checked_at: string | null; created_at: string | null } | null;
    if (!row?.added_by_worker_id) return null;
    const names = await loadAdderNames(db, tenantId, [row.added_by_worker_id]);
    return { name: names.get(row.added_by_worker_id) ?? A_TEAM_MEMBER, checkedAt: row.added_checked_at, addedOn: row.created_at };
  } catch (err) {
    console.error('[added-by] customer', err instanceof Error ? err.message : 'failed');
    return null;
  }
}
