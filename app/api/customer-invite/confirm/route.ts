import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let body: { token?: string; password?: string };
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
    console.error('[customer-invite/confirm] admin client:', e);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { data: record, error: lookupError } = await adminClient
    .from('customer_invites')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (lookupError) {
    console.error('[customer-invite/confirm] lookup:', lookupError);
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

  const { data: portalUser, error: portalUserError } = await adminClient
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', record.customer_id)
    .maybeSingle();

  if (portalUserError) {
    console.error('[customer-invite/confirm] portal user lookup:', portalUserError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  if (!portalUser?.user_id) {
    console.error('[customer-invite/confirm] portal user missing user_id:', record.customer_id);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  const userId = portalUser.user_id;
  const now = new Date().toISOString();

  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });

  if (updateError) {
    console.error('[customer-invite/confirm] updateUserById:', updateError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  const { error: upsertError } = await adminClient.from('users').upsert(
    {
      id: userId,
      email: record.email,
      role: 'customer_portal',
      tenant_id: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'id' }
  );

  if (upsertError) {
    console.error('[customer-invite/confirm] users upsert:', upsertError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  const { error: markUsedError } = await adminClient
    .from('customer_invites')
    .update({ used_at: now })
    .eq('token', token);

  if (markUsedError) {
    console.error('[customer-invite/confirm] mark used:', markUsedError);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }

  return NextResponse.json({
    email: record.email,
    password,
  });
}
