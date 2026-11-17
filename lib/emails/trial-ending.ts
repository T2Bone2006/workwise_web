import { accountantEmailShell, escapeHtml } from '@/lib/emails/accountant-layout';

const SUBJECT = 'Your WorkWise free trial ends soon';

/**
 * Sent about 3 days before a free trial ends (Stripe's trial_will_end event). It says the date, the amount
 * and exactly how to cancel, so nobody is charged by surprise.
 */
export function buildTrialEndingEmail(p: {
  planLabel: string;
  amountLabel: string; // "£17.50 a month"
  endsOn: string; // "20 Nov"
  founder: boolean;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const founderLine = p.founder ? ' That is your founder price, half price for life.' : '';
  const text = [
    'Hi,',
    '',
    `Your free trial of WorkWise ${p.planLabel} ends on ${p.endsOn}.`,
    `If you do nothing, your card will be charged ${p.amountLabel} that day.${founderLine}`,
    '',
    `Not for you? Cancel before ${p.endsOn} and you pay nothing: ${p.settingsUrl}`,
    '(Settings, then Plan & billing, then Cancel plan.)',
    '',
    'Questions? Just reply to this email.',
  ].join('\n');

  const href = escapeHtml(p.settingsUrl);
  const bodyHtml = `
              <p style="margin:0 0 16px;">Hi,</p>
              <p style="margin:0 0 16px;">
                Your free trial of WorkWise ${escapeHtml(p.planLabel)} ends on <strong>${escapeHtml(p.endsOn)}</strong>.
                If you do nothing, your card will be charged <strong>${escapeHtml(p.amountLabel)}</strong> that day.${escapeHtml(founderLine)}
              </p>
              <p style="margin:0 0 16px;">
                Not for you? Cancel before ${escapeHtml(p.endsOn)} and you pay nothing.
                Go to Settings, then Plan &amp; billing, then Cancel plan.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Open Plan &amp; billing
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:13px;">Questions? Just reply to this email.</p>`;

  return {
    subject: SUBJECT,
    html: accountantEmailShell({ title: SUBJECT, heading: 'Your free trial ends soon', bodyHtml }),
    text,
  };
}

export async function sendTrialEndingEmail(p: {
  to: string;
  subscriptionId: string;
  content: ReturnType<typeof buildTrialEndingEmail>;
}): Promise<{ ok: boolean }> {
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const safe = p.subscriptionId.replace(/[^A-Za-z0-9_-]/g, '');
    const { error } = await resend.emails.send(
      {
        from: FROM_EMAIL,
        to: p.to,
        replyTo: 'support@joinworkwise.com',
        subject: p.content.subject,
        html: p.content.html,
        text: p.content.text,
      },
      { idempotencyKey: `trial-ending-${safe}` },
    );
    if (error) {
      console.error('[trial-ending] email not sent', { error: error.name ?? 'ResendError' });
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[trial-ending] email not sent', { error: e instanceof Error ? e.name : 'Error' });
    return { ok: false };
  }
}
