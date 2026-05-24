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
    .select('*')
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

  const { data: workerData } = await adminClient
    .from('workers')
    .select('user_id')
    .eq('email', record.email)
    .maybeSingle();

  if (!workerData?.user_id) {
    return Response.json({ error: 'Worker account not found' }, { status: 500 });
  }

  const { data: sessionData, error: sessionError } = await (
    adminClient.auth.admin as any
  ).createSession({
    user_id: workerData.user_id,
  });

  if (sessionError || !sessionData?.session) {
    return Response.json({ error: 'Failed to create session' }, { status: 500 });
  }

  await adminClient
    .from('worker_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);

  return Response.json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  });
}
