import { NextResponse } from 'next/server';
import {
  lookupReferrer,
  normaliseReferralCode,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
} from '@/lib/billing/offers';

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinworkwise.com').replace(/\/$/, '');
}

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: raw } = await context.params;
  const site = siteBase();
  const code = normaliseReferralCode(raw);
  try {
    const referrer = code ? await lookupReferrer(code) : null;
    if (!referrer) {
      console.info('[referral] invalid');
      return NextResponse.redirect(`${site}/`);
    }
    console.info('[referral] valid');
    const response = NextResponse.redirect(`${site}/?ref=1`);
    response.cookies.set(REFERRAL_COOKIE, referrer.code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
    return response;
  } catch {
    console.info('[referral] invalid');
    return NextResponse.redirect(`${site}/`);
  }
}
