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
    console.error('[customer-invite/validate] admin client:', e);
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
    console.error('[customer-invite/validate] lookup:', lookupError);
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 400 });
  }

  if (!record) {
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 400 });
  }

  const { data: portalUser } = await adminClient
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', record.customer_id)
    .maybeSingle();

  if (!portalUser?.user_id) {
    return Response.json({ error: 'Customer portal account not found' }, { status: 500 });
  }

  const tempPassword = crypto.randomUUID();

  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    portalUser.user_id,
    {
      password: tempPassword,
      email_confirm: true,
    }
  );

  if (updateError) {
    return Response.json({ error: 'Failed to prepare account' }, { status: 500 });
  }

  await adminClient
    .from('customer_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);

  return Response.json({
    email: record.email,
    tempPassword,
  });
}
