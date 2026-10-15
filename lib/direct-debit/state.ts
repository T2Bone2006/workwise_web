import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getConnection, type ConnectionRow } from '@/lib/gocardless/connection';
import { fromPence, toPence } from '@/lib/money/pence';

/** T9: what every screen shows for the business's Direct Debit. */
export type DirectDebitState = 'off' | 'verifying' | 'needs_details' | 'on';

/**
 * Pure. null / not_connected / disconnected → off; connected + successful →
 * on; connected + action_required → needs_details; connected + in_review or
 * null → verifying.
 */
export function directDebitState(
  c: Pick<ConnectionRow, 'status' | 'verification_status'> | null,
): DirectDebitState {
  if (!c || c.status !== 'connected') return 'off';
  if (c.verification_status === 'successful') return 'on';
  if (c.verification_status === 'action_required') return 'needs_details';
  return 'verifying';
}

/** Stored row, no API call. Collections refresh first (step 12). */
export async function getDirectDebitState(
  admin: SupabaseClient,
  tenantId: string,
): Promise<DirectDebitState> {
  return directDebitState(await getConnection(admin, tenantId));
}

const LEFT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * 'active' | 'pending' when this customer's next payment really will be
 * collected by Direct Debit: the business is On, the customer has a
 * pending/active Direct Debit, and no failed collection is waiting for the
 * trader's choice or was left in the last 60 days. Anything else — or any
 * read error — is null, so the customer gets the ordinary pay link.
 */
export async function workingDirectDebit(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
  now: Date = new Date(),
): Promise<'active' | 'pending' | null> {
  try {
    if ((await getDirectDebitState(admin, tenantId)) !== 'on') return null;
    const [dd, failed] = await Promise.all([
      admin
        .from('customer_direct_debits')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .in('status', ['pending', 'active'])
        .maybeSingle(),
      admin
        .from('direct_debit_collections')
        .select('resolution, resolved_at')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'failed'),
    ]);
    if (dd.error || failed.error) return null;
    const status = (dd.data as { status?: unknown } | null)?.status;
    if (status !== 'active' && status !== 'pending') return null;
    const since = now.getTime() - LEFT_WINDOW_MS;
    for (const row of (failed.data ?? []) as { resolution?: unknown; resolved_at?: unknown }[]) {
      if (row.resolution == null) return null;
      if (row.resolution === 'left') {
        const at = Date.parse(String(row.resolved_at));
        if (!Number.isFinite(at) || at >= since) return null;
      }
    }
    return status;
  } catch {
    return null;
  }
}

export type ChaserMoney = {
  /** A working Direct Debit will collect what they owe (business On, pending/active, nothing left in the last 60 days). */
  directDebitWorking: boolean;
  /** What is still worth chasing: owed − collecting − failed awaiting a choice − Pay by Bank approved. */
  chaseAmount: number;
};

/**
 * Step 15: for the chasers. One batch of reads for many customers. Returns
 * null on any read error — the caller then chases nobody tonight.
 */
export async function loadChaserMoney(
  admin: SupabaseClient,
  tenantId: string,
  owedByCustomer: Map<string, number>,
  now: Date = new Date(),
): Promise<Map<string, ChaserMoney> | null> {
  const customerIds = [...owedByCustomer.keys()];
  const result = new Map<string, ChaserMoney>();
  if (customerIds.length === 0) return result;
  try {
    const businessOn = (await getDirectDebitState(admin, tenantId)) === 'on';
    const [dds, collections, payRequests] = await Promise.all([
      admin
        .from('customer_direct_debits')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'active'])
        .in('customer_id', customerIds),
      admin
        .from('direct_debit_collections')
        .select('customer_id, amount, status, resolution, resolved_at')
        .eq('tenant_id', tenantId)
        .in('status', ['creating', 'processing', 'failed'])
        .in('customer_id', customerIds),
      admin
        .from('gocardless_pay_requests')
        .select('customer_id, amount')
        .eq('tenant_id', tenantId)
        .eq('status', 'fulfilled')
        .in('customer_id', customerIds),
    ]);
    if (dds.error || collections.error || payRequests.error) return null;

    type Row = Record<string, unknown>;
    const withDd = new Set(((dds.data ?? []) as Row[]).map((r) => String(r.customer_id)));
    const leftSince = now.getTime() - LEFT_WINDOW_MS;
    const sums = new Map<string, { collecting: number; heldFailed: number; payingByBank: number; leftRecently: boolean }>();
    const entry = (id: string) => {
      let e = sums.get(id);
      if (!e) {
        e = { collecting: 0, heldFailed: 0, payingByBank: 0, leftRecently: false };
        sums.set(id, e);
      }
      return e;
    };
    const pence = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? toPence(n) : 0;
    };
    for (const r of (collections.data ?? []) as Row[]) {
      const e = entry(String(r.customer_id));
      if (r.status === 'failed') {
        if (r.resolution == null) e.heldFailed += pence(r.amount);
        else if (r.resolution === 'left') {
          const at = Date.parse(String(r.resolved_at));
          if (!Number.isFinite(at) || at >= leftSince) e.leftRecently = true;
        }
      } else {
        e.collecting += pence(r.amount);
      }
    }
    for (const r of (payRequests.data ?? []) as Row[]) {
      entry(String(r.customer_id)).payingByBank += pence(r.amount);
    }

    for (const [customerId, owed] of owedByCustomer) {
      const e = sums.get(customerId);
      result.set(customerId, {
        directDebitWorking: businessOn && withDd.has(customerId) && !e?.leftRecently,
        // Same sum as collect.ts's amountToCollect (not imported: collect.ts imports this file).
        chaseAmount: fromPence(
          Math.max(
            0,
            toPence(owed) - (e?.collecting ?? 0) - (e?.heldFailed ?? 0) - (e?.payingByBank ?? 0),
          ),
        ),
      });
    }
    return result;
  } catch {
    return null;
  }
}
