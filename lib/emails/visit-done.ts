import type { ComposedMessage } from '@/lib/payments/messages';

const CUSTOMER_FROM_ADDRESS = 'noreply@joinworkwise.com';

/** Display name for customer mail. Strips quotes and angle brackets; name max 60 chars. */
export function customerEmailFrom(businessName: string): string {
  const name = businessName.replace(/["<>]/g, '').trim().slice(0, 60);
  return `"${name} via WorkWise" <${CUSTOMER_FROM_ADDRESS}>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pay £15 from the visit paragraphs: the running balance when one is named, else this visit. */
export function payButtonLabel(paragraphs: string[]): string {
  for (const paragraph of paragraphs) {
    const total =
      /^Including earlier visits, that comes to (£[\d,]+(?:\.\d+)?) in total/.exec(
        paragraph,
      );
    if (total) return `Pay ${total[1]}`;
  }
  for (const paragraph of paragraphs) {
    const due =
      /^There's (£[\d,]+(?:\.\d+)?) to pay for this visit/.exec(paragraph);
    if (due) return `Pay ${due[1]}`;
  }
  return 'Pay now';
}

export function emailDocument(parts: {
  subject: string;
  brand: { businessName: string; logoUrl: string | null };
  greeting: string;
  paragraphs: string[];
  payUrl: string | null;
  payLabel: string | null;
  bankLine: string | null;
  signOff: string;
}): string {
  const { brand } = parts;
  const name = escapeHtml(brand.businessName);
  const header = brand.logoUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr>
        <td class="ww-logo" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:8px;padding:6px 8px;">
          <img src="${escapeHtml(brand.logoUrl)}" alt="${name}" style="max-height:48px;display:block;border:0;" />
        </td>
        <td style="padding-left:14px;">
          <p class="ww-onbrand" style="margin:0;color:#ffffff;font-size:18px;font-weight:700;line-height:1.3;">${name}</p>
        </td>
      </tr></table>`
    : `<p class="ww-onbrand" style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:1.3;">${name}</p>`;

  const paragraphs = parts.paragraphs
    .map(
      (paragraph) =>
        `<p class="ww-text" style="margin:0 0 14px;color:#1e1b4b;font-size:15px;line-height:1.6;">${escapeHtml(paragraph)}</p>`,
    )
    .join('');

  const button =
    parts.payUrl && parts.payLabel
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;">
          <tr>
            <td class="ww-btn" bgcolor="#4f46e5" style="background-color:#4f46e5;border-radius:8px;">
              <a href="${escapeHtml(parts.payUrl)}" class="ww-btn-link" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.01em;">${escapeHtml(parts.payLabel)}</a>
            </td>
          </tr>
        </table>`
      : '';

  const bank = parts.bankLine
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
        <tr>
          <td class="ww-panel" bgcolor="#eef2ff" style="background-color:#eef2ff;border-radius:8px;padding:12px 14px;">
            <p class="ww-muted" style="margin:0;color:#3730a3;font-size:14px;line-height:1.5;">${escapeHtml(parts.bankLine)}</p>
          </td>
        </tr>
      </table>`
    : '';

  const signOff = escapeHtml(parts.signOff).replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(parts.subject)}</title>
  <style>
    @media (prefers-color-scheme: dark) {
      .ww-bg { background-color: #0b1020 !important; }
      .ww-card { background-color: #16132b !important; }
      .ww-header { background-color: #4338ca !important; }
      .ww-text, .ww-sign { color: #f8fafc !important; }
      .ww-muted { color: #e0e7ff !important; }
      .ww-panel { background-color: #312e81 !important; }
      .ww-footer { background-color: #100e24 !important; border-top-color: #3730a3 !important; }
      .ww-foot { color: #c7d2fe !important; }
      .ww-btn, .ww-btn-link { background-color: #6366f1 !important; color: #ffffff !important; }
    }
  </style>
</head>
<body class="ww-bg" bgcolor="#e0e7ff" style="margin:0;padding:0;background-color:#e0e7ff;color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" class="ww-bg" width="100%" cellspacing="0" cellpadding="0" bgcolor="#e0e7ff" style="background-color:#e0e7ff;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="ww-card" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td class="ww-header" bgcolor="#4f46e5" style="background-color:#4f46e5;padding:26px 28px;">
              ${header}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;">
              <p class="ww-text" style="margin:0 0 14px;color:#1e1b4b;font-size:16px;font-weight:600;line-height:1.6;">${escapeHtml(parts.greeting)}</p>
              ${paragraphs}
              ${button}
              ${bank}
              <p class="ww-sign" style="margin:4px 0 20px;color:#1e1b4b;font-size:15px;line-height:1.6;">${signOff}</p>
            </td>
          </tr>
          <tr>
            <td class="ww-footer" bgcolor="#eef2ff" style="padding:16px 28px;background-color:#eef2ff;border-top:1px solid #c7d2fe;">
              <p class="ww-foot" style="margin:0;color:#4338ca;font-size:12px;line-height:1.5;font-weight:600;">
                Sent by ${name} using WorkWise.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildVisitDoneEmail(
  msg: ComposedMessage,
  brand: { businessName: string; logoUrl: string | null },
): { subject: string; html: string; text: string } {
  return {
    subject: msg.subject,
    text: msg.text,
    html: emailDocument({
      subject: msg.subject,
      brand,
      greeting: msg.greeting,
      paragraphs: msg.paragraphs,
      payUrl: msg.payUrl,
      payLabel: msg.payUrl ? payButtonLabel(msg.paragraphs) : null,
      bankLine: msg.bankLine,
      signOff: msg.signOff,
    }),
  };
}
