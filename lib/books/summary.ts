import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isExpenseCategory } from '@/lib/books/categories';
import { periodRange, type Period } from '@/lib/books/periods';
import {
  summarise,
  type BooksSummary,
  type ExpenseOut,
  type PaymentIn,
} from '@/lib/books/summary-pure';
import { readAllPages } from '@/lib/data/read-all-pages';
import { londonDayBoundsUtc } from '@/lib/rounds/dates';

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The one place In & out numbers come from (00-context §6): the dashboard, the
 * phone, the accountant pages and the CSVs all call this. Cash basis (D5):
 * money in is payments actually received (T10), money out is confirmed expenses.
 * Never partial: any read error throws.
 */
export async function loadBooksSummary(
  db: SupabaseClient,
  p: { tenantId: string; period: Period },
): Promise<BooksSummary> {
  const period = periodRange(p.period);
  const startIso = londonDayBoundsUtc(period.from).startIso;
  const endIso = londonDayBoundsUtc(period.to).endIso; // next London midnight, exclusive

  const [paymentRows, expenseRows, settings] = await Promise.all([
    readAllPages((from, to) =>
      db
        .from('payments')
        .select('amount, refunded_amount, received_at, method')
        .eq('tenant_id', p.tenantId)
        .eq('status', 'active')
        .gte('received_at', startIso)
        .lt('received_at', endIso)
        .order('received_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
      'Could not load the books',
    ),
    readAllPages((from, to) =>
      db
        .from('expenses')
        .select('spent_on, amount, vat_amount, category')
        .eq('tenant_id', p.tenantId)
        .eq('status', 'confirmed')
        .gte('spent_on', period.from)
        .lte('spent_on', period.to)
        .order('spent_on', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
      'Could not load the books',
    ),
    db
      .from('tenant_payment_settings')
      .select('vat_registered, vat_rate_percent')
      .eq('tenant_id', p.tenantId)
      .maybeSingle(),
  ]);
  if (settings.error) throw new Error('Could not load the books');

  const payments: PaymentIn[] = paymentRows.map((r) => ({
    receivedAt: String(r.received_at),
    amount: num(r.amount),
    refundedAmount: num(r.refunded_amount),
    method: String(r.method ?? 'other'),
  }));

  const expenses: ExpenseOut[] = expenseRows.flatMap((r) =>
    isExpenseCategory(r.category) && typeof r.spent_on === 'string'
      ? [
          {
            spentOn: r.spent_on,
            amount: num(r.amount),
            vatAmount: r.vat_amount == null ? null : num(r.vat_amount),
            category: r.category,
          },
        ]
      : [],
  );

  const settingsRow = settings.data as { vat_registered?: boolean; vat_rate_percent?: unknown } | null;
  return summarise({
    period,
    payments,
    expenses,
    vat: {
      registered: settingsRow?.vat_registered === true,
      ratePercent: settingsRow?.vat_rate_percent == null ? 20 : num(settingsRow.vat_rate_percent),
    },
    withMonths: p.period.kind === 'tax_year',
  });
}
