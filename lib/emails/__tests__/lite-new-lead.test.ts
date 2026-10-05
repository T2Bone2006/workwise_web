import { describe, expect, it } from 'vitest';
import { buildNewLeadEmail, type NewLeadEmailInput } from '@/lib/emails/lite-new-lead';

const PAGE = 'https://app.joinworkwise.com/lite/leads/lead-1';
const ACTION = 'https://app.joinworkwise.com/lead/' + 'a'.repeat(43);

function input(overrides: Partial<NewLeadEmailInput> = {}): NewLeadEmailInput {
  return {
    businessName: "Dave's Plastering",
    firstName: 'Sarah',
    fullName: 'Sarah Jones',
    mobileDisplay: '07700 900456',
    email: 'sarah@example.com',
    postcode: 'M20 6AB',
    preferredDays: ['mon', 'wed'],
    note: 'The back door sticks',
    jobSummary: 'Back door lock',
    quote: { kind: 'firm', amount: 85 },
    state: 'booking_request',
    actionLink: ACTION,
    leadPageUrl: PAGE,
    ...overrides,
  };
}

describe('new lead email', () => {
  it('builds a booking request with three buttons that only open the page', () => {
    const email = buildNewLeadEmail(input());
    expect(email.subject).toBe('Booking request: Sarah \u2013 Back door lock (£85)');
    expect(email.html).toContain('Sarah Jones wants to book');
    expect(email.html).toContain('confirmed by you when you accept');
    expect(email.html).toContain('href="tel:07700900456"');
    expect(email.html).toContain('href="mailto:sarah@example.com"');
    expect(email.html).toContain('Days that suit');
    expect(email.html).toContain('Mon, Wed');
    expect(email.html).toContain(`${ACTION}?do=accept`);
    expect(email.html).toContain(`${ACTION}?do=change`);
    expect(email.html).toContain(`${ACTION}?do=decline`);
    expect(email.html).toContain('These open a page where you confirm with one more tap.');
    expect(email.html).toContain('We&#39;ve sent Sarah a friendly text from you saying you&#39;ll be in touch.');
    expect(email.text).toContain("We've sent Sarah a friendly text from you saying you'll be in touch.");
    expect(email.html).toContain(`href="${PAGE}"`);
    expect(email.text).toContain(`${ACTION}?do=accept`);
    expect(email.text).toContain(`See the whole conversation: ${PAGE}`);
    expect(email.html).not.toContain('do=accept&');
  });

  it('builds the auto-accepted email with contact buttons and no token', () => {
    const email = buildNewLeadEmail(input({ state: 'auto_accepted', actionLink: null }));
    expect(email.subject).toBe('Booked automatically: Sarah \u2013 Back door lock (£85)');
    expect(email.html).toContain('Auto-accepted for you');
    expect(email.html).toContain('We&#39;ve told Sarah you&#39;re happy to do it. Message them from your own mobile to fix a time.');
    expect(email.text).toContain("We've told Sarah you're happy to do it. Message them from your own mobile to fix a time.");
    expect(email.html).toContain('Call');
    expect(email.html).toContain('Message');
    expect(email.html).toContain('View in WorkWise');
    expect(email.html).not.toContain('?do=');
    expect(email.html).not.toContain(ACTION);
    expect(email.text).not.toContain('?do=');
    expect(email.text).not.toContain('friendly text');
  });

  it('builds a call-back enquiry with Call, Message, Email and View in WorkWise', () => {
    const email = buildNewLeadEmail(
      input({ state: 'enquiry', actionLink: null, quote: null, jobSummary: null, preferredDays: ['any'] }),
    );
    expect(email.subject).toBe('New enquiry: Sarah \u2013 an enquiry');
    expect(email.html).toContain('New enquiry from your website');
    expect(email.html).toContain('Any day');
    expect(email.html).toContain('href="tel:07700900456"');
    expect(email.html).toContain('href="sms:07700900456"');
    expect(email.html).toContain('href="mailto:sarah@example.com"');
    expect(email.html).toContain('Call Sarah');
    expect(email.html).toContain('Message Sarah');
    expect(email.html).toContain('Email Sarah');
    expect(email.html).toContain('View in WorkWise');
    expect(email.html).toContain('&#128222;');
    expect(email.html).toContain('&#128172;');
    expect(email.html).toContain('&#9993;');
    expect(email.html).toContain('display:block');
    expect(email.html).toContain('padding:0 0 10px 0');
    expect(email.html).toContain(PAGE);
    expect(email.html).not.toContain('?do=');
    expect(email.html).not.toContain('Price offered');
    expect(email.html).not.toContain(ACTION);
    expect(email.text).toContain(`Call: tel:07700900456`);
    expect(email.text).toContain(`View in WorkWise: ${PAGE}`);
  });

  it('shows an enquiry estimate with contact buttons and no accept buttons', () => {
    const email = buildNewLeadEmail(input({ state: 'enquiry', actionLink: null }));
    expect(email.subject).toBe('New enquiry: Sarah \u2013 Back door lock');
    expect(email.html).toContain('Estimate');
    expect(email.html).toContain('£85');
    expect(email.html).toContain('This can change. You agree the price with them.');
    expect(email.html).toContain('View in WorkWise');
    expect(email.html).not.toContain('Price offered');
    expect(email.html).not.toContain('confirmed by you when you accept');
    expect(email.html).not.toContain('?do=');
  });

  it('describes a visit enquiry as a look, not a booking', () => {
    const email = buildNewLeadEmail(input({ state: 'enquiry', actionLink: null, quote: { kind: 'visit' } }));
    expect(email.html).toContain('Needs a look');
    expect(email.html).not.toContain('free visit');
    expect(email.html).not.toContain('?do=');
  });

  it('leaves Change price off a guide or visit request', () => {
    const guide = buildNewLeadEmail(input({ quote: { kind: 'guide', min: 70, max: 120 } }));
    expect(guide.subject).toBe('Booking request: Sarah \u2013 Back door lock (£70\u2013£120)');
    expect(guide.html).toContain('Accept the visit');
    expect(guide.html).toContain('Decline');
    expect(guide.html).not.toContain('Change price');
    expect(guide.html).not.toContain('?do=change');

    const visit = buildNewLeadEmail(input({ quote: { kind: 'visit' } }));
    expect(visit.subject).toContain('(free visit)');
    expect(visit.html).not.toContain('Change price');
    expect(visit.html).toContain('Accept the visit');
  });

  it('escapes a customer name and drops empty rows', () => {
    const email = buildNewLeadEmail(
      input({
        fullName: '<script>alert(1)</script>',
        firstName: '<script>',
        jobSummary: '<b>lock</b>',
        note: null,
        email: null,
        postcode: '  ',
        mobileDisplay: null,
        preferredDays: [],
        state: 'enquiry',
        actionLink: null,
      }),
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>lock</b>');
    expect(email.html).toContain('&lt;b&gt;lock&lt;/b&gt;');
    expect(email.text).toContain('<b>lock</b>');
    expect(email.html).not.toContain('Their note');
    expect(email.html).not.toContain('Postcode');
    expect(email.html).not.toContain('mailto:');
    expect(email.html).toContain('View in WorkWise');
    expect(email.html).not.toContain('>Call<');
    expect(email.subject).not.toMatch(/[\r\n]/);

    const booking = buildNewLeadEmail(
      input({
        fullName: '<script>alert(1)</script>',
        firstName: '<script>',
        jobSummary: '<b>lock</b>',
        note: null,
        email: null,
        postcode: '  ',
        mobileDisplay: null,
        preferredDays: [],
      }),
    );
    expect(booking.html).toContain('&lt;script&gt;');
    expect(booking.text).toContain('<script>alert(1)</script>');
  });

  it('shows View in WorkWise when the token could not be issued', () => {
    const email = buildNewLeadEmail(input({ actionLink: null }));
    expect(email.html).toContain('View in WorkWise');
    expect(email.html).toContain(PAGE);
    expect(email.html).not.toContain('?do=');
    expect(email.text).toContain(`View in WorkWise: ${PAGE}`);
  });
});
