import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    console.error('[password-reset/validate] admin client:', e);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { data: record, error: lookupError } = await adminClient
    .from('password_resets')
    .select('email, user_id')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (lookupError) {
    console.error('[password-reset/validate] lookup:', lookupError);
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }

  if (!record) {
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }

  return NextResponse.json({
    email: record.email,
    userId: record.user_id,
  });
}
