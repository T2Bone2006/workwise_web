import type { SupabaseClient } from '@supabase/supabase-js';
import { afterManualPayment } from '@/lib/payments/notify';
import { recordPaymentCore, type MoneyResult } from '@/lib/payments/money-core';
import { addDays, todayInLondon } from '@/lib/rounds/dates';

/**
 * A member of staff's cash (D10): what they are holding for the owner, and recording a payment they took. They can see
 * their OWN payments only; they cannot hand anything over, void or change one (the owner does that).
 */

export type HeldItem = {
  paymentId: string;
  customerName: string;
  amount: number;
  method: 'cash' | 'cheque';
  receivedAt: string;
  visitTitle: string | null;
};
export type StaffCash = {
  held: HeldItem[];
  heldTotal: number;
  recentlyHandedOver: Array<{ amount: number; customerName: string; handedOverAt: string }>;
};

type PaymentRow = {
  id: string;
  customer_id: string | null;
  amount: number | string;
  method: string;
  received_at: string;
  applies_to_job_id: string | null;
  handed_over_at: string | null;
};

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function getStaffCash(db: SupabaseClient, p: { tenantId: string; workerId: string }): Promise<StaffCash> {
  const { data, error } = await db
    .from('payments')
    .select('id, customer_id, amount, method, received_at, applies_to_job_id, handed_over_at')
    .eq('tenant_id', p.tenantId)
    .eq('status', 'active')
    .eq('collected_by_worker_id', p.workerId)
    .order('received_at', { ascending: false })
    .limit(200);
  if (error || !Array.isArray(data)) {
    console.error('[staff-cash] read:', error?.message);
    throw new Error('Could not load your cash.');
  }
  const rows = data as PaymentRow[];

  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((id): id is string => Boolean(id)))];
  const jobIds = [...new Set(rows.map((r) => r.applies_to_job_id).filter((id): id is string => Boolean(id)))];
  const [customers, jobs] = await Promise.all([
    customerIds.length ? db.from('customers').select('id, name').eq('tenant_id', p.tenantId).in('id', customerIds) : Promise.resolve({ data: [] as unknown[] }),
    jobIds.length ? db.from('jobs').select('id, job_description').eq('tenant_id', p.tenantId).in('id', jobIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const names = new Map(((customers.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const titles = new Map(
    ((jobs.data ?? []) as Array<{ id: string; job_description: string | null }>).map((j) => [j.id, (j.job_description ?? '').split('\n')[0]!.trim() || null]),
  );

  const held: HeldItem[] = rows
    .filter((r) => !r.handed_over_at)
    .map((r) => ({
      paymentId: r.id,
      customerName: (r.customer_id && names.get(r.customer_id)) || 'Customer',
      amount: num(r.amount),
      method: r.method === 'cheque' ? ('cheque' as const) : ('cash' as const),
      receivedAt: r.received_at,
      visitTitle: (r.applies_to_job_id && titles.get(r.applies_to_job_id)) || null,
    }));
  const recentlyHandedOver = rows
    .filter((r) => r.handed_over_at)
    .sort((a, b) => (b.handed_over_at ?? '').localeCompare(a.handed_over_at ?? ''))
    .slice(0, 10)
    .map((r) => ({ amount: num(r.amount), customerName: (r.customer_id && names.get(r.customer_id)) || 'Customer', handedOverAt: r.handed_over_at as string }));

  return { held, heldTotal: held.reduce((sum, h) => sum + h.amount, 0), recentlyHandedOver };
}

export const MAX_STAFF_PAYMENT = 1000;
const OWN_CUSTOMER_DAYS = 90;

/** Record cash or a cheque taken from one of their own customers. Held by them until the owner ticks it handed over. */
export async function recordStaffPayment(
  db: SupabaseClient,
  p: {
    tenantId: string;
    workerId: string;
    name: string;
    userId: string;
    customerId: string;
    amount: number;
    method: 'cash' | 'cheque';
    appliesToJobId?: string | null;
    clientMutationId?: string | null;
    today?: string;
  },
): Promise<MoneyResult<{ paymentId: string; duplicate: boolean }>> {
  if (!(p.amount >= 0.01) || p.amount > MAX_STAFF_PAYMENT) {
    return { success: false, error: `Enter an amount between £0.01 and £${MAX_STAFF_PAYMENT.toLocaleString('en-GB')}.` };
  }

  // Only from a customer who is on one of their visits (open, or done in the last 90 days).
  const since = addDays(p.today ?? todayInLondon(), -OWN_CUSTOMER_DAYS);
  const { data: own, error: ownError } = await db
    .from('jobs')
    .select('id')
    .eq('tenant_id', p.tenantId)
    .eq('assigned_worker_id', p.workerId)
    .eq('customer_id', p.customerId)
    .gte('scheduled_date', since)
    .limit(1);
  if (ownError) return { success: false, error: 'Could not record the payment.', retryable: true };
  if (!Array.isArray(own) || own.length === 0) {
    return { success: false, error: 'You can only take payment from your own customers.' };
  }

  if (p.appliesToJobId) {
    const { data: job } = await db
      .from('jobs')
      .select('id, assigned_worker_id, customer_id')
      .eq('id', p.appliesToJobId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    const row = job as { assigned_worker_id: string | null; customer_id: string | null } | null;
    if (!row || row.assigned_worker_id !== p.workerId || row.customer_id !== p.customerId) {
      return { success: false, error: 'You can only take payment from your own customers.' };
    }
  }

  const result = await recordPaymentCore(db, {
    tenantId: p.tenantId,
    customerId: p.customerId,
    amount: p.amount,
    method: p.method,
    appliesToJobId: p.appliesToJobId ?? null,
    clientMutationId: p.clientMutationId ?? null,
    userId: p.userId,
    collectedBy: { workerId: p.workerId, name: p.name },
  });
  if (result.success) {
    await afterManualPayment(db, { tenantId: p.tenantId, paymentId: result.paymentId, duplicate: result.duplicate });
  }
  return result;
}

/** A customer a member of staff may look at: one on their visits. Null otherwise (the route answers 404). */
export async function getStaffCustomer(
  db: SupabaseClient,
  p: { tenantId: string; workerId: string; customerId: string },
): Promise<{
  id: string; name: string; phone: string | null; email: string | null;
  address: string; postcode: string; accessNotes: string | null; customerOwes: number;
} | null> {
  const { data: jobs } = await db
    .from('jobs')
    .select('id, address, postcode, scheduled_date')
    .eq('tenant_id', p.tenantId)
    .eq('assigned_worker_id', p.workerId)
    .eq('customer_id', p.customerId)
    .order('scheduled_date', { ascending: false })
    .limit(1);
  const latest = ((jobs ?? []) as Array<{ address: string | null; postcode: string | null }>)[0];
  if (!latest) return null;

  const { data: customer } = await db
    .from('customers')
    .select('id, name, phone, email, access_notes')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const c = customer as { id: string; name: string; phone: string | null; email: string | null; access_notes: string | null } | null;
  if (!c) return null;
  const { data: balance } = await db
    .from('customer_balances')
    .select('owed_amount')
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .maybeSingle();
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: latest.address ?? '',
    postcode: latest.postcode ?? '',
    accessNotes: c.access_notes && c.access_notes.trim() !== '' ? c.access_notes.trim() : null,
    customerOwes: num((balance as { owed_amount?: unknown } | null)?.owed_amount),
  };
}
