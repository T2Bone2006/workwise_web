const LOGO_URL = 'https://app.joinworkwise.com/brand/email-logo-reversed.png';

export function buildWorkerSignInEmailChangedEmail({
  workerName,
  tenantName,
  email,
}: {
  workerName: string;
  tenantName: string;
  email: string;
}): { subject: string; html: string } {
  const subject = 'Your WorkWise sign-in email has changed';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);padding:32px 24px;text-align:center;">
              <img src="${LOGO_URL}" alt="WorkWise" width="200" style="display:block;margin:0 auto 16px;height:auto;max-width:200px;border:0;" />
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.02em;">Your sign-in email has changed</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;color:#334155;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(workerName)},</p>
              <p style="margin:0 0 16px;">
                <strong>${escapeHtml(tenantName)}</strong> has changed the email you use to sign in to WorkWise.
              </p>
              <p style="margin:0 0 16px;">
                Sign in with <strong>${escapeHtml(email)}</strong>. Your password has not changed.
              </p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                If you didn't expect this, contact ${escapeHtml(tenantName)}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
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

  return { subject, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
