import { APP_DOWNLOAD_URL } from '@/lib/app-stores';
import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

const SUBJECT = 'Thanks for joining WorkWise';

/** A new Rounds account (including Rounds + Lite). Pro and Lite-only signups do not get this. */
export function roundsSignupGetsWelcome(product: string | null | undefined): boolean {
  return product === 'rounds' || product === 'both';
}

function greetingName(fullName: string): string | null {
  const first = oneLine(fullName).split(' ')[0] ?? '';
  return first || null;
}

/**
 * Thank-you for the person who just paid for Rounds. They do the round on the phone,
 * so the only action is the app download link.
 */
export function buildRoundsWelcomeEmail(p: {
  fullName: string;
  appUrl?: string;
}): { subject: string; html: string; text: string } {
  const appUrl = p.appUrl ?? APP_DOWNLOAD_URL;
  const name = greetingName(p.fullName);
  const hi = name ? `Hi ${name},` : 'Hi,';

  const text = [
    hi,
    '',
    'Thanks for signing up. Your round runs in the WorkWise app on your phone.',
    '',
    `Get the app: ${appUrl}`,
    '',
    'Sign in with this email address.',
  ].join('\n');

  const href = escapeHtml(appUrl);
  const bodyHtml = `
              <p style="margin:0 0 16px;">${name ? `Hi ${escapeHtml(name)},` : 'Hi,'}</p>
              <p style="margin:0 0 16px;">
                Thanks for signing up. Your round runs in the WorkWise app on your phone.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Get the WorkWise app
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;">Sign in with this email address.</p>
              <p style="margin:0;color:#64748b;font-size:13px;">
                If the button doesn&#39;t work, copy this link into your browser:<br />
                <a href="${href}" style="color:#2563eb;word-break:break-all;">${href}</a>
              </p>`;

  return {
    subject: SUBJECT,
    html: accountantEmailShell({ title: SUBJECT, heading: 'Thanks for joining', bodyHtml }),
    text,
  };
}

/** Resend keeps this key for a day, so a webhook retry does not send a second copy. */
export function roundsWelcomeIdempotencyKey(intentId: string): string {
  const safe = intentId.replace(/[^A-Za-z0-9_-]/g, '');
  return `rounds-welcome-${safe || 'signup'}`;
}

function logSendFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'ResendError';
  console.error('[sendRoundsWelcome] email not sent', { error: name });
}

export async function sendRoundsWelcomeEmail(p: {
  to: string;
  fullName: string;
  intentId: string;
}): Promise<{ ok: true } | { ok: false }> {
  const built = buildRoundsWelcomeEmail({ fullName: p.fullName });
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send(
      {
        from: FROM_EMAIL,
        to: p.to,
        replyTo: 'support@joinworkwise.com',
        subject: built.subject,
        html: built.html,
        text: built.text,
      },
      { idempotencyKey: roundsWelcomeIdempotencyKey(p.intentId) },
    );
    if (error) {
      console.error('[sendRoundsWelcome] email not sent', { error: error.name ?? 'ResendError' });
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    logSendFailure(e);
    return { ok: false };
  }
}
