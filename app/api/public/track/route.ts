import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { looksLikeBot, originAllowed, parseSiteEvent } from '@/lib/analytics/site-events';

/**
 * Receives the cookie-free visitor events from joinworkwise.com and the sign-up pages.
 * Stores no IP address and sets no cookie. Always answers 204 so a slow or broken tracker can never be seen by a visitor.
 */

function corsHeaders(origin: string | null): Record<string, string> {
  return originAllowed(origin)
    ? { 'Access-Control-Allow-Origin': origin as string, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    : {};
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);
  const done = () => new NextResponse(null, { status: 204, headers });

  if (!originAllowed(origin) || looksLikeBot(request.headers.get('user-agent'))) return done();

  let text: string;
  try {
    text = await request.text();
  } catch {
    return done();
  }
  if (text.length > 2000) return done();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done();
  }

  const event = parseSiteEvent(body);
  if (!event) return done();

  try {
    const { error } = await createAdminClient().from('site_events').insert(event);
    // 42P01 = the table hasn't been pasted into Supabase yet; stay quiet until it is.
    if (error && error.code !== '42P01') console.error(`[track] insert failed: ${error.code ?? 'unknown'}`);
  } catch {
    console.error('[track] insert failed');
  }
  return done();
}
