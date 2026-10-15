import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

export type SetupRequestContext = 'review' | 'read_failed' | 'done';

const CONTEXT_LABEL: Record<SetupRequestContext, string> = {
  review: 'the review screen',
  read_failed: "a file that couldn't be read",
  done: 'after an import',
};

export type SetupRequestFileLink = { name: string; bytes: number; url: string };

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function line(value: string | null | undefined, empty: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || empty;
}

/** https only, so a bad signed-url value cannot become a javascript: link. */
function httpsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function buildSetupRequestEmail(p: {
  businessName: string;
  tenantId: string;
  traderName: string | null;
  traderEmail: string | null;
  traderPhone: string | null;
  note: string | null;
  context: SetupRequestContext;
  files: SetupRequestFileLink[];
}): { subject: string; html: string; text: string } {
  const business = oneLine(p.businessName) || 'A business';
  const subject = `Set-up request: ${business}`;
  const where = CONTEXT_LABEL[p.context];
  const note = line(p.note, '(none)');

  const fileLines =
    p.files.length === 0
      ? ['No files — note only.']
      : p.files.flatMap((file) => {
          const href = httpsUrl(file.url);
          return [`- ${file.name} (${formatFileSize(file.bytes)})`, href ?? file.url];
        });

  const text = [
    `Business: ${business}`,
    `Tenant: ${p.tenantId}`,
    `Name: ${line(p.traderName, 'not on file')}`,
    `Email: ${line(p.traderEmail, 'not on file')}`,
    `Phone: ${line(p.traderPhone, 'not on file')}`,
    `Where they got stuck: ${where}`,
    '',
    'Note:',
    note,
    '',
    'Files (each link works for 7 days):',
    ...fileLines,
  ].join('\n');

  const fileHtml =
    p.files.length === 0
      ? '<p style="margin:0;">No files — note only.</p>'
      : `<ul style="margin:0;padding-left:18px;">${p.files
          .map((file) => {
            const href = httpsUrl(file.url);
            const name = escapeHtml(file.name);
            const size = escapeHtml(formatFileSize(file.bytes));
            const link = href
              ? `<a href="${escapeHtml(href)}" style="color:#2563eb;">${name}</a>`
              : name;
            return `<li style="margin:0 0 8px;">${link} (${size})</li>`;
          })
          .join('')}</ul>`;

  const bodyHtml = `
              <p style="margin:0 0 12px;"><strong>${escapeHtml(business)}</strong> asked for help importing their round.</p>
              <p style="margin:0 0 6px;">Tenant: ${escapeHtml(p.tenantId)}</p>
              <p style="margin:0 0 6px;">Name: ${escapeHtml(line(p.traderName, 'not on file'))}</p>
              <p style="margin:0 0 6px;">Email: ${escapeHtml(line(p.traderEmail, 'not on file'))}</p>
              <p style="margin:0 0 6px;">Phone: ${escapeHtml(line(p.traderPhone, 'not on file'))}</p>
              <p style="margin:0 0 16px;">Where they got stuck: ${escapeHtml(where)}</p>
              <p style="margin:0 0 6px;"><strong>Note</strong></p>
              <p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(note)}</p>
              <p style="margin:0 0 8px;"><strong>Files</strong> <span style="color:#64748b;">(each link works for 7 days)</span></p>
              ${fileHtml}`;

  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: 'Set-up request', bodyHtml }),
    text,
  };
}

function logSendFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'ResendError';
  console.error('[sendSetupRequest] email not sent', { error: name });
}

export async function sendSetupRequestEmail(p: {
  to: string;
  replyTo: string | null;
  businessName: string;
  tenantId: string;
  traderName: string | null;
  traderEmail: string | null;
  traderPhone: string | null;
  note: string | null;
  context: SetupRequestContext;
  files: SetupRequestFileLink[];
}): Promise<{ ok: true } | { ok: false }> {
  const built = buildSetupRequestEmail(p);
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: p.to,
      ...(p.replyTo ? { replyTo: p.replyTo } : {}),
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    if (error) {
      logSendFailure(new Error(error.name ?? 'ResendError'));
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    logSendFailure(e);
    return { ok: false };
  }
}
