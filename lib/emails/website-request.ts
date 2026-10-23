import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

function line(value: string | null | undefined, empty: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || empty;
}

export type WebsiteRequestEmail = {
  businessName: string;
  tenantId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  plan: string;
  signedUp: string;
  keepFrom: string;
  trackerUrl: string;
};

/** Sent to the owner when a Lite customer says "Yes, build me one". */
export function buildWebsiteRequestEmail(p: WebsiteRequestEmail): { subject: string; html: string; text: string } {
  const business = oneLine(p.businessName) || 'A business';
  const subject = `Website request: ${business}`;
  const rows: [string, string][] = [
    ['Business', business],
    ['Name', line(p.name, 'not on file')],
    ['Email', line(p.email, 'not on file')],
    ['Phone', line(p.phone, 'not on file')],
    ['Plan', p.plan],
    ['Signed up', p.signedUp],
    ['Keeps the site from', p.keepFrom],
  ];
  const text = [
    `${business} said yes to the free one-page website.`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Tracker: ${p.trackerUrl}`,
  ].join('\n');

  const bodyHtml = `
              <p style="margin:0 0 12px;"><strong>${escapeHtml(business)}</strong> said yes to the free one-page website.</p>
              ${rows
                .map(
                  ([label, value]) =>
                    `<p style="margin:0 0 6px;">${escapeHtml(label)}: ${escapeHtml(value)}</p>`,
                )
                .join('')}
              <p style="margin:16px 0 0;"><a href="${escapeHtml(p.trackerUrl)}" style="color:#2563eb;">Open the tracker</a></p>`;

  return {
    subject,
    html: accountantEmailShell({ title: subject, heading: 'Website request', bodyHtml }),
    text,
  };
}

export async function sendWebsiteRequestEmail(
  p: WebsiteRequestEmail & { to: string; replyTo: string | null },
): Promise<{ ok: true } | { ok: false }> {
  const built = buildWebsiteRequestEmail(p);
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
      console.error('[website-request] email not sent', { error: error.name ?? 'ResendError' });
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[website-request] email not sent', { error: e instanceof Error ? e.name : 'ResendError' });
    return { ok: false };
  }
}
