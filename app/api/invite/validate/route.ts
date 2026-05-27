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
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 400 });
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    console.error('[invite/validate] admin client:', e);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { data: record, error: lookupError } = await adminClient
    .from('worker_invites')
    .select('email, worker_id')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (lookupError) {
    console.error('[invite/validate] lookup:', lookupError);
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 400 });
  }

  if (!record) {
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 400 });
  }

  return NextResponse.json({
    email: record.email,
    workerId: record.worker_id,
  });
}
