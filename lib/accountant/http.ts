import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_HOURS } from '@/lib/accountant/access';

/** JSON that is never cached: these answers are about one person's access. */
export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function noStore<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

const cookieBase = {
  name: SESSION_COOKIE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/accountant',
};

export function setSessionCookie(response: NextResponse, rawToken: string): void {
  response.cookies.set({ ...cookieBase, value: rawToken, maxAge: SESSION_HOURS * 3600 });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({ ...cookieBase, value: '', maxAge: 0 });
}
