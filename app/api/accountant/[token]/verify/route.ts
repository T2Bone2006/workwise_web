import { verifyLoginCode } from '@/lib/accountant/access';
import { noStoreJson, setSessionCookie } from '@/lib/accountant/http';
import { CODE_RE } from '@/lib/accountant/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Check the typed code; on success the 30-day session goes in an httpOnly cookie. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let code: unknown;
  try {
    code = ((await request.json()) as { code?: unknown } | null)?.code;
  } catch {
    code = undefined;
  }
  const typed = typeof code === 'string' ? code.trim() : '';
  if (!CODE_RE.test(typed)) return noStoreJson({ error: 'Enter the 6-digit code.' }, 400);

  const result = await verifyLoginCode(createAdminClient(), { linkToken: token, code: typed });
  if (!result.ok) {
    if (result.error === 'wrong_code') return noStoreJson({ error: "That code isn't right." }, 400);
    if (result.error === 'failed') return noStoreJson({ error: "Couldn't check that. Try again." }, 500);
    return noStoreJson({ error: 'That code has expired. Send a new one.' }, 400);
  }

  const response = noStoreJson({ ok: true });
  setSessionCookie(response, result.sessionToken);
  return response;
}
