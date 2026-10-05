import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

const SUBJECT = 'Your WorkWise account is closed';

export function buildAccountClosedEmail(p: {
  businessName: string;
  purgeDate: string;
}): { subject: string; html: string; text: string } {
  const business = oneLine(p.businessName);
  const purgeDate = oneLine(p.purgeDate);
  const text = [
    `We've closed ${business}'s WorkWise account. Billing has stopped and nobody can sign in any more. Everything (customers, history, invoices, receipts) will be permanently deleted on ${purgeDate}. If you didn't mean to do this, reply to this email before then and we'll restore it.`,
  ].join('\n');

  const bodyHtml = `
              <p style="margin:0 0 16px;">
                We&#39;ve closed <strong>${escapeHtml(business)}</strong>&#39;s WorkWise account. Billing has stopped
                and nobody can sign in any more. Everything (customers, history, invoices, receipts) will be
                permanently deleted on <strong>${escapeHtml(purgeDate)}</strong>. If you didn&#39;t mean to do this,
                reply to this email before then and we&#39;ll restore it.
              </p>`;

  return {
    subject: SUBJECT,
    html: accountantEmailShell({ title: SUBJECT, heading: 'Your account is closed', bodyHtml }),
    text,
  };
}

/** Only the error's name is ever logged: never the address or the business name. */
function logSendFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'ResendError';
  console.error('[sendAccountClosed] email not sent', { error: name });
}

export async function sendAccountClosedEmail(p: {
  to: string;
  businessName: string;
  purgeDate: string;
}): Promise<{ ok: true } | { ok: false }> {
  const built = buildAccountClosedEmail({ businessName: p.businessName, purgeDate: p.purgeDate });
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
