import { countSegments, toGsm7 } from '@/lib/messaging/gsm';
import { londonHour, londonWallTimeToUtc } from '@/lib/messaging/london-time';

export type TextKind = 'follow_up' | 'booking_accepted' | 'booking_declined' | 'owner_alert';

export type TextContext = {
  first_name: string;
  business_name: string;
  sign_off: string;
  trade: string;
  owner_mobile_display: string | null; // '07700 900123'
  job_summary: string | null; // from the quote
  quote_kind: 'firm' | 'guide' | 'visit' | null;
  allowed_amounts: number[]; // follow_up: the firm quote; accepted: agreed_amount; else []
  booking_requested: boolean;
  price_changed: boolean;
  preferred_days: string[];
  link?: string; // owner_alert only (step 18)
  /** Owner alert only. booking_requested cannot tell an auto-accept from a call-back. */
  auto_accepted?: boolean;
  /** Owner alert when a customer replied to a Lite text. */
  reply_text?: string;
  customer_mobile_display?: string;
};

const CUSTOMER: TextKind[] = ['follow_up', 'booking_accepted', 'booking_declined'];

function roll(rand: () => number, min: number, max: number): number {
  const raw = rand();
  const unit = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
  return min + Math.floor(unit * (max - min + 1));
}

function londonYmd(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function addDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const day = String(next.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Customer kinds: now + 120–300s. Owner alert: now. 22:00–08:00 London moves to 08:00 (same morning if before 08:00) plus 0–300s. */
export function nextSendTime(now: Date, kind: TextKind, rand: () => number = Math.random): Date {
  const delaySec = CUSTOMER.includes(kind) ? roll(rand, 120, 300) : 0;
  const at = new Date(now.getTime() + delaySec * 1000);
  const hour = londonHour(at);
  if (hour < 22 && hour >= 8) return at;
  const ymd = londonYmd(at);
  const morning = hour >= 22 ? addDay(ymd) : ymd;
  const open = londonWallTimeToUtc(morning, 8, 0);
  return new Date(open.getTime() + roll(rand, 0, 300) * 1000);
}

export function firstName(full: string): string {
  const word = full.trim().split(/\s+/)[0] ?? '';
  if (!word) return 'there';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

function jobPhrase(summary: string | null, generic: boolean): string {
  if (generic) return 'your job';
  const trimmed = summary?.trim() ?? '';
  if (!trimmed) return 'your job';
  const chars = [...trimmed];
  chars[0] = chars[0]?.toLowerCase() ?? '';
  return chars.join('');
}

function ownMobile(display: string | null, drop: boolean): string {
  if (drop || !display) return 'my own mobile';
  return `my own mobile (${display})`;
}

function priceClause(c: TextContext): string {
  if (c.quote_kind === 'visit') return ', free visit';
  const amount = c.allowed_amounts[0];
  const max = c.allowed_amounts[1];
  if (c.quote_kind === 'firm' && typeof amount === 'number') return `, £${money(amount)}`;
  if (c.quote_kind === 'guide' && typeof amount === 'number' && typeof max === 'number') {
    return `, £${money(amount)}\u2013£${money(max)}`;
  }
  return '';
}

function ownerTail(c: TextContext): string {
  if (c.booking_requested) {
    const link = c.link?.trim();
    return link ? `Booking request \u2013 tap to decide: ${link}` : 'Booking request \u2013 tap to decide.';
  }
  if (c.auto_accepted) return 'Auto-accepted.';
  return 'Call back wanted.';
}

function compose(kind: TextKind, c: TextContext, generic: boolean, dropMobile: boolean): string {
  const first = c.first_name || 'there';
  const sign = c.sign_off;
  const business = c.business_name;
  const job = jobPhrase(c.job_summary, generic);
  const mobile = ownMobile(c.owner_mobile_display, dropMobile);
  const amount = c.allowed_amounts[0];

  if (kind === 'follow_up') {
    return `Hi ${first}, it's ${sign} from ${business}. Thanks for getting in touch about ${job}. I'll message you from ${mobile} soon to confirm an exact price. ${sign}`;
  }
  if (kind === 'booking_accepted' && c.quote_kind === 'firm' && typeof amount === 'number' && c.price_changed) {
    return `Hi ${first}, ${sign} here. Having looked at it again, ${job} would be £${money(amount)}. I'll message you from ${mobile} to fix a time. Cheers, ${sign}`;
  }
  if (kind === 'booking_accepted' && c.quote_kind === 'firm' && typeof amount === 'number') {
    return `Hi ${first}, ${sign} here. Happy to do ${job} for £${money(amount)}. I'll message you from ${mobile} to fix a time. Cheers, ${sign}`;
  }
  if (kind === 'booking_accepted') {
    return `Hi ${first}, ${sign} here. Happy to come and have a look at ${job} \u2013 there's no charge for the visit. I'll message you from ${mobile} to fix a time. Cheers, ${sign}`;
  }
  if (kind === 'booking_declined') {
    return `Hi ${first}, ${sign} here. Thanks for asking, but I can't take on ${job} at the moment. Sorry about that, and good luck with it. ${sign}`;
  }
  return `New enquiry: ${first} \u2013 ${job}${priceClause(c)}. ${ownerTail(c)}`;
}

function replySentence(first: string, reply: string, mobile: string): string {
  const on = mobile === '' ? '' : ` on ${mobile}`;
  return `${first} replied: "${reply}" \u2013 reply from your own phone${on}.`;
}

/** Shorten the quoted reply (ending with an ellipsis) until the alert fits in 2 segments. */
function fitOwnerReply(c: TextContext): string {
  const first = c.first_name || 'there';
  const mobile = c.customer_mobile_display?.trim() ?? '';
  const reply = c.reply_text ?? '';
  const full = toGsm7(replySentence(first, reply, mobile));
  if (countSegments(full).segments <= 2) return full;

  const fitted = (chars: string[], withMobile: string): string | null => {
    let best: string | null = null;
    let lo = 0;
    let hi = chars.length;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const cut = chars.slice(0, mid).join('');
      const shown = cut === '' ? '' : `${cut}\u2026`;
      const candidate = toGsm7(replySentence(first, shown, withMobile));
      if (countSegments(candidate).segments <= 2) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  };

  const chars = [...reply];
  return fitted(chars, mobile) ?? fitted(chars, '') ?? toGsm7(replySentence(first, '', ''));
}

/** Fixed wording, GSM-7, at most 2 segments. A long job becomes "your job"; if it is still too long the mobile number is left out. A reply alert trims the quoted reply first. */
export function fallbackText(kind: TextKind, c: TextContext): string {
  if (kind === 'owner_alert' && typeof c.reply_text === 'string') return fitOwnerReply(c);
  const full = toGsm7(compose(kind, c, false, false));
  if (countSegments(full).segments <= 2) return full;
  const shorter = toGsm7(compose(kind, c, true, false));
  if (countSegments(shorter).segments <= 2) return shorter;
  return toGsm7(compose(kind, c, true, true));
}

const LINK_RE = /https?:\/\/|www\./i;
const POUND_RE = /£(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

function poundsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}

/** Accept a draft only when it is short, has no link, names the tradie, sticks to allowed prices, and includes their mobile when we have one. */
export function validateDraft(
  text: string,
  c: TextContext,
): { ok: true; text: string } | { ok: false; reason: string } {
  const gsm = toGsm7(text).trim();
  if (countSegments(gsm).segments > 2) return { ok: false, reason: 'too_long' };
  if (LINK_RE.test(gsm)) return { ok: false, reason: 'link' };
  if (!c.sign_off || !gsm.includes(c.sign_off)) return { ok: false, reason: 'sign_off' };
  if (/£(?!\d)/.test(gsm)) return { ok: false, reason: 'amount' };
  for (const match of gsm.matchAll(POUND_RE)) {
    const whole = match[1] ?? '';
    const frac = match[2] ?? '0';
    const value = Number(`${whole.replace(/,/g, '')}.${frac}`);
    if (!c.allowed_amounts.some((amount) => poundsEqual(amount, value))) {
      return { ok: false, reason: 'amount' };
    }
  }
  if (c.owner_mobile_display && !gsm.includes(c.owner_mobile_display)) {
    return { ok: false, reason: 'mobile' };
  }
  return { ok: true, text: gsm };
}
