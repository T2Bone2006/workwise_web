import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { PAGE_SIZE } from '@/lib/data/read-all-pages';

/**
 * Money the OWNER has received (Phase 9, D10, T8). Cash a member of staff collects is the owner's money only once
 * the owner ticks it handed over, so:
 *  - a payment nobody collected counts from `received_at` (as it always did);
 *  - cash a person collected counts from `handed_over_at`, and not at all until then.
 * Every report that adds up "money in" reads through here, so the rule lives in one place. Reports about a customer's
 * own payments (their ledger, what they owe) do NOT use this: the customer paid when they handed over the cash.
 */

export type MoneyInRow = Record<string, unknown> & { book_at: string };

type PgError = { code?: string; message?: string } | null;

/** The database answered "no such column": migration 20261011100100 has not been pasted yet. */
export function isMissingHeldColumn(error: PgError): boolean {
  if (!error) return false;
  return error.code === '42703' || /collected_by|handed_over/i.test(error.message ?? '');
}

type Query = {
  gte(col: string, v: unknown): Query;
  gt(col: string, v: unknown): Query;
  in(col: string, v: readonly unknown[]): Query;
  lt(col: string, v: unknown): Query;
  eq(col: string, v: unknown): Query;
  is(col: string, v: unknown): Query;
  not(col: string, op: string, v: unknown): Query;
  or(expr: string): Query;
  order(col: string, o?: { ascending?: boolean }): Query;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: PgError }>;
};

async function readPages(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PgError }>,
): Promise<{ rows: Record<string, unknown>[]; error: PgError }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, error: null };
  }
}

/**
 * Active payments that count as money in between two instants (`fromIso` inclusive, `toIso` exclusive; either may be
 * left out), each with `book_at`: the instant the owner's books date it. `refine` adds extra filters (for example
 * "refunded_amount > 0"). Any read error throws `errorMessage`; nothing is ever returned partial.
 */
export async function readMoneyInPayments(
  db: SupabaseClient,
  p: {
    tenantId: string;
    /** Your columns; received_at and the held columns are added for you. */
    columns: string;
    fromIso?: string;
    toIso?: string;
    refine?: (q: Query) => Query;
    errorMessage?: string;
  },
): Promise<MoneyInRow[]> {
  const message = p.errorMessage ?? 'Could not load payments';
  const own = `${p.columns}, received_at, collected_by_worker_id, collected_by_name, handed_over_at`;

  const base = (columns: string) => {
    const q = db.from('payments').select(columns).eq('tenant_id', p.tenantId).eq('status', 'active') as unknown as Query;
    return p.refine ? p.refine(q) : q;
  };
  const between = (q: Query, col: string) => {
    let out = q;
    if (p.fromIso) out = out.gte(col, p.fromIso);
    if (p.toIso) out = out.lt(col, p.toIso);
    return out;
  };

  // A: nobody collected it — counts from received_at.
  const a = await readPages((from, to) =>
    between(base(own).is('collected_by_worker_id', null).is('collected_by_name', null), 'received_at')
      .order('received_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (a.error) {
    if (!isMissingHeldColumn(a.error)) throw new Error(message);
    // Before the Phase 9 migration is pasted nothing can be held, so every payment counts from received_at.
    const legacy = await readPages((from, to) =>
      between(base(`${p.columns}, received_at`), 'received_at')
        .order('received_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (legacy.error) throw new Error(message);
    return legacy.rows.map((r) => ({ ...r, book_at: String(r.received_at) }));
  }

  // B: collected by a person and handed over — counts from handed_over_at.
  const b = await readPages((from, to) =>
    between(
      base(own).or('collected_by_worker_id.not.is.null,collected_by_name.not.is.null').not('handed_over_at', 'is', null),
      'handed_over_at',
    )
      .order('handed_over_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (b.error) throw new Error(message);

  const rows: MoneyInRow[] = [
    ...a.rows.map((r) => ({ ...r, book_at: String(r.received_at) })),
    ...b.rows.map((r) => ({ ...r, book_at: String(r.handed_over_at) })),
  ];
  return rows.sort((x, y) => (x.book_at < y.book_at ? -1 : x.book_at > y.book_at ? 1 : String(x.id ?? '').localeCompare(String(y.id ?? ''))));
}

/** Cash and cheques currently held by the team, in pounds. 0 when nothing is held or before the migration. */
export async function sumHeldCash(db: SupabaseClient, tenantId: string): Promise<number> {
  const { data, error } = await db
    .from('payments')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .is('handed_over_at', null)
    .or('collected_by_worker_id.not.is.null,collected_by_name.not.is.null')
    .limit(5000);
  if (error) {
    if (!isMissingHeldColumn(error)) console.error('[money-in] held cash:', error.message);
    return 0;
  }
  const pence = ((data ?? []) as Array<{ amount: unknown }>).reduce((sum, r) => sum + Math.round((Number(r.amount) || 0) * 100), 0);
  return pence / 100;
}
