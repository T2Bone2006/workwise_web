import { issueLoginCode } from '@/lib/accountant/access';
import { noStoreJson } from '@/lib/accountant/http';
import { sendAccountantCode } from '@/lib/emails/accountant-code';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** The accountant opened their link: email them a fresh 6-digit code. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const issued = await issueLoginCode(createAdminClient(), token);

  if (!issued.ok) {
    if (issued.error === 'not_found') return noStoreJson({ error: 'This link no longer works.' }, 404);
    if (issued.error === 'too_many') {
      return noStoreJson({ error: 'Too many codes. Wait an hour and try again.' }, 429);
    }
    return noStoreJson({ error: "Couldn't send a code. Try again." }, 500);
  }

  const sent = await sendAccountantCode({
    to: issued.email,
    businessName: issued.businessName,
    code: issued.code,
  });
  if (!sent.ok) return noStoreJson({ error: "Couldn't send a code. Try again." }, 500);
  return noStoreJson({ sent: true });
}
