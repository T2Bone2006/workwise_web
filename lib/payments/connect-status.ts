import { toPence } from '@/lib/money/pence';

export type ConnectStatus = 'none' | 'in_progress' | 'restricted' | 'active';

export type ConnectMirror = {
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  stripe_connect_details_submitted: boolean;
  stripe_connect_requirements_due: string[];
  stripe_connect_disabled_reason: string | null;
};

/**
 * none: no account id.
 * active: charges enabled.
 * in_progress: details not submitted.
 * restricted: submitted but charges off or requirements due.
 */
export function connectStatus(
  hasAccount: boolean,
  mirror: ConnectMirror | null,
): ConnectStatus {
  if (!hasAccount) return 'none';
  if (!mirror) return 'in_progress';
  if (mirror.stripe_connect_charges_enabled) return 'active';
  if (!mirror.stripe_connect_details_submitted) return 'in_progress';
  return 'restricted';
}

/** Maps a Stripe Account object (only the fields used) to the mirror columns. */
export function mirrorFromStripeAccount(account: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
}): ConnectMirror {
  const currently = account.requirements?.currently_due ?? [];
  const past = account.requirements?.past_due ?? [];
  const due = [...new Set([...currently, ...past])].sort();
  return {
    stripe_connect_charges_enabled: account.charges_enabled === true,
    stripe_connect_payouts_enabled: account.payouts_enabled === true,
    stripe_connect_details_submitted: account.details_submitted === true,
    stripe_connect_requirements_due: due,
    stripe_connect_disabled_reason:
      account.requirements?.disabled_reason ?? null,
  };
}

/** Minimum Stripe charge in GBP is £0.30. */
export function checkoutAmountPence(
  owedPounds: number,
):
  | { ok: true; pence: number }
  | { ok: false; reason: 'nothing_owed' | 'below_minimum' } {
  if (owedPounds <= 0) {
    return { ok: false, reason: 'nothing_owed' };
  }
  const pence = toPence(owedPounds);
  if (pence < 30) {
    return { ok: false, reason: 'below_minimum' };
  }
  return { ok: true, pence };
}
