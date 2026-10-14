import type { SupabaseClient } from '@supabase/supabase-js';
import { londonDateOf } from '@/lib/books/periods';
import { compareYmd, diffDays, todayInLondon, type Ymd } from '@/lib/rounds/dates';

/**
 * Cash hand-in (D10): the owner sees what each person is holding and ticks payments as handed over. The customer is
 * paid already; ticking only moves the cash into the owner's books (step 17), dated the hand-in day.
 * Takes the SERVICE-ROLE client. The SQL functions that write are service-role only and re-check the business.
 */

export type HeldGroupItem = {
  paymentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  method: 'cash' | 'cheque';
  receivedAt: string;
  visitTitle: string | null;
  ageDays: number;
};
export type HeldGroup = {
  /** workers.id, or null when the collector's worker row no longer exists (the name is on the payment). */
  workerId: string | null;
  name: string;
  total: number;
  count: number;
  oldestAgeDays: number;
  items: HeldGroupItem[];
};

type Row = {
  id: string;
  customer_id: string | null;
  amount: number | string;
  method: string;
  received_at: string;
  applies_to_job_id: string | null;
  collected_by_worker_id: string | null;
  collected_by_name: string | null;
  handed_over_at: string | null;
};

const COLUMNS =
  'id, customer_id, amount, method, received_at, applies_to_job_id, collected_by_worker_id, collected_by_name, handed_over_at';
const UNDO_DAYS = 14;

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function names(db: SupabaseClient, tenantId: string, rows: Row[]) {
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((id): id is string => Boolean(id)))];
  const jobIds = [...new Set(rows.map((r) => r.applies_to_job_id).filter((id): id is string => Boolean(id)))];
  const workerIds = [...new Set(rows.map((r) => r.collected_by_worker_id).filter((id): id is string => Boolean(id)))];
  const [customers, jobs, people] = await Promise.all([
    customerIds.length ? db.from('customers').select('id, name').eq('tenant_id', tenantId).in('id', customerIds) : Promise.resolve({ data: [] as unknown[] }),
    jobIds.length ? db.from('jobs').select('id, job_description').eq('tenant_id', tenantId).in('id', jobIds) : Promise.resolve({ data: [] as unknown[] }),
    workerIds.length ? db.from('team_people').select('worker_id, name').eq('tenant_id', tenantId).in('worker_id', workerIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  return {
    customer: new Map(((customers.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name])),
    title: new Map(((jobs.data ?? []) as Array<{ id: string; job_description: string | null }>).map((j) => [j.id, (j.job_description ?? '').split('\n')[0]!.trim() || null])),
    person: new Map(((people.data ?? []) as Array<{ worker_id: string; name: string }>).map((p) => [p.worker_id, p.name])),
  };
}

/** All held cash, grouped by who is holding it, oldest first. Throws if it cannot be read (the screen shows "couldn't load"). */
export async function listHeldCash(db: SupabaseClient, tenantId: string, today: Ymd = todayInLondon()): Promise<HeldGroup[]> {
  const { data, error } = await db
    .from('payments')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .is('handed_over_at', null)
    .or('collected_by_worker_id.not.is.null,collected_by_name.not.is.null')
    .order('received_at', { ascending: true })
    .limit(1000);
  if (error || !Array.isArray(data)) {
    console.error('[hand-in] list:', error?.message);
    throw new Error('Could not load the cash.');
  }
  const rows = data as Row[];
  const lookup = await names(db, tenantId, rows);

  const groups = new Map<string, HeldGroup>();
  for (const r of rows) {
    const key = r.collected_by_worker_id ?? `name:${r.collected_by_name ?? ''}`;
    const group = groups.get(key) ?? {
      workerId: r.collected_by_worker_id,
      name: (r.collected_by_worker_id && lookup.person.get(r.collected_by_worker_id)) || r.collected_by_name || 'A team member',
      total: 0,
      count: 0,
      oldestAgeDays: 0,
      items: [],
    };
    const ageDays = Math.max(0, diffDays(londonDateOf(r.received_at), today));
    group.items.push({
      paymentId: r.id,
      customerId: r.customer_id ?? '',
      customerName: (r.customer_id && lookup.customer.get(r.customer_id)) || 'Customer',
      amount: num(r.amount),
      method: r.method === 'cheque' ? 'cheque' : 'cash',
      receivedAt: r.received_at,
      visitTitle: (r.applies_to_job_id && lookup.title.get(r.applies_to_job_id)) || null,
      ageDays,
    });
    group.total = Math.round((group.total + num(r.amount)) * 100) / 100;
    group.count += 1;
    group.oldestAgeDays = Math.max(group.oldestAgeDays, ageDays);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.oldestAgeDays - a.oldestAgeDays || a.name.localeCompare(b.name));
}

/** The latest hand-ins (for the Recently handed in list and Undo). */
export async function recentHandIns(
  db: SupabaseClient,
  tenantId: string,
  limit = 10,
): Promise<Array<{ paymentId: string; collectorName: string; customerName: string; amount: number; handedOverAt: string }>> {
  const { data, error } = await db
    .from('payments')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .not('handed_over_at', 'is', null)
    .order('handed_over_at', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  const rows = data as Row[];
  const lookup = await names(db, tenantId, rows);
  return rows.map((r) => ({
    paymentId: r.id,
    collectorName: (r.collected_by_worker_id && lookup.person.get(r.collected_by_worker_id)) || r.collected_by_name || 'A team member',
    customerName: (r.customer_id && lookup.customer.get(r.customer_id)) || 'Customer',
    amount: num(r.amount),
    handedOverAt: r.handed_over_at as string,
  }));
}

type Outcome = { ok: true; changed: number } | { ok: false; error: string };

/** Checks the date the owner gave and turns it into the instant stored (noon UTC that day, inside the London day). */
function handOverInstant(on: Ymd | undefined, latestReceived: Ymd | null, today: Ymd): { ok: true; at: string | undefined } | { ok: false; error: string } {
  if (!on) return { ok: true, at: undefined };
  if (compareYmd(on, today) > 0) return { ok: false, error: 'That date is in the future.' };
  if (latestReceived && compareYmd(on, latestReceived) < 0) return { ok: false, error: 'That date is before the cash was taken.' };
  return { ok: true, at: `${on}T12:00:00.000Z` };
}

export async function markHandedOver(
  db: SupabaseClient,
  p: { tenantId: string; paymentIds: string[]; userId: string; handedOverOn?: Ymd; today?: Ymd },
): Promise<Outcome> {
  const ids = [...new Set(p.paymentIds)];
  if (ids.length === 0 || ids.length > 200) return { ok: false, error: 'Pick between 1 and 200 payments.' };

  const { data, error } = await db.from('payments').select('id, received_at').eq('tenant_id', p.tenantId).in('id', ids);
  if (error || !Array.isArray(data)) return { ok: false, error: 'Could not tick those. Try again.' };
  const latest = (data as Array<{ received_at: string }>).map((r) => londonDateOf(r.received_at)).sort(compareYmd).pop() ?? null;
  const instant = handOverInstant(p.handedOverOn, latest, p.today ?? todayInLondon());
  if (!instant.ok) return instant;

  const { data: changed, error: rpcError } = await db.rpc('mark_payments_handed_over', {
    p_tenant_id: p.tenantId,
    p_payment_ids: ids,
    p_user_id: p.userId,
    ...(instant.at ? { p_at: instant.at } : {}),
  });
  if (rpcError) {
    console.error('[hand-in] mark:', rpcError.message);
    return { ok: false, error: 'Could not tick those. Try again.' };
  }
  return { ok: true, changed: num(changed) };
}

export async function clearWorkerCash(
  db: SupabaseClient,
  p: { tenantId: string; workerId: string; userId: string; handedOverOn?: Ymd; today?: Ymd },
): Promise<Outcome> {
  const { data, error } = await db
    .from('payments')
    .select('received_at')
    .eq('tenant_id', p.tenantId)
    .eq('status', 'active')
    .eq('collected_by_worker_id', p.workerId)
    .is('handed_over_at', null);
  if (error || !Array.isArray(data)) return { ok: false, error: 'Could not tick those. Try again.' };
  const latest = (data as Array<{ received_at: string }>).map((r) => londonDateOf(r.received_at)).sort(compareYmd).pop() ?? null;
  const instant = handOverInstant(p.handedOverOn, latest, p.today ?? todayInLondon());
  if (!instant.ok) return instant;

  const { data: changed, error: rpcError } = await db.rpc('mark_worker_cash_handed_over', {
    p_tenant_id: p.tenantId,
    p_worker_id: p.workerId,
    p_user_id: p.userId,
    ...(instant.at ? { p_at: instant.at } : {}),
  });
  if (rpcError) {
    console.error('[hand-in] clear:', rpcError.message);
    return { ok: false, error: 'Could not tick those. Try again.' };
  }
  return { ok: true, changed: num(changed) };
}

/** Un-tick a payment ticked by mistake: back to held, out of the books. Within 14 days of the hand-in. */
export async function undoHandOver(
  db: SupabaseClient,
  p: { tenantId: string; paymentId: string; now?: Date },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('payments')
    .select('id, handed_over_at')
    .eq('id', p.paymentId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (error) return { ok: false, error: 'Could not undo that. Try again.' };
  const row = data as { handed_over_at: string | null } | null;
  if (!row || !row.handed_over_at) return { ok: false, error: 'Not found.' };
  const age = (p.now ?? new Date()).getTime() - new Date(row.handed_over_at).getTime();
  if (age > UNDO_DAYS * 86_400_000) return { ok: false, error: 'Too old to undo.' };

  const { data: changed, error: rpcError } = await db.rpc('unmark_payment_handed_over', {
    p_tenant_id: p.tenantId,
    p_payment_id: p.paymentId,
  });
  if (rpcError) {
    console.error('[hand-in] undo:', rpcError.message);
    return { ok: false, error: 'Could not undo that. Try again.' };
  }
  return changed === true ? { ok: true } : { ok: false, error: 'Not found.' };
}
