import type { SupabaseClient } from '@supabase/supabase-js';

/** Customers whose pay-link style message was dropped for lack of texts, for the "Didn't get it" list. */

export type NotDelivered = {
  messageId: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  kind: 'visit_done' | 'chaser' | 'dd_invite' | 'dd_failed';
  label: string;
  why: 'expired' | 'out_of_texts';
  when: string;
};

const LABELS: Record<NotDelivered['kind'], string> = {
  visit_done: 'Payment link',
  chaser: 'Payment reminder',
  dd_invite: 'Direct Debit link',
  dd_failed: 'Missed Direct Debit',
};

const WINDOW_DAYS = 30;

export async function getNotDelivered(
  supabase: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<NotDelivered[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('messages')
    .select('id, customer_id, kind, error, created_at, customers(name, phone_e164, email)')
    .eq('tenant_id', tenantId)
    .eq('status', 'skipped')
    .in('error', ['waiting_expired', 'no_texts_left'])
    .in('kind', ['visit_done', 'chaser', 'dd_invite', 'dd_failed'])
    .is('handled_action', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as {
    id: string;
    customer_id: string;
    kind: NotDelivered['kind'];
    error: string;
    created_at: string;
    customers: { name: string | null; phone_e164: string | null; email: string | null } | { name: string | null; phone_e164: string | null; email: string | null }[] | null;
  }[]).map((row) => {
    const c = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    return {
      messageId: row.id,
      customerId: row.customer_id,
      customerName: c?.name?.trim() || 'Customer',
      phone: c?.phone_e164 ?? null,
      email: c?.email ?? null,
      kind: row.kind,
      label: LABELS[row.kind],
      why: row.error === 'waiting_expired' ? 'expired' : 'out_of_texts',
      when: row.created_at,
    };
  });
}
