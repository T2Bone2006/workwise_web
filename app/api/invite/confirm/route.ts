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
  });
}
