import { accountantEmailShell, escapeHtml } from '@/lib/emails/accountant-layout';

export type TextWarningLevel = 'low' | 'out';

/** Sent once when a business falls to 20 texts left, and once when it hits 0. */
export function buildLowTextsEmail(p: {
  level: TextWarningLevel;
  textsLeft: number;
  waiting: number;
  packsUrl: string;
}): { subject: string; html: string; text: string } {
  const out = p.level === 'out';
  const subject = out ? "You've run out of WorkWise texts" : "You're running low on WorkWise texts";
  const heading = out ? "You've run out of texts" : `Only ${p.textsLeft} texts left`;
  const waitingLine =
    p.waiting > 0
      ? `${p.waiting} message${p.waiting === 1 ? ' is' : 's are'} waiting for texts to go out. Customers with an email address still get emails; customers with only a phone number are waiting.`
      : 'Customers with an email address still get emails. Customers with only a phone number will not get their payment link by text until you have texts again.';
  const lines = [
    'Hi,',
    '',
    out ? 'Your business has used all its WorkWise texts.' : `Your business has ${p.textsLeft} WorkWise texts left.`,
    waitingLine,
    '',
    `Buy more texts, or turn on auto top-up so you never run out: ${p.packsUrl}`,
    '',
    'Questions? Just reply to this email.',
  ];
  const href = escapeHtml(p.packsUrl);
  const bodyHtml = `
              <p style="margin:0 0 16px;">Hi,</p>
              <p style="margin:0 0 16px;">${escapeHtml(lines[2]!)}</p>
              <p style="margin:0 0 16px;">${escapeHtml(waitingLine)}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Buy texts or turn on auto top-up
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:13px;">Questions? Just reply to this email.</p>`;
  return {
    subject,
    html: accountantEmailShell({ title: subject, heading, bodyHtml }),
    text: lines.join('\n'),
  };
}
