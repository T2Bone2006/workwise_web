// Shared by the two accountant emails: same branded shell as the other WorkWise emails.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const LOGO_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/assets/workwise_logo.png`
  : 'https://app.joinworkwise.com/workwise_logo.png';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A header can't carry a line break: keep names to one line wherever they land in a subject. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function accountantEmailShell(p: { title: string; heading: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(p.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);padding:28px 24px;text-align:center;">
              <img src="${LOGO_URL}" alt="WorkWise" width="96" height="96" style="display:block;margin:0 auto 14px;height:auto;max-width:96px;" />
              <h1 style="margin:0;color:#ffffff;font-size:21px;font-weight:600;letter-spacing:-0.02em;">${escapeHtml(p.heading)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px;color:#334155;font-size:15px;line-height:1.6;">
              ${p.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                &copy; ${new Date().getFullYear()} WorkWise &middot;
                <a href="https://joinworkwise.com" style="color:#64748b;text-decoration:none;">joinworkwise.com</a>
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
