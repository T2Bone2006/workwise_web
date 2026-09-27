import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import {
  ConnectMismatchError,
  createExpressLoginLink,
  isTenantAdmin,
  retrieveVerifiedAccount,
  syncConnectMirror,
} from '@/lib/stripe/connect';

const OWNER_ONLY = 'Only the account owner can set up card payments.';
const MISCONFIGURED =
  'Card payments are misconfigured for this business — contact WorkWise support.';
const NOT_READY = 'Card payments are not set up yet';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  if (!(await isTenantAdmin(auth.ctx.supabase, auth.ctx.userId))) {
    return roundsJson({ error: OWNER_ONLY }, 403);
  }

  const settings = await getPaymentSettings(auth.ctx.supabase, auth.ctx.tenantId);
  if (!settings.connect.accountId) {
    return roundsJson({ error: NOT_READY }, 409);
  }

  try {
    const account = await retrieveVerifiedAccount(
      auth.ctx.tenantId,
      settings.connect.accountId,
    );
    const status = await syncConnectMirror({ tenantId: auth.ctx.tenantId, account });
    if (status !== 'active') {
      return roundsJson({ error: NOT_READY }, 409);
    }
    const url = await createExpressLoginLink({
      tenantId: auth.ctx.tenantId,
      accountId: settings.connect.accountId,
    });
    return roundsJson({ url });
  } catch (err) {
    if (err instanceof ConnectMismatchError) {
      return roundsJson({ error: MISCONFIGURED }, 500);
    }
    console.error('[POST /api/rounds/stripe/login-link]', err);
    return roundsJson({ error: 'Could not open Stripe.' }, 500);
  }
}
