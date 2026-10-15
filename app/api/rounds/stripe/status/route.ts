import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import type { ConnectStatus } from '@/lib/payments/connect-status';
import {
  ConnectMismatchError,
  getPayoutSummary,
  retrieveVerifiedAccount,
  syncConnectMirror,
  type PayoutSummary,
} from '@/lib/stripe/connect';

const MISCONFIGURED =
  'Card payments are misconfigured for this business — contact WorkWise support.';

function knownStatus(settings: Awaited<ReturnType<typeof getPaymentSettings>>): {
  status: ConnectStatus;
  requirementsDue: string[];
  disabledReason: string | null;
  payouts: null;
} {
  return {
    status: settings.connect.status,
    requirementsDue: settings.connect.mirror?.stripe_connect_requirements_due ?? [],
    disabledReason: settings.connect.mirror?.stripe_connect_disabled_reason ?? null,
    payouts: null,
  };
}

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const settings = await getPaymentSettings(auth.ctx.supabase, auth.ctx.tenantId);
  if (!settings.connect.accountId) {
    return roundsJson(knownStatus(settings));
  }

  try {
    const account = await retrieveVerifiedAccount(
      auth.ctx.tenantId,
      settings.connect.accountId,
    );
    const status = await syncConnectMirror({ tenantId: auth.ctx.tenantId, account });
    const mirrorDue = [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ];
    const requirementsDue = [...new Set(mirrorDue)].sort();
    let payouts: PayoutSummary | null = null;
    if (status === 'active') {
      try {
        payouts = await getPayoutSummary({
          tenantId: auth.ctx.tenantId,
          accountId: settings.connect.accountId,
        });
      } catch (err) {
        console.error('[GET /api/rounds/stripe/status] payouts', err);
        payouts = null;
      }
    }
    return roundsJson({
      status,
      requirementsDue,
      disabledReason: account.requirements?.disabled_reason ?? null,
      payouts,
    });
  } catch (err) {
    if (err instanceof ConnectMismatchError) {
      return roundsJson({ error: MISCONFIGURED }, 500);
    }
    console.error('[GET /api/rounds/stripe/status]', err);
    return roundsJson(knownStatus(settings));
  }
}
