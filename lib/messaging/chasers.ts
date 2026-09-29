import type { MessagingSettings } from '@/lib/messaging/settings';
import { sendsInvoice } from '@/lib/payments/terms';
import { addDays, diffDays } from '@/lib/rounds/dates';

export type ChaserCandidate = {
  customerId: string;
  owed: number; // owed_amount
  oldestUnpaidDate: string; // Ymd
  paymentTerms: string | null; // 'invoice' | 'monthly_invoice' | 'on_the_day' | null
  paymentChasers: boolean; // customers.payment_chasers
  isActive: boolean;
  preferredChannel: string | null;
  lastChaserAt: string | null; // ISO, most recent chaser message of any stage
  /** Their reply is waiting in Needs attention (e.g. "I've paid"): don't chase until it's dealt with. */
  awaitingReview?: boolean;
};

export type ChaserPlan = {
  customerId: string;
  stage: 1 | 2;
  dedupeKey: string;
  baseDate: string;
  owed: number;
};

const MS_PER_DAY = 86_400_000;

function withinLastDays(iso: string, now: Date, days: number): boolean {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < days * MS_PER_DAY;
}

export function planChasers(
  candidates: ChaserCandidate[],
  settings: Pick<
    MessagingSettings,
    'chasers_enabled' | 'chase_first_days' | 'chase_second_days'
  >,
  p: { today: string; invoiceDueDays: number; now: Date },
): ChaserPlan[] {
  if (!settings.chasers_enabled) return [];

  const plans: ChaserPlan[] = [];

  for (const c of candidates) {
    if (!c.paymentChasers) continue;
    if (!c.isActive) continue;
    if (c.preferredChannel === 'none') continue;
    if (c.owed <= 0) continue;
    if (c.awaitingReview) continue;

    const baseDate = sendsInvoice(c.paymentTerms)
      ? addDays(c.oldestUnpaidDate, p.invoiceDueDays)
      : c.oldestUnpaidDate;

    const age = diffDays(baseDate, p.today);
    let stage: 1 | 2 | null = null;
    if (age >= settings.chase_second_days) stage = 2;
    else if (age >= settings.chase_first_days) stage = 1;
    if (stage == null) continue;

    if (c.lastChaserAt && withinLastDays(c.lastChaserAt, p.now, 7)) continue;

    plans.push({
      customerId: c.customerId,
      stage,
      dedupeKey: `chaser:${c.customerId}:${c.oldestUnpaidDate}:${stage}`,
      baseDate,
      owed: c.owed,
    });
  }

  plans.sort((a, b) => b.owed - a.owed);
  return plans;
}
