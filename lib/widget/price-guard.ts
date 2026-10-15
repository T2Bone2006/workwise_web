import type { PriceProfile } from '@/lib/lite/profile-schema';
import type { GuardedQuote, WidgetTurn } from '@/lib/widget/turn-schema';

const POUND_RE = /£\s?(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?/g;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}

function clipSummary(summary: string): string {
  const trimmed = summary.trim();
  return trimmed.length <= 200 ? trimmed : trimmed.slice(0, 200);
}

function poundsInText(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(POUND_RE)) {
    const whole = match[1];
    if (!whole) continue;
    const n = Number(whole.replace(/,/g, '') + (match[3] ?? ''));
    if (Number.isFinite(n)) found.push(n);
  }
  return found;
}

function rangeOf(min: number | null, max: number | null): { min: number; max: number } | null {
  if (min == null || max == null || min > max) return null;
  return { min, max };
}

export function guardQuote(raw: WidgetTurn['quote'], profile: PriceProfile | null): GuardedQuote | null {
  if (!profile || !raw) return null;
  const summary = clipSummary(raw.summary);
  const job = raw.job_type_key ? profile.job_types.find((item) => item.key === raw.job_type_key) : undefined;
  if (!job) return null;

  const range = rangeOf(job.guide_min, job.guide_max);

  if (job.how_priced === 'from_description') {
    const amount = raw.amount;
    const minimumOk = profile.minimum_charge == null || (amount != null && amount >= profile.minimum_charge);
    if (
      raw.kind === 'firm' &&
      amount != null &&
      range &&
      amount >= range.min &&
      amount <= range.max &&
      minimumOk
    ) {
      return { kind: 'firm', jobTypeKey: job.key, amount: round2(amount), summary };
    }
    return null;
  }

  return { kind: 'visit', jobTypeKey: job.key, summary };
}

export function allowedAmounts(
  profile: PriceProfile | null,
  quote: GuardedQuote | null,
  businessContext: string,
): number[] {
  const amounts: number[] = [];
  if (profile) {
    for (const n of [profile.callout_fee, profile.hourly_rate, profile.day_rate, profile.minimum_charge]) {
      if (n != null) amounts.push(n);
    }
    for (const job of profile.job_types) {
      if (job.guide_min != null) amounts.push(job.guide_min);
      if (job.guide_max != null) amounts.push(job.guide_max);
    }
    for (const example of profile.example_jobs) amounts.push(example.price);
  }
  if (quote?.kind === 'firm') amounts.push(quote.amount);
  if (quote?.kind === 'guide') amounts.push(quote.min, quote.max);
  amounts.push(...poundsInText(businessContext));
  return amounts;
}

export function formatPounds(amount: number): string {
  const rounded = round2(amount);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** True when the reply already states this figure, so the estimate sentence is not added twice. */
export function replyMentionsAmount(reply: string, amount: number): boolean {
  const target = toPence(amount);
  return poundsInText(reply).some((n) => toPence(n) === target);
}

/** Every £ amount in the reply, compared in pence, is one the tradie set. No £ → true. */
export function replyAmountsAllowed(reply: string, allowed: number[]): boolean {
  const allowedPence = new Set(allowed.map(toPence));
  return poundsInText(reply).every((n) => allowedPence.has(toPence(n)));
}
