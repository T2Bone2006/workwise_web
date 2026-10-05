import { accountantEmailShell, escapeHtml, oneLine } from '@/lib/emails/accountant-layout';

export type NewLeadEmailInput = {
  businessName: string;
  firstName: string;
  fullName: string;
  mobileDisplay: string | null;
  email: string | null;
  postcode: string | null;
  preferredDays: string[];
  note: string | null;
  jobSummary: string | null;
  quote: { kind: 'firm' | 'guide' | 'visit'; amount?: number; min?: number; max?: number } | null;
  state: 'booking_request' | 'auto_accepted' | 'enquiry';
  actionLink: string | null;
  leadPageUrl: string;
};

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

function priceLabel(quote: NewLeadEmailInput['quote']): string | null {
  if (!quote) return null;
  if (quote.kind === 'visit') return 'free visit';
  if (quote.kind === 'firm' && typeof quote.amount === 'number') return `£${money(quote.amount)}`;
  if (quote.kind === 'guide' && typeof quote.min === 'number' && typeof quote.max === 'number') {
    return `£${money(quote.min)}\u2013£${money(quote.max)}`;
  }
  return null;
}

function daysLabel(days: string[]): string | null {
  const keys = days.map((day) => day.trim().toLowerCase()).filter((day) => day !== '');
  if (keys.length === 0) return null;
  if (keys.includes('any')) return 'Any day';
  const labels = DAY_ORDER.filter((key) => keys.includes(key)).map((key) => DAY_LABELS[key] ?? key);
  return labels.length > 0 ? labels.join(', ') : null;
}

function jobLabel(summary: string | null): string {
  const trimmed = summary?.trim() ?? '';
  return trimmed === '' ? 'an enquiry' : oneLine(trimmed);
}

function headingFor(p: NewLeadEmailInput): string {
  if (p.state === 'booking_request') return `${oneLine(p.fullName)} wants to book`;
  if (p.state === 'auto_accepted') return 'Auto-accepted for you';
  return 'New enquiry from your website';
}

function subjectFor(p: NewLeadEmailInput, job: string, price: string | null): string {
  const first = oneLine(p.firstName) || 'there';
  if (p.state === 'booking_request') {
    return price ? `Booking request: ${first} \u2013 ${job} (${price})` : `Booking request: ${first} \u2013 ${job}`;
  }
  if (p.state === 'auto_accepted') {
    return price ? `Booked automatically: ${first} \u2013 ${job} (${price})` : `Booked automatically: ${first} \u2013 ${job}`;
  }
  return `New enquiry: ${first} \u2013 ${job}`;
}

function telHref(display: string): string {
  const digits = display.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

function smsHref(display: string): string {
  const digits = display.replace(/[^\d+]/g, '');
  return digits ? `sms:${digits}` : '';
}

type Row = { label: string; value: string; href?: string; note?: string };

function enquiryPrice(p: NewLeadEmailInput, price: string | null): Row | null {
  if (p.quote?.kind === 'firm' && price) {
    return {
      label: 'Estimate',
      value: price,
      note: 'This can change. You agree the price with them.',
    };
  }
  if (p.quote?.kind === 'visit') return { label: 'Price', value: 'Needs a look' };
  if (p.quote?.kind === 'guide' && price) return { label: 'Usual range', value: price };
  return null;
}

function detailRows(p: NewLeadEmailInput, job: string, price: string | null): Row[] {
  const rows: Row[] = [{ label: 'Job', value: job }];
  if (p.state === 'enquiry') {
    const estimate = enquiryPrice(p, price);
    if (estimate) rows.push(estimate);
  } else if (price) {
    rows.push({
      label: 'Price offered',
      value: price,
      ...(p.quote?.kind === 'firm' ? { note: 'confirmed by you when you accept' } : {}),
    });
  }
  const mobile = p.mobileDisplay?.trim() ?? '';
  if (mobile) {
    const href = telHref(mobile);
    rows.push({ label: 'Mobile', value: mobile, ...(href ? { href } : {}) });
  }
  const email = oneLine(p.email ?? '');
  if (email) rows.push({ label: 'Email', value: email, href: `mailto:${email}` });
  const postcode = oneLine(p.postcode ?? '');
  if (postcode) rows.push({ label: 'Postcode', value: postcode });
  const days = daysLabel(p.preferredDays);
  if (days) rows.push({ label: 'Days that suit', value: days });
  const note = oneLine(p.note ?? '');
  if (note) rows.push({ label: 'Their note', value: note });
  return rows;
}

/** One full-width action in a vertical stack (email clients handle this reliably). */
function stackButton(href: string, icon: string, label: string, colour: string): string {
  const link = escapeHtml(href);
  return `<tr><td style="padding:0 0 10px 0;">
                <a href="${link}" target="_blank" style="display:block;box-sizing:border-box;width:100%;border-radius:10px;background:${colour};padding:14px 18px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;text-align:left;line-height:1.3;">
                  <span style="display:inline-block;min-width:1.6em;margin-right:8px;font-size:16px;line-height:1;" aria-hidden="true">${icon}</span>${escapeHtml(label)}
                </a>
              </td></tr>`;
}

function stackTable(rows: string[]): string {
  if (rows.length === 0) return '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:26px 0 8px 0;">${rows.join('')}</table>`;
}

/** Contact + View in WorkWise. Booking Accept/Decline stays available if a booking_request is ever issued again. */
function contactButtons(p: NewLeadEmailInput): { html: string; lines: string[] } {
  const rows: string[] = [];
  const lines: string[] = [];
  const mobile = p.mobileDisplay?.trim() ?? '';
  const call = mobile ? telHref(mobile) : '';
  const message = mobile ? smsHref(mobile) : '';
  const first = oneLine(p.firstName) || 'them';
  if (call) {
    rows.push(stackButton(call, '&#128222;', `Call ${first}`, '#059669'));
    lines.push(`Call: ${call}`);
  }
  if (message) {
    rows.push(stackButton(message, '&#128172;', `Message ${first}`, '#0284c7'));
    lines.push(`Message: ${message}`);
  }
  const email = oneLine(p.email ?? '');
  if (email) {
    const href = `mailto:${email}`;
    rows.push(stackButton(href, '&#9993;', `Email ${first}`, '#0f172a'));
    lines.push(`Email: ${href}`);
  }
  rows.push(stackButton(p.leadPageUrl, '&#8594;', 'View in WorkWise', '#1d4ed8'));
  lines.push(`View in WorkWise: ${p.leadPageUrl}`);
  return { html: stackTable(rows), lines };
}

function actionButtons(p: NewLeadEmailInput): { html: string; lines: string[] } {
  // Launch: every new lead is an enquiry. Booking buttons stay for the dormant booking path only.
  if (p.state !== 'booking_request') return contactButtons(p);
  if (!p.actionLink) {
    return {
      html: stackTable([stackButton(p.leadPageUrl, '&#8594;', 'View in WorkWise', '#1d4ed8')]),
      lines: [`View in WorkWise: ${p.leadPageUrl}`],
    };
  }
  const firm = p.quote?.kind === 'firm';
  const acceptLabel = firm ? 'Accept' : 'Accept the visit';
  const rows = [
    stackButton(`${p.actionLink}?do=accept`, '&#10003;', acceptLabel, '#059669'),
    ...(firm ? [stackButton(`${p.actionLink}?do=change`, '&#163;', 'Change price', '#0284c7')] : []),
    stackButton(`${p.actionLink}?do=decline`, '&#10005;', 'Decline', '#e11d48'),
  ];
  const lines = [
    `${acceptLabel}: ${p.actionLink}?do=accept`,
    ...(firm ? [`Change price: ${p.actionLink}?do=change`] : []),
    `Decline: ${p.actionLink}?do=decline`,
    'These open a page where you confirm with one more tap.',
  ];
  return {
    html: `${stackTable(rows)}
              <p style="margin:0 0 16px;color:#64748b;font-size:13px;">These open a page where you confirm with one more tap.</p>`,
    lines,
  };
}

export function buildNewLeadEmail(p: NewLeadEmailInput): { subject: string; html: string; text: string } {
  const job = jobLabel(p.jobSummary);
  const price = priceLabel(p.quote);
  const subject = subjectFor(p, job, price);
  const heading = headingFor(p);
  const first = oneLine(p.firstName) || 'there';
  const rows = detailRows(p, job, price);
  const actions = actionButtons(p);
  const followUp =
    p.state !== 'auto_accepted' && Boolean(p.mobileDisplay?.trim())
      ? `We've sent ${first} a friendly text from you saying you'll be in touch.`
      : '';
  const autoLine =
    p.state === 'auto_accepted'
      ? `We've told ${first} you're happy to do it. Message them from your own mobile to fix a time.`
      : '';

  const text = [
    heading,
    '',
    ...rows.flatMap((row) => [row.note ? `${row.label}: ${row.value} (${row.note})` : `${row.label}: ${row.value}`]),
    '',
    ...actions.lines,
    ...(actions.lines.length > 0 ? [''] : []),
    ...(autoLine ? [autoLine, ''] : []),
    ...(followUp ? [followUp, ''] : []),
    `See the whole conversation: ${p.leadPageUrl}`,
  ].join('\n');

  const rowHtml = rows
    .map((row) => {
      const value = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:#0C66E4;text-decoration:none;">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);
      const note = row.note
        ? `<br /><span style="color:#64748b;font-size:12px;">${escapeHtml(row.note)}</span>`
        : '';
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;font-weight:600;">${escapeHtml(row.label)}</p><p style="margin:4px 0 0;font-size:15px;color:#0f172a;">${value}${note}</p></td></tr>`;
    })
    .join('');

  const page = escapeHtml(p.leadPageUrl);
  const extra = [autoLine, followUp].filter((line) => line !== '');
  const extraHtml = extra
    .map((line) => `<p style="margin:0 0 16px;">${escapeHtml(line)}</p>`)
    .join('');

  const bodyHtml = `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rowHtml}</table>
              ${actions.html}
              ${extraHtml}
              <p style="margin:8px 0 0;font-size:13px;"><a href="${page}" style="color:#64748b;">See the whole conversation</a></p>`;

  return {
    subject,
    html: accountantEmailShell({ title: subject, heading, bodyHtml }),
    text,
  };
}
