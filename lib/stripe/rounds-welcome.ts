import 'server-only';

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { roundsSignupGetsWelcome, sendRoundsWelcomeEmail } from '@/lib/emails/rounds-welcome';

/** Set on the Stripe customer after the thank-you goes out. A retry sees it and does not send again. */
export const ROUNDS_WELCOME_SENT = 'rounds_welcome_sent';

/**
 * One thank-you, with the app link, when a Rounds account is first created.
 * Pro, Lite-only, a restart and a later invoice do not come through here.
 * A failed send throws so Stripe retries the webhook. The address is never logged.
 */
export async function notifyRoundsWelcome(args: {
  admin: SupabaseClient;
  stripe: Stripe;
  intentId: string;
  customerId: string | null;
}): Promise<void> {
  const { data, error } = await args.admin
    .from('signup_intents')
    .select('product, email, full_name')
    .eq('id', args.intentId)
    .maybeSingle();
  if (error) {
    console.error('[rounds-welcome] signup intent lookup failed');
    throw new Error('rounds welcome lookup failed');
  }
  if (!data || !roundsSignupGetsWelcome(data.product)) return;

  const to = typeof data.email === 'string' ? data.email.trim() : '';
  if (!to) {
    console.error('[rounds-welcome] no address');
    return;
  }

  if (args.customerId) {
    let customer: Stripe.Customer | Stripe.DeletedCustomer;
    try {
      customer = await args.stripe.customers.retrieve(args.customerId);
    } catch (err) {
      console.error('[rounds-welcome] could not read the customer', {
        error: err instanceof Error ? err.name : 'Error',
      });
      throw new Error('rounds welcome lookup failed');
    }
    if (!customer.deleted && customer.metadata?.[ROUNDS_WELCOME_SENT] === '1') return;
  }

  const sent = await sendRoundsWelcomeEmail({
    to,
    fullName: typeof data.full_name === 'string' ? data.full_name : '',
    intentId: args.intentId,
  });
  if (!sent.ok) throw new Error('rounds welcome email failed');

  if (!args.customerId) return;
  try {
    await args.stripe.customers.update(args.customerId, {
      metadata: { [ROUNDS_WELCOME_SENT]: '1' },
    });
  } catch (err) {
    console.error('[rounds-welcome] could not record the send', {
      error: err instanceof Error ? err.name : 'Error',
    });
    throw new Error('rounds welcome email was sent but not recorded');
  }
}
