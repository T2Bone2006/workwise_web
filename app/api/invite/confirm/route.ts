import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { BUSINESS_NAME_MESSAGE, INVITE_INVALID_MESSAGE, parseInviteKind } from '@/lib/invites/worker-invite';
import { businessSetupSchema } from '@/lib/validations/business-setup';

export async function POST(req: Request) {
  let body: { token?: string; password?: string; business?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token || !password) {
    return NextResponse.json(
      { error: 'This invite link has already been used or has expired' },
      { status: 400 }
    );
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    console.error('[invite/confirm] admin client:', e);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { data: record, error: lookupError } = await adminClient
    .from('worker_invites')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (lookupError) {
    console.error('[invite/confirm] lookup:', lookupError);
    return NextResponse.json(
      { error: 'This invite link has already been used or has expired' },
      { status: 400 }
    );
  }

  if (!record) {
    return NextResponse.json(
      { error: 'This invite link has already been used or has expired' },
      { status: 400 }
    );
  }

  const kind = parseInviteKind((record as { kind?: unknown }).kind);

  // A set-up invite needs the business details; check them before touching the password.
  let business: ReturnType<typeof businessSetupSchema.parse> | null = null;
  if (kind === 'business') {
    const parsed = businessSetupSchema.safeParse(body.business ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: BUSINESS_NAME_MESSAGE }, { status: 400 });
    }
    business = parsed.data;
  }

  const { data: worker, error: workerError } = await adminClient
    .from('workers')
    .select('user_id')
    .eq('id', record.worker_id)
    .maybeSingle();

  if (workerError) {
    console.error('[invite/confirm] worker lookup:', workerError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  if (!worker?.user_id) {
    console.error('[invite/confirm] worker missing user_id:', record.worker_id);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  const userId = worker.user_id;
  const now = new Date().toISOString();

  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });

  if (updateError) {
    console.error('[invite/confirm] updateUserById:', updateError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  if (kind === 'business' && business) {
    // Creates their own business and moves the login to it in one step. Safe to run twice:
    // the invite stays unused until it succeeds, so a failure here can simply be retried.
    const { error: rpcError } = await adminClient.rpc('accept_business_worker_invite', {
      p_token: token,
      p_business_name: business.businessName,
      p_trade: business.trade || null,
      p_postcode: business.postcode || null,
    });
    if (rpcError) {
      const invalid = /invite_invalid/.test(rpcError.message ?? '');
      console.error('[invite/confirm] accept business invite:', rpcError.code ?? rpcError.message);
      return NextResponse.json(
        { error: invalid ? INVITE_INVALID_MESSAGE : 'Failed to set up your account' },
        { status: invalid ? 400 : 500 },
      );
    }
    return NextResponse.json({ email: record.email, password, kind });
  }

  const { data: updatedRows, error: workerStatusError } = await adminClient
    .from('workers')
    .update({ invite_status: 'accepted', updated_at: now })
    .eq('id', record.worker_id)
    .select('id');

  if (workerStatusError || !updatedRows || updatedRows.length === 0) {
    console.error(
      '[invite/confirm] workers invite_status update failed or matched 0 rows:',
      workerStatusError,
      'worker_id:',
      record.worker_id
    );
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  const { error: upsertError } = await adminClient.from('users').upsert(
    {
      id: userId,
      email: record.email,
      role: 'worker',
      tenant_id: record.tenant_id,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'id' }
  );

  if (upsertError) {
    console.error('[invite/confirm] users upsert:', upsertError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  const { error: markUsedError } = await adminClient
    .from('worker_invites')
    .update({ used_at: now })
    .eq('token', token);

  if (markUsedError) {
    console.error('[invite/confirm] mark used:', markUsedError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  return NextResponse.json({
    email: record.email,
    password,
    kind,
  });
}
