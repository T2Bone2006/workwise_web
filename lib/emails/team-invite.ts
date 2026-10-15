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

/**
 * The email a new team member (a "lead") gets when the owner of a Rounds business adds them.
 * Plain on purpose: who added them, one button to choose a password, and where to get the app.
 * No prices (the owner agreed those), no promises about what they can do beyond the round.
 */
export function buildTeamInviteEmail({
  businessName,
  leadName,
  inviteUrl,
  appUrl = APP_DOWNLOAD_URL,
}: {
  businessName: string;
  leadName: string;
  inviteUrl: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const subject = `${businessName} has added you to their team on WorkWise`;

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
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.02em;">You're on the team</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;color:#334155;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(leadName)},</p>
              <p style="margin:0 0 16px;">
                <strong>${escapeHtml(businessName)}</strong> has added you to their team on WorkWise.
                You'll see your round on your phone, one house at a time.
              </p>
              <p style="margin:0 0 8px;"><strong>1.</strong> Choose a password:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:12px auto 24px;">
                <tr>
                  <td style="border-radius:8px;background:linear-gradient(to right,#1d4ed8,#2563eb,#06b6d4);">
                    <a href="${escapeHtml(inviteUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Choose my password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;"><strong>2.</strong> Install the latest WorkWise app, then sign in with this email:</p>
              <p style="margin:0 0 24px;font-size:14px;">
                <a href="${escapeHtml(appUrl)}" style="color:#2563eb;font-weight:600;">Get the WorkWise app</a>
              </p>
              <p style="margin:0 0 16px;color:#64748b;font-size:13px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;word-break:break-all;font-size:13px;">
                <a href="${escapeHtml(inviteUrl)}" style="color:#2563eb;">${escapeHtml(inviteUrl)}</a>
              </p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                This link lasts 7 days. If you didn't expect this email, you can safely ignore it.
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
