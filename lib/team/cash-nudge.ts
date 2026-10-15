import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOrHoldOwnerPush } from '@/lib/push/owner-push';
import { addDays, todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import { listHeldCash } from '@/lib/team/hand-in';

/**
 * A daily push to the owner when a team member has been holding their cash for a few days (D10). No new state: it fires
 * on the first day the oldest held payment is `threshold` days old, then every third day while it is still held.
 * The single daily schedule in vercel.json is what stops a second push the same morning.
 */

const DEFAULT_DAYS = 3;
const REPEAT_EVERY = 3;

export function nudgeDays(env: string | undefined = process.env.CASH_NUDGE_DAYS): number {
  const n = Number(env);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : DEFAULT_DAYS;
}

/** True on the first day the oldest held payment is `threshold` days old and every third day after. */
export function shouldNudge(oldestAgeDays: number, threshold: number): boolean {
  return oldestAgeDays >= threshold && (oldestAgeDays - threshold) % REPEAT_EVERY === 0;
}

function pounds(n: number): string {
  return `£${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export function nudgeText(groups: Array<{ name: string; total: number; oldestAgeDays: number }>): { title: string; body: string } {
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  if (groups.length === 1) {
    const g = groups[0]!;
    return { title: 'Cash to collect', body: `${g.name} has had ${pounds(g.total)} for ${days(g.oldestAgeDays)}.` };
  }
  const parts = groups.map((g) => `${g.name} ${pounds(g.total)} (${days(g.oldestAgeDays)})`);
  let body = parts.join(', ');
  if (body.length > 190) {
    let shown = '';
    let count = 0;
    for (const part of parts) {
      const next = shown ? `${shown}, ${part}` : part;
      if (next.length > 150) break;
      shown = next;
      count += 1;
    }
    body = `${shown} and ${parts.length - count} more`;
  }
  return { title: 'Cash to collect', body };
}

export async function runCashNudge(
  now: Date = new Date(),
  db: SupabaseClient = createAdminClient(),
): Promise<{ checked: number; sent: number; held: number; skipped: number; errors: number }> {
  const tally = { checked: 0, sent: 0, held: 0, skipped: 0, errors: 0 };
  const threshold = nudgeDays();
  const today = todayInLondon(now);
  const cutoff = addDays(today, -threshold);

  // Businesses with any cash held since before the cutoff.
  const { data, error } = await db
    .from('payments')
    .select('tenant_id')
    .eq('status', 'active')
    .is('handed_over_at', null)
    .or('collected_by_worker_id.not.is.null,collected_by_name.not.is.null')
    .lte('received_at', `${cutoff}T23:59:59.999Z`)
    .limit(5000);
  if (error) {
    if (/collected_by|handed_over/i.test(error.message ?? '') || error.code === '42703') return tally; // migration not pasted yet
    throw new Error(`[cash-nudge] list failed: ${error.message}`);
  }
  const tenantIds = [...new Set(((data ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id))];

  for (const tenantId of tenantIds) {
    tally.checked += 1;
    try {
      const groups = (await listHeldCash(db, tenantId, today)).filter((g) => shouldNudge(g.oldestAgeDays, threshold));
      if (groups.length === 0) {
        tally.skipped += 1;
        continue;
      }
      const text = nudgeText(groups);
      const outcome = await sendOrHoldOwnerPush(
        db,
        tenantId,
        {
          kind: 'cash_handin',
          title: text.title,
          body: text.body,
          data: { type: 'cash_handin', amount: Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100 },
        },
        now,
      );
      if (outcome === 'sent') tally.sent += 1;
      else if (outcome === 'held') tally.held += 1;
      else if (outcome === 'no_token') tally.skipped += 1;
      else tally.errors += 1;
    } catch (err) {
      console.error('[cash-nudge]', tenantId, err instanceof Error ? err.message : 'failed');
      tally.errors += 1;
    }
  }
  return tally;
}
