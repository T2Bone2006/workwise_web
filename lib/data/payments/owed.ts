import type { SupabaseClient } from '@supabase/supabase-js';
import { getDirectDebitSummaries } from '@/lib/data/direct-debit/customer';

export type OwedCustomerRow = {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  owedAmount: number;
  unpaidVisitCount: number;
  oldestUnpaidDate: string | null;
  creditAmount: number;
  otherOwedAmount: number; // other amounts owed (charges) inside owedAmount
  chaseStage: 0 | 1 | 2; // highest chaser stage sent for the customer's CURRENT oldest unpaid date
  collectingAmount: number; // being collected by Direct Debit now (D5)
  hasDirectDebit: boolean; // pending or active Direct Debit
  failedDirectDebits: number; // failed collections waiting for Collect again / Leave it
};

function chaseStageFromDedupeKey(
  dedupeKey: string | null,
  customerId: string,
  oldestUnpaidDate: string,
): 0 | 1 | 2 {
  if (!dedupeKey) return 0;
  const prefix = `chaser:${customerId}:${oldestUnpaidDate}:`;
  if (!dedupeKey.startsWith(prefix)) return 0;
  const stageRaw = dedupeKey.slice(prefix.length);
  if (stageRaw === '2') return 2;
  if (stageRaw === '1') return 1;
  return 0;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * From customer_balances joined to customers (active only),
 * owed > 0 OR credit > 0, ordered oldest_unpaid_date NULLS LAST, name.
 */
export async function getOwedCustomers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{
  rows: OwedCustomerRow[];
  totalOwed: number;
  totalCredit: number;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('customer_balances')
    .select(
      'customer_id, owed_amount, unpaid_visit_count, oldest_unpaid_date, credit_amount, other_owed_amount',
    )
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('getOwedCustomers failed', error);
    return { rows: [], totalOwed: 0, totalCredit: 0, error: error.message };
  }

  const balanceRows = (data ?? []) as unknown as Record<string, unknown>[];
  const customerIds = balanceRows
    .map((row) => asString(row.customer_id))
    .filter((id): id is string => id != null);

  const customersById = new Map<string, Record<string, unknown>>();
  if (customerIds.length > 0) {
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, name, phone, email, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('id', customerIds);
    if (customerError) {
      console.error('getOwedCustomers customers failed', customerError);
      return { rows: [], totalOwed: 0, totalCredit: 0, error: customerError.message };
    }
    for (const customer of customers ?? []) {
      const record = customer as unknown as Record<string, unknown>;
      const id = asString(record.id);
      if (id) customersById.set(id, record);
    }
  }

  const oldestByCustomer = new Map<string, string>();
  for (const row of balanceRows) {
    const customerId = asString(row.customer_id);
    const oldest = asString(row.oldest_unpaid_date)?.slice(0, 10);
    if (customerId && oldest) oldestByCustomer.set(customerId, oldest);
  }

  const chaseStageByCustomer = new Map<string, 0 | 1 | 2>();
  if (customerIds.length > 0) {
    const { data: chaserMsgs, error: chaserError } = await supabase
      .from('messages')
      .select('customer_id, dedupe_key, status')
      .eq('tenant_id', tenantId)
      .eq('kind', 'chaser')
      .in('customer_id', customerIds)
      .in('status', ['sent', 'delivered', 'held']);
    if (chaserError) {
      console.error('getOwedCustomers chasers failed', chaserError);
    } else {
      for (const msg of chaserMsgs ?? []) {
        const record = msg as unknown as Record<string, unknown>;
        const customerId = asString(record.customer_id);
        const dedupeKey = asString(record.dedupe_key);
        if (!customerId || !dedupeKey) continue;
        const oldest = oldestByCustomer.get(customerId);
        if (!oldest) continue;
        const stage = chaseStageFromDedupeKey(dedupeKey, customerId, oldest);
        if (stage === 0) continue;
        const current = chaseStageByCustomer.get(customerId) ?? 0;
        if (stage > current) chaseStageByCustomer.set(customerId, stage);
      }
    }
  }

  const directDebits = await getDirectDebitSummaries(supabase, tenantId);

  const rows: OwedCustomerRow[] = [];
  for (const row of balanceRows) {
    const owed = asFiniteNumber(row.owed_amount) ?? 0;
    const credit = asFiniteNumber(row.credit_amount) ?? 0;
    if (owed <= 0 && credit <= 0) continue;

    const customerId = asString(row.customer_id);
    const customer = customerId ? customersById.get(customerId) : undefined;
    const name = asString(customer?.name);
    if (!customerId || !name) continue;

    rows.push({
      customerId,
      name,
      phone: asString(customer?.phone),
      email: asString(customer?.email),
      owedAmount: owed,
      unpaidVisitCount: asFiniteNumber(row.unpaid_visit_count) ?? 0,
      oldestUnpaidDate: asString(row.oldest_unpaid_date)?.slice(0, 10) ?? null,
      creditAmount: credit,
      otherOwedAmount: asFiniteNumber(row.other_owed_amount) ?? 0,
      chaseStage: chaseStageByCustomer.get(customerId) ?? 0,
      collectingAmount: directDebits.get(customerId)?.collecting ?? 0,
      hasDirectDebit: directDebits.get(customerId)?.hasDirectDebit ?? false,
      failedDirectDebits: directDebits.get(customerId)?.failedCount ?? 0,
    });
  }

  rows.sort((a, b) => {
    if (a.oldestUnpaidDate == null && b.oldestUnpaidDate != null) return 1;
    if (a.oldestUnpaidDate != null && b.oldestUnpaidDate == null) return -1;
    if (a.oldestUnpaidDate && b.oldestUnpaidDate) {
      if (a.oldestUnpaidDate < b.oldestUnpaidDate) return -1;
      if (a.oldestUnpaidDate > b.oldestUnpaidDate) return 1;
    }
    return a.name.localeCompare(b.name, 'en-GB');
  });

  return {
    rows,
    totalOwed: rows.reduce((sum, r) => sum + r.owedAmount, 0),
    totalCredit: rows.reduce((sum, r) => sum + r.creditAmount, 0),
    error: null,
  };
}

export async function getCustomerBalance(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<{
  owedAmount: number;
  unpaidVisitCount: number;
  oldestUnpaidDate: string | null;
  creditAmount: number;
  otherOwedAmount: number;
}> {
  const empty = {
    owedAmount: 0,
    unpaidVisitCount: 0,
    oldestUnpaidDate: null as string | null,
    creditAmount: 0,
    otherOwedAmount: 0,
  };

  const { data, error } = await supabase
    .from('customer_balances')
    .select(
      'owed_amount, unpaid_visit_count, oldest_unpaid_date, credit_amount, other_owed_amount',
    )
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error || !data) return empty;

  const row = data as unknown as Record<string, unknown>;
  return {
    owedAmount: asFiniteNumber(row.owed_amount) ?? 0,
    unpaidVisitCount: asFiniteNumber(row.unpaid_visit_count) ?? 0,
    oldestUnpaidDate: asString(row.oldest_unpaid_date)?.slice(0, 10) ?? null,
    creditAmount: asFiniteNumber(row.credit_amount) ?? 0,
    otherOwedAmount: asFiniteNumber(row.other_owed_amount) ?? 0,
  };
}
