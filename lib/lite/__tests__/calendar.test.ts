import { describe, expect, it } from 'vitest';
import { googleCalendarUrl, icsFile, leadCalendarEvent, type CalendarEvent } from '@/lib/lite/calendar';
import type { BoardLead } from '@/lib/data/lite/leads-board';

const NOW = new Date('2026-10-02T16:43:00.000Z');

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'lead-1@joinworkwise.com',
    title: 'Skim – Sarah Jones',
    date: '2026-10-09',
    time: '14:30',
    minutes: 60,
    location: 'SW1A 1AA',
    details: 'Mobile: 07123 456789\nPrice: £85\nFrom your website, via WorkWise',
    ...overrides,
  };
}

function lead(overrides: Partial<BoardLead> = {}): BoardLead {
  return {
    id: 'lead-1',
    name: 'Sarah Jones',
    firstName: 'Sarah',
    jobSummary: 'Skim',
    quote: { kind: 'firm', amount: 85 },
    agreedAmount: 85,
    status: 'won',
    bookingStatus: 'accepted',
    decidedBy: 'owner',
    createdAt: '2026-10-01T10:00:00.000Z',
    statusChangedAt: '2026-10-01T11:00:00.000Z',
    bookedForDate: '2026-10-09',
    bookedForTime: '14:30',
    postcode: 'SW1A 1AA',
    mobileDisplay: '07123 456789',
    preferredDays: ['thu'],
    flags: { followUpProblem: null, replied: false, converted: false },
    ...overrides,
  };
}

describe('googleCalendarUrl', () => {
  it('builds a timed London template for 9 Oct 14:30', () => {
    const url = googleCalendarUrl(event());
    expect(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&')).toBe(true);
    expect(url).toContain('dates=20261009T143000/20261009T153000&ctz=Europe/London');
  });

  it('builds an all-day template as the date and the next day', () => {
    expect(googleCalendarUrl(event({ time: null }))).toContain('dates=20261009/20261010');
  });

  it('rolls a visit that passes midnight onto the next date', () => {
    expect(googleCalendarUrl(event({ time: '23:30' }))).toContain('dates=20261009T233000/20261010T003000&ctz=Europe/London');
  });
});

describe('icsFile', () => {
  it('escapes commas, semicolons, backslashes and newlines, and stamps UTC', () => {
    const ics = icsFile(
      event({
        title: 'A, B; C\\D',
        location: 'SW1, 1AA',
        details: 'Line one\nLine two',
      }),
      NOW,
    );
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\\\D');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics).toContain('LOCATION:SW1\\, 1AA');
    expect(ics).toContain('DTSTAMP:20261002T164300Z');
    expect(ics).toContain('DTSTART;TZID=Europe/London:20261009T143000');
    expect(ics).toContain('DURATION:PT60M');
    expect(ics).toContain('PRODID:-//WorkWise//Lite//EN');
    expect(ics).toContain('UID:lead-1@joinworkwise.com');
  });

  it('folds lines past 75 octets and uses CRLF only', () => {
    const ics = icsFile(event({ title: 'A'.repeat(120), location: null }), NOW);
    expect(ics.replaceAll('\r\n', '')).not.toContain('\n');
    expect(ics).toContain('\r\n');
    expect(ics.endsWith('\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) {
      if (line === '') continue;
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain('\r\n ');
  });

  it('uses a date-only start for an all-day visit', () => {
    const ics = icsFile(event({ time: null }), NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261009');
    expect(ics).not.toContain('TZID=Europe/London:20261009');
  });
});

describe('leadCalendarEvent', () => {
  it('returns null unless the lead is won, accepted and dated', () => {
    expect(leadCalendarEvent(lead({ status: 'new', bookingStatus: 'none' }))).toBeNull();
    expect(leadCalendarEvent(lead({ status: 'new', bookingStatus: 'requested' }))).toBeNull();
    expect(leadCalendarEvent(lead({ status: 'lost', bookingStatus: 'declined' }))).toBeNull();
    expect(leadCalendarEvent(lead({ bookedForDate: null, bookedForTime: null }))).toBeNull();
  });

  it('titles the job, prices the agreed amount, and lasts an hour', () => {
    expect(leadCalendarEvent(lead())).toEqual({
      uid: 'lead-1@joinworkwise.com',
      title: 'Skim – Sarah Jones',
      date: '2026-10-09',
      time: '14:30',
      minutes: 60,
      location: 'SW1A 1AA',
      details: 'Mobile: 07123 456789\nPrice: £85\nFrom your website, via WorkWise',
    });
  });

  it('says free visit when there is no agreed amount, and Job when there is no summary', () => {
    const visit = leadCalendarEvent(
      lead({ jobSummary: '  ', agreedAmount: null, quote: { kind: 'visit' }, mobileDisplay: null, postcode: null }),
    );
    expect(visit?.title).toBe('Job – Sarah Jones');
    expect(visit?.details).toBe('Mobile: \nPrice: free visit\nFrom your website, via WorkWise');
    expect(visit?.location).toBeNull();
    expect(visit?.time).toBe('14:30');
  });

  it('keeps pence on an agreed amount', () => {
    expect(leadCalendarEvent(lead({ agreedAmount: 85.5 }))?.details).toContain('Price: £85.50');
  });
});
