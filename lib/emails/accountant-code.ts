import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

export function buildAccountantCodeEmail(p: {
  businessName: string;
  code: string;
}): { subject: string; html: string; text: string } {
  const business = oneLine(p.businessName);
  const subject = `Your code for ${business}'s books: ${p.code}`;

  const text = [
    `Your code is ${p.code}. It works for 10 minutes.`,
    '',
    `If you didn't try to open ${business}'s books, ignore this email — nobody can get in without the code.`,
  ].join('\n');

  const bodyHtml = `
              <p style="margin:0 0 12px;">Your code is</p>
              <p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:0.18em;color:#0f172a;"><strong>${escapeHtml(p.code)}</strong></p>
              <p style="margin:0 0 20px;">It works for 10 minutes.</p>
              <p style="margin:0;color:#64748b;font-size:13px;">
                If you didn&#39;t try to open ${escapeHtml(business)}&#39;s books, ignore this email — nobody can get in without the code.
              </p>`;

  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: 'Your sign-in code', bodyHtml }),
    text,
  };
}

export async function sendAccountantCode(p: {
  to: string;
  businessName: string;
  code: string;
}): Promise<{ ok: true } | { ok: false }> {
  const built = buildAccountantCodeEmail({ businessName: p.businessName, code: p.code });
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: p.to,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    if (error) {
      // Error name only: the code and the address never reach the log.
      console.error('[sendAccountantCode] email not sent', { error: error.name ?? 'ResendError' });
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[sendAccountantCode] email not sent', { error: e instanceof Error ? e.name : 'unknown' });
    return { ok: false };
  }
}
