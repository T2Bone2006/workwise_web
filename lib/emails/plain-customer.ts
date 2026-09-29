import { emailDocument } from '@/lib/emails/visit-done';

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function trimUrl(raw: string): string {
  return raw.replace(/[),.;!?]+$/g, '');
}

/** Simple branded email from a short text: same look as lib/emails/visit-done.ts, text escaped, URLs turned into a button when there is exactly one. */
export function buildPlainCustomerEmail(p: {
  businessName: string;
  logoUrl: string | null;
  subject: string;
  text: string;
}): { subject: string; html: string; text: string } {
  const found = [...p.text.matchAll(URL_RE)].map((m) => trimUrl(m[0]));
  const unique = [...new Set(found)];

  let payUrl: string | null = null;
  let payLabel: string | null = null;
  let body = p.text;

  if (unique.length === 1) {
    payUrl = unique[0];
    payLabel = /\/pay\//.test(payUrl) ? 'Pay now' : 'Open link';
    body = p.text
      .replace(URL_RE, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  const paragraphs = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const signOff = `Thanks,\n${p.businessName}`;
  const html = emailDocument({
    subject: p.subject,
    brand: { businessName: p.businessName, logoUrl: p.logoUrl },
    greeting: 'Hello,',
    paragraphs: paragraphs.length > 0 ? paragraphs : [p.text],
    payUrl,
    payLabel,
    bankLine: null,
    signOff,
  });

  return { subject: p.subject, html, text: p.text };
}
