import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

export function buildAccountantInviteEmail(p: {
  businessName: string;
  inviterName: string | null;
  link: string;
}): { subject: string; html: string; text: string } {
  const business = oneLine(p.businessName);
  const who = oneLine(p.inviterName ?? '') || business;
  const subject = `${business} has given you access to their books`;

  const text = [
    'Hi,',
    '',
    `${who} uses WorkWise to run their business and has given you read-only access to their books: money in and out, expenses with receipt photos, invoices and payments, and downloads for their tax return.`,
    '',
    "You can't change anything and you won't see their customers' contact details.",
    '',
    `Open ${business}'s books: ${p.link}`,
    '',
    `Each time you open the link we'll email you a 6-digit code — no password needed. Keep this email; the link keeps working until ${business} removes your access.`,
    '',
    "If you weren't expecting this, you can ignore it.",
  ].join('\n');

  const link = escapeHtml(p.link);
  const bodyHtml = `
              <p style="margin:0 0 16px;">Hi,</p>
              <p style="margin:0 0 16px;">
                <strong>${escapeHtml(who)}</strong> uses WorkWise to run their business and has given you
                <strong>read-only</strong> access to their books: money in and out, expenses with receipt photos,
                invoices and payments, and downloads for their tax return.
              </p>
              <p style="margin:0 0 16px;">You can&#39;t change anything and you won&#39;t see their customers&#39; contact details.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${link}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Open ${escapeHtml(business)}&#39;s books
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;">
                Each time you open the link we&#39;ll email you a 6-digit code — no password needed. Keep this email;
                the link keeps working until ${escapeHtml(business)} removes your access.
              </p>
              <p style="margin:0 0 16px;color:#64748b;font-size:13px;">If the button doesn&#39;t work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 20px;word-break:break-all;font-size:13px;"><a href="${link}" style="color:#2563eb;">${link}</a></p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">If you weren&#39;t expecting this, you can ignore it.</p>`;

  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: 'Access to their books', bodyHtml }),
    text,
  };
}

/** Only the error's name is ever logged: never the link, a token or the address. */
function logSendFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'ResendError';
  console.error('[sendAccountantInvite] email not sent', { error: name });
}

export async function sendAccountantInvite(p: {
  to: string;
  businessName: string;
  inviterName: string | null;
  linkToken: string;
}): Promise<{ ok: true } | { ok: false }> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (!base) {
    console.error('[sendAccountantInvite] NEXT_PUBLIC_APP_URL not set');
    return { ok: false };
  }
  const built = buildAccountantInviteEmail({
    businessName: p.businessName,
    inviterName: p.inviterName,
    link: `${base}/accountant/${p.linkToken}`,
  });
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
      logSendFailure(new Error(error.name ?? 'ResendError'));
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    logSendFailure(e);
    return { ok: false };
  }
}
