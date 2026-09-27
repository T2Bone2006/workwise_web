import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import {
  ConnectMismatchError,
  connectSignupDetails,
  createOnboardingLink,
  ensureConnectedAccount,
  isTenantAdmin,
} from '@/lib/stripe/connect';

const OWNER_ONLY = 'Only the account owner can set up card payments.';
const MISCONFIGURED =
  'Card payments are misconfigured for this business — contact WorkWise support.';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  if (!(await isTenantAdmin(auth.ctx.supabase, auth.ctx.userId))) {
    return roundsJson({ error: OWNER_ONLY }, 403);
  }

  const { data: userRow } = await auth.ctx.supabase
    .from('users')
    .select('email')
    .eq('id', auth.ctx.userId)
    .maybeSingle();
  const loginEmail = typeof userRow?.email === 'string' ? userRow.email : null;

  try {
    const identity = await connectSignupDetails(auth.ctx.tenantId, loginEmail);
    const { accountId } = await ensureConnectedAccount({
      tenantId: auth.ctx.tenantId,
      email: identity.email,
      businessName: identity.businessName,
    });
    const url = await createOnboardingLink({
      tenantId: auth.ctx.tenantId,
      accountId,
      from: 'app',
    });
    return roundsJson({ url });
  } catch (err) {
    if (err instanceof ConnectMismatchError) {
      return roundsJson({ error: MISCONFIGURED }, 500);
    }
    console.error('[POST /api/rounds/stripe/onboard]', err);
    return roundsJson({ error: 'Could not start card payments setup.' }, 500);
  }
}
