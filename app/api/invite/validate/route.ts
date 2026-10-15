import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { parseInviteKind } from '@/lib/invites/worker-invite';

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

  // select('*') so this works whether or not the invite kind column has been added yet.
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

  // Names for the welcome line. Failing to read them never blocks the invite.
  const [{ data: employer }, { data: worker }] = await Promise.all([
    adminClient.from('tenants').select('name').eq('id', record.tenant_id).maybeSingle(),
    adminClient.from('workers').select('full_name').eq('id', record.worker_id).maybeSingle(),
  ]);

  return NextResponse.json({
    email: record.email,
    workerId: record.worker_id,
    kind: parseInviteKind((record as { kind?: unknown }).kind),
    employerName: employer?.name ?? null,
    workerName: worker?.full_name ?? null,
  });
}
