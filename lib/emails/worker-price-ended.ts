import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

const SUBJECT = 'Your Lite price is changing';

/**
 * The heads-up when a self-employed worker stops being connected to a Pro business, so their
 * 20% Lite price comes off at the next bill. `employerName` is null when the employer is not known
 * (for example the worker record was deleted).
 */
export function buildWorkerPriceEndedEmail(p: {
  businessName: string;
  employerName: string | null;
}): { subject: string; html: string; text: string } {
  const business = oneLine(p.businessName);
  const employer = p.employerName ? oneLine(p.employerName) : null;
  const why = employer ? `because you work with ${employer}` : 'because you worked with a Pro business';

  const text = [
    `You've had 20% off WorkWise Lite ${why}. That connection has ended, so from your next bill Lite is £35 a month.`,
    `Nothing else changes: ${business}, your leads and your settings stay exactly as they are. If you think this is a mistake, reply to this email.`,
  ].join('\n\n');

  const bodyHtml = `
              <p style="margin:0 0 16px;">
                You&#39;ve had <strong>20% off WorkWise Lite</strong> ${escapeHtml(why)}. That connection has ended,
                so from your next bill Lite is <strong>£35 a month</strong>.
              </p>
              <p style="margin:0 0 16px;">
                Nothing else changes: <strong>${escapeHtml(business)}</strong>, your leads and your settings stay exactly as
                they are. If you think this is a mistake, reply to this email.
              </p>`;

  return {
    subject: SUBJECT,
    html: accountantEmailShell({ title: SUBJECT, heading: 'Your Lite price is changing', bodyHtml }),
    text,
  };
}

/** Only the error's name is ever logged: never the address or the business name. */
function logSendFailure(error: unknown): void {
  console.error('[sendWorkerPriceEnded] email not sent', { error: error instanceof Error ? error.name : 'ResendError' });
}

/** Sends it. Never throws: the discount has already come off, and a lost email must not undo that. */
export async function sendWorkerPriceEndedEmail(p: {
  to: string;
  businessName: string;
  employerName: string | null;
}): Promise<{ ok: true } | { ok: false }> {
  const built = buildWorkerPriceEndedEmail({ businessName: p.businessName, employerName: p.employerName });
  try {
    // Imported here, not at the top: Resend needs its API key the moment it loads, which would break every test that touches this file.
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: p.to,
      replyTo: 'support@joinworkwise.com',
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
