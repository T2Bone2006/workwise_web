import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

export type LeadReplyEmailInput = {
  firstName: string;
  fullName: string;
  body: string;
  mobileDisplay: string | null;
  telHref: string | null;
  smsHref: string | null;
  leadPageUrl: string | null;
  optedOut: boolean;
};

function button(href: string, label: string): string {
  const link = escapeHtml(href);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto;"><tr><td style="border-radius:8px;background:#1d4ed8;"><a href="${link}" target="_blank" style="display:inline-block;padding:12px 16px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

export function buildLeadReplyEmail(p: LeadReplyEmailInput): { subject: string; html: string; text: string } {
  const first = oneLine(p.firstName) || 'there';
  const subject = p.optedOut ? `${first} asked not to get texts` : `${first} replied to your text`;
  const fullName = oneLine(p.fullName) || first;
  const mobile = p.mobileDisplay?.trim() ?? '';
  const phoneText = mobile === '' ? '' : `Reply to them from your own phone: ${mobile}`;
  const opted = p.optedOut ? "WorkWise won't text them again. You can still ring them." : '';
  const quoted = p.body.split('\n').map((line) => `> ${line}`).join('\n');
  const see = p.leadPageUrl ? `See the lead: ${p.leadPageUrl}` : '';

  const text = [
    `${fullName} replied:`,
    '',
    quoted,
    '',
    ...(opted ? [opted, ''] : []),
    ...(phoneText ? [phoneText, ''] : []),
    ...(see ? [see] : []),
  ].join('\n');

  const quoteHtml = escapeHtml(p.body).replace(/\n/g, '<br />');
  const tel = p.telHref ? escapeHtml(p.telHref) : '';
  const sms = p.smsHref ? escapeHtml(p.smsHref) : '';
  const number = mobile === '' ? '' : tel ? `<a href="${tel}" style="color:#0C66E4;text-decoration:none;">${escapeHtml(mobile)}</a>` : escapeHtml(mobile);
  const textLink = sms ? ` <a href="${sms}" style="color:#0C66E4;text-decoration:none;">Text</a>` : '';
  const phoneHtml = number === '' ? '' : `<p style="margin:0 0 16px;">Reply to them from your own phone: ${number}.${textLink}</p>`;
  const optedHtml = opted ? `<p style="margin:0 0 16px;">${escapeHtml(opted)}</p>` : '';
  const seeHtml = p.leadPageUrl ? button(p.leadPageUrl, 'See the lead') : '';

  const bodyHtml = `
              <p style="margin:0 0 12px;">${escapeHtml(fullName)} replied:</p>
              <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #0C66E4;background:#f8fafc;color:#0f172a;white-space:pre-wrap;">${quoteHtml}</blockquote>
              ${optedHtml}
              ${phoneHtml}
              ${seeHtml}`;

  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: subject, bodyHtml }),
    text,
  };
}
