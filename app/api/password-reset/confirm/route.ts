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
      { error: 'This reset link has already been used or has expired' },
      { status: 400 }
    );
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    console.error('[password-reset/confirm] admin client:', e);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { data: record, error: lookupError } = await adminClient
    .from('password_resets')
    .select('token, user_id')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (lookupError || !record) {
    if (lookupError) {
      console.error('[password-reset/confirm] lookup:', lookupError);
    }
    return NextResponse.json(
      { error: 'This reset link has already been used or has expired' },
      { status: 400 }
    );
  }

  const { error: updateUserError } = await adminClient.auth.admin.updateUserById(record.user_id, {
    password,
    email_confirm: true,
  });

  if (updateUserError) {
    console.error('[password-reset/confirm] updateUserById:', updateUserError);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: markUsedError } = await adminClient
    .from('password_resets')
    .update({ used_at: now })
    .eq('token', token);

  if (markUsedError) {
    console.error('[password-reset/confirm] mark used:', markUsedError);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
