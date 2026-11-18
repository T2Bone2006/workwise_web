import { accountantEmailShell, escapeHtml } from '@/lib/emails/accountant-layout';

type Content = { subject: string; html: string; text: string };

function button(href: string, label: string): string {
  return `
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      ${escapeHtml(label)}
                    </a>
                  </td>
                </tr>
              </table>`;
}

/** Sent every time auto top-up buys a pack. */
export function buildAutoTopUpReceiptEmail(p: {
  packLabel: string;
  texts: number;
  amountLabel: string;
  cardLabel: string;
  textsNow: number;
  spentThisMonthLabel: string;
  limitLabel: string;
  settingsUrl: string;
}): Content {
  const subject = `Receipt: ${p.texts.toLocaleString('en-GB')} WorkWise texts added (${p.amountLabel})`;
  const lines = [
    'Hi,',
    '',
    `Your texts were running low, so auto top-up bought ${p.packLabel} for ${p.amountLabel} from ${p.cardLabel}.`,
    `You now have ${p.textsNow.toLocaleString('en-GB')} texts.`,
    `This month: ${p.spentThisMonthLabel} of your ${p.limitLabel} limit.`,
    '',
    `Change your limit, or turn auto top-up off: ${p.settingsUrl}`,
  ];
  const bodyHtml = `
              <p style="margin:0 0 16px;">Hi,</p>
              <p style="margin:0 0 16px;">Your texts were running low, so auto top-up bought <strong>${escapeHtml(p.packLabel)}</strong> for <strong>${escapeHtml(p.amountLabel)}</strong> from ${escapeHtml(p.cardLabel)}.</p>
              <p style="margin:0 0 16px;">You now have <strong>${escapeHtml(p.textsNow.toLocaleString('en-GB'))}</strong> texts. This month: ${escapeHtml(p.spentThisMonthLabel)} of your ${escapeHtml(p.limitLabel)} limit.</p>
              ${button(p.settingsUrl, 'Change or turn off auto top-up')}`;
  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: 'Texts added', bodyHtml }),
    text: lines.join('\n'),
  };
}

/** Sent when the card could not be charged. Auto top-up is paused until the trader acts. */
export function buildAutoTopUpFailedEmail(p: {
  reason: 'card_failed' | 'needs_authentication' | 'no_card';
  buyUrl: string;
  settingsUrl: string;
}): Content {
  const subject = "We couldn't top up your WorkWise texts";
  const why =
    p.reason === 'needs_authentication'
      ? 'Your bank wanted you to confirm the payment, which we cannot do for you.'
      : p.reason === 'no_card'
        ? "There's no card on file to charge."
        : "We couldn't charge your card.";
  const lines = [
    'Hi,',
    '',
    why,
    'No texts have been bought. Customers with only a phone number will wait for their messages until you have texts again.',
    '',
    `Buy texts yourself: ${p.buyUrl}`,
    `Fix your card and switch auto top-up back on: ${p.settingsUrl}`,
  ];
  const bodyHtml = `
              <p style="margin:0 0 16px;">Hi,</p>
              <p style="margin:0 0 16px;">${escapeHtml(why)}</p>
              <p style="margin:0 0 16px;">No texts have been bought. Customers with only a phone number will wait for their messages until you have texts again.</p>
              ${button(p.buyUrl, 'Buy texts')}
              <p style="margin:0 0 16px;"><a href="${escapeHtml(p.settingsUrl)}" target="_blank">Fix your card and switch auto top-up back on</a></p>`;
  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: 'Auto top-up paused', bodyHtml }),
    text: lines.join('\n'),
  };
}
