import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import type { Ymd } from '@/lib/rounds/dates';

/** The things on the overview's "Needs you now" list that aren't already in the home data. */
export type NeedsYou = {
  /** Upcoming visits where the customer said no, asked to move, or sent a question. Skip / Keep / Move clears them. */
  repliesToReview: number;
  /** Up to 3 names of the customers who replied, for the detail line. */
  replyNames: string[];
  /** Scanned receipts waiting for a Save. */
  receiptsToCheck: number;
  /** What those receipts add up to, as read so far. */
  receiptsAmount: number;
  /** Visits from earlier days that were never done or skipped. */
  missedVisits: number;
  /** The earliest of those, so the link can open that day. */
  oldestMissedDate: Ymd | null;
};

const REPLY_LABELS = ['declined', 'rescheduled', 'replied'];

function countOrZero(count: number | null, error: { message: string } | null, what: string): number {
  if (error) {
    console.error(`[loadNeedsYou] ${what}`, error.message);
    return 0;
  }
  return count ?? 0;
}

/** Read-only. A failed count shows as nothing waiting rather than breaking the overview. */
export async function loadNeedsYou(
  db: SupabaseClient,
  p: { tenantId: string; today: Ymd },
): Promise<NeedsYou> {
  const [replies, receipts, missed] = await Promise.all([
    db
      .from('jobs')
      .select('id, customers ( name )', { count: 'exact' })
      .eq('tenant_id', p.tenantId)
      .gte('scheduled_date', p.today)
      .in('status', [...RESCHEDULE_STATUSES])
      .in('customer_confirmation_status', REPLY_LABELS)
      .order('customer_reply_at', { ascending: false })
      .limit(10),
    db
      .from('expenses')
      .select('amount', { count: 'exact' })
      .eq('tenant_id', p.tenantId)
      .eq('status', 'draft')
      .limit(100),
    db
      .from('jobs')
      .select('scheduled_date', { count: 'exact' })
      .eq('tenant_id', p.tenantId)
      .lt('scheduled_date', p.today)
      .in('status', [...RESCHEDULE_STATUSES])
      .order('scheduled_date', { ascending: true })
      .limit(1),
  ]);

  const oldest = missed.data?.[0]?.scheduled_date;
  const names = new Set<string>();
  for (const row of replies.data ?? []) {
    const customer = (row as { customers?: { name?: unknown } | Array<{ name?: unknown }> | null }).customers;
    const name = Array.isArray(customer) ? customer[0]?.name : customer?.name;
    if (typeof name === 'string' && name.trim() !== '') names.add(name.trim());
  }
  const receiptsAmount = (receipts.data ?? []).reduce((sum, r) => {
    const n = Number((r as { amount?: unknown }).amount);
    return Number.isFinite(n) ? sum + Math.round(n * 100) : sum;
  }, 0);
  return {
    repliesToReview: countOrZero(replies.count, replies.error, 'replies'),
    replyNames: [...names].slice(0, 3),
    receiptsToCheck: countOrZero(receipts.count, receipts.error, 'receipts'),
    receiptsAmount: receiptsAmount / 100,
    missedVisits: countOrZero(missed.count, missed.error, 'missed visits'),
    oldestMissedDate: typeof oldest === 'string' ? oldest.slice(0, 10) : null,
  };
}
