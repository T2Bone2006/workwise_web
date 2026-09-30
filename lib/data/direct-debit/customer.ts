import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { failureReasonText } from '@/lib/direct-debit/after-collection';

export type DirectDebitStatus =
  | 'not_set_up'
  | 'setting_up'
  | 'pending'
  | 'active'
  | 'inactive'
  | 'cancelled';

export type CustomerDirectDebit = {
  status: DirectDebitStatus; // latest row; 'setting_up' shown as 'not_set_up' if older than 1 day
  bankEnding: string | null; // last 2 digits (T22)
  bankName: string | null;
  source: 'workwise' | 'imported' | null;
  activeSince: string | null;
  cancelledBy: 'customer' | 'trader' | 'bank' | null;
  inactiveReason: string | null;
  collecting: { amount: number; expectedOn: string | null; count: number }; // creating + processing; expectedOn = earliest charge_date
  failed: { collectionId: string; amount: number; failedOn: string; reason: string }[]; // failed, unresolved, newest first
  recent: {
    collectionId: string;
    amount: number;
    status: 'processing' | 'succeeded' | 'failed' | 'error' | 'cancelled';
    date: string;
  }[]; // last 10
};

type Row = Record<string, unknown>;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cents(value: unknown): number {
  return Math.round(num(value) * 100);
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function emptyDirectDebit(): CustomerDirectDebit {
  return {
    status: 'not_set_up',
    bankEnding: null,
    bankName: null,
    source: null,
    activeSince: null,
    cancelledBy: null,
    inactiveReason: null,
    collecting: { amount: 0, expectedOn: null, count: 0 },
    failed: [],
    recent: [],
  };
}

function newestFirst(a: Row, b: Row): number {
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

const STATUSES = new Set(['setting_up', 'pending', 'active', 'inactive', 'cancelled']);

/** One read gives any screen a customer's Direct Debit picture. Never throws: a read error gives the empty picture. */
export async function getCustomerDirectDebit(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
  now: Date = new Date(),
): Promise<CustomerDirectDebit> {
  const [dds, collections] = await Promise.all([
    supabase
      .from('customer_direct_debits')
      .select(
        'status, bank_name, account_number_ending, source, activated_at, cancelled_by, inactive_reason, created_at',
      )
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId),
    supabase
      .from('direct_debit_collections')
      .select('id, amount, status, resolution, charge_date, failure_code, submitted_at, finished_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId),
  ]);
  if (dds.error || collections.error) {
    console.error('[getCustomerDirectDebit]', dds.error?.code ?? collections.error?.code);
    return emptyDirectDebit();
  }

  const out = emptyDirectDebit();

  // A live (pending/active) row wins; otherwise the newest row.
  const ddRows = ((dds.data ?? []) as Row[]).sort(newestFirst);
  const row = ddRows.find((r) => r.status === 'pending' || r.status === 'active') ?? ddRows[0];
  if (row) {
    let status = String(row.status);
    if (!STATUSES.has(status)) status = 'not_set_up';
    if (status === 'setting_up') {
      const created = Date.parse(String(row.created_at));
      if (!Number.isFinite(created) || now.getTime() - created > ONE_DAY_MS) status = 'not_set_up';
    }
    if (status !== 'not_set_up') {
      out.status = status as DirectDebitStatus;
      out.bankEnding = str(row.account_number_ending);
      out.bankName = str(row.bank_name);
      out.source = row.source === 'imported' ? 'imported' : 'workwise';
      out.activeSince = str(row.activated_at);
      const by = str(row.cancelled_by);
      out.cancelledBy = by === 'customer' || by === 'trader' || by === 'bank' ? by : null;
      out.inactiveReason = str(row.inactive_reason);
    }
  }

  const rows = ((collections.data ?? []) as Row[]).sort(newestFirst);

  let collectingCents = 0;
  let earliest: string | null = null;
  for (const r of rows) {
    if (r.status !== 'creating' && r.status !== 'processing') continue;
    out.collecting.count += 1;
    collectingCents += cents(r.amount);
    const charge = str(r.charge_date)?.slice(0, 10) ?? null;
    if (charge && (!earliest || charge < earliest)) earliest = charge;
  }
  out.collecting.amount = collectingCents / 100;
  out.collecting.expectedOn = earliest;

  out.failed = rows
    .filter((r) => r.status === 'failed' && r.resolution == null)
    .map((r) => ({
      collectionId: String(r.id),
      amount: num(r.amount),
      failedOn: day(str(r.finished_at) ?? str(r.created_at)),
      reason: failureReasonText(str(r.failure_code)),
    }));

  out.recent = rows.slice(0, RECENT_LIMIT).map((r) => ({
    collectionId: String(r.id),
    amount: num(r.amount),
    status: (r.status === 'creating' ? 'processing' : r.status) as CustomerDirectDebit['recent'][number]['status'],
    date: day(str(r.finished_at) ?? str(r.submitted_at) ?? str(r.created_at)),
  }));

  return out;
}

/** For lists: customerId → { collecting, hasDirectDebit (pending/active), failedCount }. Never throws (a read error gives an empty map). */
export async function getDirectDebitSummaries(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Map<string, { collecting: number; hasDirectDebit: boolean; failedCount: number }>> {
  const map = new Map<string, { collecting: number; hasDirectDebit: boolean; failedCount: number }>();
  const [dds, collections] = await Promise.all([
    supabase
      .from('customer_direct_debits')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'active']),
    supabase
      .from('direct_debit_collections')
      .select('customer_id, amount, status, resolution')
      .eq('tenant_id', tenantId)
      .in('status', ['creating', 'processing', 'failed']),
  ]);
  if (dds.error || collections.error) {
    console.error('[getDirectDebitSummaries]', dds.error?.code ?? collections.error?.code);
    return map;
  }

  const entry = (id: string) => {
    let e = map.get(id);
    if (!e) {
      e = { collecting: 0, hasDirectDebit: false, failedCount: 0 };
      map.set(id, e);
    }
    return e;
  };
  const collectingCents = new Map<string, number>();
  for (const r of (dds.data ?? []) as Row[]) entry(String(r.customer_id)).hasDirectDebit = true;
  for (const r of (collections.data ?? []) as Row[]) {
    const id = String(r.customer_id);
    if (r.status === 'failed') {
      if (r.resolution == null) entry(id).failedCount += 1;
    } else {
      entry(id);
      collectingCents.set(id, (collectingCents.get(id) ?? 0) + cents(r.amount));
    }
  }
  for (const [id, c] of collectingCents) entry(id).collecting = c / 100;
  return map;
}
