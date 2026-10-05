import { describe, expect, it } from 'vitest';
import { addDays, todayInLondon } from '@/lib/rounds/dates';
import { londonWallTimeToUtc } from '@/lib/messaging/london-time';
import { mapLeadDetail, textLabel, type LeadText } from '@/lib/data/lite/lead-detail';

function text(overrides: Partial<LeadText> & Pick<LeadText, 'kind' | 'status'>): LeadText {
  return {
    id: 'text-1',
    skipReason: null,
    body: null,
    sendAfter: null,
    sentAt: null,
    createdAt: '2026-10-02T12:00:00.000Z',
    ...overrides,
  };
}

function at(ymd: string, hour: number, minute: number): string {
  return londonWallTimeToUtc(ymd, hour, minute).toISOString();
}

describe('textLabel', () => {
  const today = todayInLondon();

  it('names every kind', () => {
    expect(textLabel(text({ kind: 'follow_up', status: 'sending' }), 'Sarah').title).toBe('Follow-up to Sarah');
    expect(textLabel(text({ kind: 'booking_accepted', status: 'sending' }), 'Sarah').title).toBe("'Happy to do it' text");
    expect(textLabel(text({ kind: 'booking_declined', status: 'sending' }), 'Sarah').title).toBe("'Sorry, can't take it' text");
    expect(textLabel(text({ kind: 'owner_alert', status: 'sending' }), 'Sarah').title).toBe('Alert to your mobile');
    expect(textLabel(text({ kind: 'reply_in', status: 'received' }), 'Sarah').title).toBe('Sarah replied');
  });

  it('says when a scheduled text will go, including tomorrow', () => {
    const scheduled = textLabel(
      text({ kind: 'follow_up', status: 'scheduled', sendAfter: at(today, 14, 3) }),
      'Sarah',
    );
    expect(scheduled).toMatchObject({ status: 'Going at 14:03', tone: 'sky' });

    const tomorrow = textLabel(
      text({ kind: 'follow_up', status: 'scheduled', sendAfter: at(addDays(today, 1), 8, 0) }),
      'Sarah',
    );
    expect(tomorrow).toMatchObject({ status: 'Going tomorrow at 08:00', tone: 'sky' });

    const laterDay = addDays(today, 3);
    const later = textLabel(
      text({ kind: 'follow_up', status: 'scheduled', sendAfter: at(laterDay, 9, 15) }),
      'Sarah',
    );
    const dayMonth = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      day: 'numeric',
      month: 'short',
    }).format(londonWallTimeToUtc(laterDay, 9, 15));
    expect(later.status).toBe(`Going ${dayMonth} at 09:15`);
  });

  it('covers every status', () => {
    const sentAt = at(today, 14, 3);
    expect(textLabel(text({ kind: 'follow_up', status: 'sending' }), 'Sarah')).toMatchObject({
      status: 'Sending\u2026',
      tone: 'sky',
    });
    expect(textLabel(text({ kind: 'follow_up', status: 'sent', sentAt }), 'Sarah')).toMatchObject({
      status: 'Sent 14:03',
      tone: 'emerald',
    });
    expect(textLabel(text({ kind: 'follow_up', status: 'emailed' }), 'Sarah')).toMatchObject({
      status: 'Emailed instead \u2014 no texts left',
      tone: 'amber',
    });
    expect(textLabel(text({ kind: 'follow_up', status: 'failed' }), 'Sarah')).toMatchObject({
      status: "Didn't send",
      tone: 'rose',
    });
    expect(textLabel(text({ kind: 'reply_in', status: 'received', sentAt }), 'Sarah')).toMatchObject({
      status: 'Received 14:03',
      tone: 'violet',
    });
  });

  it('covers every skip reason', () => {
    const skipped = (reason: string) =>
      textLabel(text({ kind: 'follow_up', status: 'skipped', skipReason: reason }), 'Sarah');
    expect(skipped('no_texts_left')).toMatchObject({ status: 'Not sent \u2014 out of texts', tone: 'rose' });
    expect(skipped('opted_out')).toMatchObject({
      status: "Not sent \u2014 they've asked for no texts",
      tone: 'slate',
    });
    expect(skipped('follow_ups_off')).toMatchObject({
      status: "Not sent \u2014 'Text customers for me' is off",
      tone: 'slate',
    });
    expect(skipped('lead_closed')).toMatchObject({
      status: "Not needed \u2014 you'd already decided",
      tone: 'slate',
    });
    expect(skipped('no_mobile')).toMatchObject({ status: 'Not sent \u2014 no mobile saved', tone: 'slate' });
  });
});

function leadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Sarah Jones',
    job_summary: 'Ceiling skim',
    quote_kind: 'firm',
    quote_amount: 85,
    quote_min: null,
    quote_max: null,
    agreed_amount: 95,
    status: 'won',
    booking_status: 'accepted',
    decided_by: 'owner',
    created_at: '2026-10-02T13:03:00.000Z',
    status_changed_at: '2026-10-02T14:00:00.000Z',
    booked_for_date: '2026-10-08',
    booked_for_time: '10:00:00',
    postcode: 'SW1A 1AA',
    phone: '07123 456789',
    preferred_days: ['mon', 'thu'],
    follow_up_problem: null,
    converted_customer_id: null,
    converted_job_id: null,
    widget_conversation_id: '22222222-2222-4222-8222-222222222222',
    email: 'sarah@example.com',
    customer_note: 'After school',
    decided_at: '2026-10-02T14:00:00.000Z',
    source: 'widget',
    ...overrides,
  };
}

describe('mapLeadDetail', () => {
  it('maps a lead with its conversation and keeps a visitor tag as text', () => {
    const detail = mapLeadDetail({
      lead: leadRow(),
      texts: [
        {
          id: 'b',
          kind: 'follow_up',
          status: 'sent',
          skip_reason: null,
          body: 'Hi Sarah',
          send_after: null,
          sent_at: '2026-10-02T15:00:00.000Z',
          created_at: '2026-10-02T15:00:00.000Z',
        },
        {
          id: 'a',
          kind: 'owner_alert',
          status: 'sent',
          skip_reason: null,
          body: 'New enquiry https://app.joinworkwise.com/lead/secret-token',
          send_after: null,
          sent_at: '2026-10-02T13:04:00.000Z',
          created_at: '2026-10-02T13:04:00.000Z',
        },
      ],
      conversation: {
        id: '22222222-2222-4222-8222-222222222222',
        messages: [
          { role: 'user', content: 'Can you skim a ceiling <b>this week</b>?', at: '2026-10-02T12:00:00.000Z' },
          { role: 'assistant', content: 'Yes, about £85.', at: '2026-10-02T12:01:00.000Z' },
          { role: 'system', content: 'ignored', at: '' },
        ],
        summary: 'Asked about a ceiling skim; offered £85.',
        tags: ['lead', 'firm_price'],
        created_at: '2026-10-02T12:00:00.000Z',
        status: 'ended',
      },
    });
    expect(detail).not.toBeNull();
    expect(detail?.lead.firstName).toBe('Sarah');
    expect(detail?.lead.email).toBe('sarah@example.com');
    expect(detail?.lead.customerNote).toBe('After school');
    expect(detail?.lead.preferredDays).toEqual(['mon', 'thu']);
    expect(detail?.lead.decidedAt).toBe('2026-10-02T14:00:00.000Z');
    expect(detail?.lead.bookedForTime).toBe('10:00');
    expect(detail?.lead.agreedAmount).toBe(95);
    expect(detail?.lead.source).toBe('widget');
    expect(detail?.texts.map((item) => item.id)).toEqual(['a', 'b']);
    expect(detail?.texts[0]?.body).toBeNull();
    expect(detail?.texts[1]?.body).toBe('Hi Sarah');
    expect(detail?.conversation).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      summary: 'Asked about a ceiling skim; offered £85.',
      tags: ['lead', 'firm_price'],
      status: 'ended',
      startedAt: '2026-10-02T12:00:00.000Z',
    });
    expect(detail?.conversation?.messages).toEqual([
      { role: 'user', content: 'Can you skim a ceiling <b>this week</b>?', at: '2026-10-02T12:00:00.000Z' },
      { role: 'assistant', content: 'Yes, about £85.', at: '2026-10-02T12:01:00.000Z' },
    ]);
  });

  it('maps an old copied lead that has no quote and no conversation', () => {
    const detail = mapLeadDetail({
      lead: leadRow({
        job_summary: null,
        quote_kind: null,
        quote_amount: null,
        agreed_amount: null,
        booking_status: 'none',
        decided_by: null,
        decided_at: null,
        booked_for_date: null,
        booked_for_time: null,
        preferred_days: [],
        customer_note: null,
        email: null,
        widget_conversation_id: null,
        status: 'new',
      }),
      texts: [],
      conversation: null,
    });
    expect(detail).not.toBeNull();
    expect(detail?.lead.quote).toBeNull();
    expect(detail?.lead.jobSummary).toBeNull();
    expect(detail?.lead.email).toBeNull();
    expect(detail?.conversation).toBeNull();
    expect(detail?.texts).toEqual([]);
    expect(detail?.lead.name).toBe('Sarah Jones');
    expect(detail?.lead.mobileDisplay).toBe('07123 456789');
  });

  it('returns null when the lead row cannot be read', () => {
    expect(mapLeadDetail({ lead: { name: 'No id' }, texts: [], conversation: null })).toBeNull();
  });
});
