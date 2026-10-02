import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { endSession, SESSION_COOKIE } from '@/lib/accountant/access';
import { clearSessionCookie, noStore } from '@/lib/accountant/http';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Sign out: end this session, clear the cookie, back to the sign-in screen. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sessionToken) await endSession(createAdminClient(), sessionToken);

  const response = NextResponse.redirect(new URL(`/accountant/${encodeURIComponent(token)}`, request.url), 303);
  clearSessionCookie(response);
  return noStore(response);
}
