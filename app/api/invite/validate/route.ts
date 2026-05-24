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

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error('[invite/validate] admin client:', e);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const { data: record, error: lookupError } = await admin
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

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: record.email,
    options: {
      redirectTo: 'https://app.joinworkwise.com/accept-invite',
    },
  });

  if (error) {
    console.error('[invite/validate] generateLink:', error);
    return NextResponse.json({ error: 'Failed to generate sign in link' }, { status: 500 });
  }

  console.log('[validate] magicLinkUrl:', data.properties.action_link);

  const magicLinkUrl = data.properties?.action_link;
  if (!magicLinkUrl) {
    return NextResponse.json(
      { error: 'No action link returned from Supabase' },
      { status: 500 }
    );
  }

  const { error: markUsedError } = await admin
    .from('worker_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);

  if (markUsedError) {
    console.error('[invite/validate] mark used:', markUsedError);
  }

  return NextResponse.json({ magicLinkUrl });
}
