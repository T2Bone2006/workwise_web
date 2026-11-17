import 'server-only';
import type Stripe from 'stripe';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { choiceForPriceId, founderPence, PLANS } from '@/lib/billing/plans';
import { FOUNDER_PLACE_META } from '@/lib/billing/founder-place';
import { buildTrialEndingEmail, sendTrialEndingEmail } from '@/lib/emails/trial-ending';

/** Set on the subscription after the reminder goes out, so a retry or a second event never sends two. */
export const TRIAL_REMINDER_SENT = 'trial_reminder_sent';

function dayMonth(unix: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(unix * 1000));
}

function pounds(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/**
 * Webhook hook for customer.subscription.trial_will_end (Stripe sends it 3 days before the trial ends).
 * Rounds and Lite only (a Pro subscription has no trial). A failed send throws so Stripe retries.
 */
export async function onTrialWillEnd(subscription: Stripe.Subscription): Promise<'sent' | 'skipped'> {
  if (subscription.metadata?.[TRIAL_REMINDER_SENT] === '1') return 'skipped';
  const trialEnd = subscription.trial_end;
  if (!trialEnd || subscription.status !== 'trialing') return 'skipped';

  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  const choice = choiceForPriceId(priceId);
  if (!choice) return 'skipped';

  const stripe = getStripe();
  const customerRef = subscription.customer;
  const customerId = typeof customerRef === 'string' ? customerRef : customerRef.id;
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.email) return 'skipped';

  const founder = subscription.metadata?.[FOUNDER_PLACE_META] === '1';
  const pence = founder ? founderPence(choice.plan, choice.interval) : PLANS[choice.plan].pence[choice.interval];
  const amountLabel = `${pounds(pence)} ${choice.interval === 'month' ? 'a month' : 'a year'}`;

  const sent = await sendTrialEndingEmail({
    to: customer.email,
    subscriptionId: subscription.id,
    content: buildTrialEndingEmail({
      planLabel: PLANS[choice.plan].label,
      amountLabel,
      endsOn: dayMonth(trialEnd),
      founder,
      settingsUrl: `${getAppUrl()}/settings`,
    }),
  });
  if (!sent.ok) throw new Error('trial ending email failed');

  await stripe.subscriptions.update(subscription.id, { metadata: { [TRIAL_REMINDER_SENT]: '1' } });
  return 'sent';
}
