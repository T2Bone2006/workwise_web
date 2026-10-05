import { describe, expect, it } from 'vitest';
import { countSegments, isGsm7 } from '@/lib/messaging/gsm';
import {
  fallbackText,
  firstName,
  nextSendTime,
  validateDraft,
  type TextContext,
  type TextKind,
} from '@/lib/lite/text-templates';

function ctx(overrides: Partial<TextContext> = {}): TextContext {
  return {
    first_name: 'Sarah',
    business_name: "Dave's Plastering",
    sign_off: 'Dave',
    trade: 'plastering',
    owner_mobile_display: '07700 900123',
    job_summary: 'Patch a wall',
    quote_kind: 'firm',
    allowed_amounts: [85],
    booking_requested: false,
    price_changed: false,
    preferred_days: ['mon'],
    ...overrides,
  };
}

describe('firstName', () => {
  it('uses the first word, capitalised', () => {
    expect(firstName('sarah jones')).toBe('Sarah');
    expect(firstName('  SARAH   Jones ')).toBe('Sarah');
    expect(firstName('')).toBe('there');
  });
});

describe('nextSendTime', () => {
  const zero = () => 0;
  const almostOne = () => 0.999;

  it('waits 2–5 minutes in the afternoon', () => {
    const afternoon = new Date('2026-06-15T13:00:00.000Z'); // 14:00 London
    expect(nextSendTime(afternoon, 'follow_up', zero).toISOString()).toBe('2026-06-15T13:02:00.000Z');
    expect(nextSendTime(afternoon, 'follow_up', almostOne).toISOString()).toBe('2026-06-15T13:05:00.000Z');
    expect(nextSendTime(afternoon, 'owner_alert', almostOne).toISOString()).toBe(afternoon.toISOString());
  });

  it('holds a 22:30 lead until 08:00–08:05 the next morning', () => {
    const night = new Date('2026-01-15T22:30:00.000Z');
    expect(nextSendTime(night, 'follow_up', zero).toISOString()).toBe('2026-01-16T08:00:00.000Z');
    expect(nextSendTime(night, 'follow_up', almostOne).toISOString()).toBe('2026-01-16T08:05:00.000Z');
    expect(nextSendTime(night, 'owner_alert', zero).toISOString()).toBe('2026-01-16T08:00:00.000Z');
  });

  it('holds a 06:10 lead until 08:00 the same morning', () => {
    const early = new Date('2026-01-15T06:10:00.000Z');
    expect(nextSendTime(early, 'booking_accepted', zero).toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('uses London time across the spring-forward Sunday', () => {
    // 22:30 GMT Saturday 28 March → 08:00 BST Sunday 29 March (07:00 UTC, not 08:00).
    const beforeChange = new Date('2026-03-28T22:30:00.000Z');
    expect(nextSendTime(beforeChange, 'follow_up', zero).toISOString()).toBe('2026-03-29T07:00:00.000Z');
    // 06:10 BST on the Sunday itself → 08:00 BST the same morning.
    const sundayMorning = new Date('2026-03-29T05:10:00.000Z');
    expect(nextSendTime(sundayMorning, 'follow_up', zero).toISOString()).toBe('2026-03-29T07:00:00.000Z');
    // Clocks have gone back by 06:10 on 25 October, so 08:00 London is 08:00 UTC.
    const autumn = new Date('2026-10-25T06:10:00.000Z');
    expect(nextSendTime(autumn, 'follow_up', zero).toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });
});

describe('fallbackText', () => {
  const kinds: TextKind[] = ['follow_up', 'booking_accepted', 'booking_declined', 'owner_alert'];

  it('fits every kind into 2 GSM-7 segments with a long business name and a long job', () => {
    const longName = "Dave's Plastering and Decorative Finishes of South Manchester";
    const longJob = 'Skim the whole ceiling after a leak stained it from one end to the other';
    for (const kind of kinds) {
      const text = fallbackText(
        kind,
        ctx({
          business_name: longName,
          job_summary: longJob.repeat(4),
          quote_kind: kind === 'owner_alert' ? 'guide' : 'firm',
          allowed_amounts: kind === 'owner_alert' ? [70, 120] : [85],
          booking_requested: true,
          link: 'https://app.joinworkwise.com/lead/abc',
        }),
      );
      expect(isGsm7(text), kind).toBe(true);
      expect(countSegments(text).segments, kind).toBeLessThanOrEqual(2);
      expect(text).not.toContain('\u2013');
    }
  });

  it('shortens the job before it drops the mobile number', () => {
    const text = fallbackText(
      'follow_up',
      ctx({ job_summary: 'Patch a wall'.repeat(40), booking_requested: true }),
    );
    expect(text).toContain('your job');
    expect(text).toContain('07700 900123');
    expect(text).toContain('confirm an exact price');
    expect(countSegments(text).segments).toBeLessThanOrEqual(2);
  });

  it('drops the mobile number when the names alone are still too long', () => {
    let dropped = '';
    for (let length = 80; length <= 260; length += 1) {
      const text = fallbackText('follow_up', ctx({ business_name: 'B'.repeat(length), job_summary: 'Tap' }));
      if (!text.includes('07700 900123')) {
        dropped = text;
        break;
      }
    }
    expect(dropped).not.toBe('');
    expect(dropped).toContain('my own mobile');
    expect(countSegments(dropped).segments).toBeLessThanOrEqual(2);
  });

  it('uses the fixed wording for each kind', () => {
    expect(fallbackText('follow_up', ctx())).toContain("I'll message you from my own mobile (07700 900123)");
    expect(fallbackText('follow_up', ctx())).toContain('confirm an exact price');
    expect(fallbackText('follow_up', ctx())).not.toContain('book');
    expect(fallbackText('follow_up', ctx())).not.toContain('£');
    expect(fallbackText('follow_up', ctx({ owner_mobile_display: null }))).not.toContain('(');
    expect(fallbackText('booking_accepted', ctx({ allowed_amounts: [85] }))).toContain('Happy to do patch a wall for £85');
    expect(fallbackText('booking_accepted', ctx({ price_changed: true, allowed_amounts: [90] }))).toContain(
      'Having looked at it again, patch a wall would be £90',
    );
    expect(fallbackText('booking_accepted', ctx({ quote_kind: 'visit', allowed_amounts: [] }))).toContain(
      "there's no charge for the visit",
    );
    expect(fallbackText('booking_declined', ctx({ allowed_amounts: [] }))).toContain("can't take on patch a wall");
    const alert = fallbackText('owner_alert', ctx({
      booking_requested: true,
      link: 'https://app.joinworkwise.com/lead/abc',
      allowed_amounts: [85],
    }));
    expect(alert).toContain('New enquiry: Sarah - patch a wall, £85');
    expect(alert).toContain('Booking request - tap to decide: https://app.joinworkwise.com/lead/abc');
    expect(fallbackText('owner_alert', ctx({ auto_accepted: true, allowed_amounts: [85] }))).toContain('Auto-accepted.');
    expect(fallbackText('owner_alert', ctx({ quote_kind: 'visit', allowed_amounts: [] }))).toContain('free visit');
    expect(fallbackText('owner_alert', ctx({ quote_kind: null, allowed_amounts: [] }))).toContain('Call back wanted.');
    expect(
      fallbackText('owner_alert', ctx({ quote_kind: 'guide', allowed_amounts: [70, 120], booking_requested: false })),
    ).toContain('£70-£120');
  });
});

describe('validateDraft', () => {
  const sample = ctx();
  const good =
    "Hi Sarah, it's Dave. Happy to do the patch for £85. I'll message you from my own mobile (07700 900123). Dave";

  it('accepts a short text with the sign-off, the mobile and an allowed price', () => {
    const result = validateDraft(`${good}\u2013 thanks`, sample);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('Dave');
      expect(result.text).not.toContain('\u2013');
      expect(isGsm7(result.text)).toBe(true);
    }
  });

  it('rejects a wrong amount, a link, a missing sign-off, 3 segments, or a missing mobile', () => {
    expect(validateDraft(good.replace('£85', '£80'), sample)).toEqual({ ok: false, reason: 'amount' });
    expect(validateDraft(`${good} https://example.com`, sample)).toEqual({ ok: false, reason: 'link' });
    expect(validateDraft(good.replaceAll('Dave', 'Dan'), sample)).toEqual({ ok: false, reason: 'sign_off' });
    expect(validateDraft(`${'Thanks for asking. '.repeat(40)} Dave 07700 900123`, sample)).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(validateDraft(good.replace('07700 900123', 'your phone'), sample)).toEqual({ ok: false, reason: 'mobile' });
  });
});
