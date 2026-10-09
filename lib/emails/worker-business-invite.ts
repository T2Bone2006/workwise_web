import { APP_DOWNLOAD_URL } from '@/lib/app-stores';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const LOGO_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/assets/workwise_logo.png`
  : 'https://app.joinworkwise.com/workwise_logo.png';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The invite a self-employed worker gets: set a password and tell us about their business. */
export function buildWorkerBusinessInviteEmail({
  workerName,
  inviteUrl,
  tenantName,
}: {
  workerName: string;
  inviteUrl: string;
  tenantName: string;
}): { subject: string; html: string } {
  const subject = `${tenantName} has invited you to WorkWise`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);padding:32px 24px;text-align:center;">
              <img src="${LOGO_URL}" alt="WorkWise" width="120" height="120" style="display:block;margin:0 auto 16px;height:auto;max-width:120px;" />
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.02em;">Set up your WorkWise account</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;color:#334155;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(workerName)},</p>
              <p style="margin:0 0 16px;">
                <strong>${escapeHtml(tenantName)}</strong> uses WorkWise to give you jobs.
                Set up your account in about two minutes: choose a password and tell us your business name.
                You'll see your jobs from ${escapeHtml(tenantName)} in the WorkWise app and on the website.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px auto;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${escapeHtml(inviteUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Set up my account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#64748b;font-size:13px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;word-break:break-all;font-size:13px;">
                <a href="${escapeHtml(inviteUrl)}" style="color:#2563eb;">${escapeHtml(inviteUrl)}</a>
              </p>
              <p style="margin:0 0 8px;color:#64748b;font-size:13px;">
                Already set up? Get the app:
              </p>
              <p style="margin:0 0 24px;font-size:13px;">
                <a href="${escapeHtml(APP_DOWNLOAD_URL)}" style="color:#2563eb;font-weight:600;">Download WorkWise</a>
              </p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                This link works for 7 days. If you didn't expect this email, you can safely ignore it.
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
