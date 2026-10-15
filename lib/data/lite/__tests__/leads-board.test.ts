import { describe, expect, it } from 'vitest';
import { groupLeadsBoard, londonMonthStart, londonWeekStart, mapLeadRow, type LeadSource } from '@/lib/data/lite/leads-board';
import type { SetupStatus } from '@/lib/lite/setup-status';

const LIVE: SetupStatus = {
  state: 'live',
  profileVersion: 1,
  website: 'https://dave.example',
  redoInProgress: false,
};

function source(overrides: Partial<LeadSource> & Pick<LeadSource, 'id'>): LeadSource {
  return {
    name: 'Sarah Jones',
    jobSummary: 'Ceiling skim',
    quote: { kind: 'firm', amount: 85 },
    agreedAmount: null,
    status: 'new',
    bookingStatus: 'none',
    decidedBy: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    statusChangedAt: null,
    bookedForDate: null,
    bookedForTime: null,
    postcode: 'SW1A 1AA',
    mobileDisplay: '07123 456789',
    preferredDays: [],
    followUpProblem: null,
    converted: false,
    conversationId: null,
    ...overrides,
  };
}

describe('london week and month', () => {
  it('starts the week at Monday 00:00 London in BST and in GMT', () => {
    // Monday 5 Oct 2026 10:00 BST = 09:00 UTC. Monday midnight BST is the previous evening UTC.
    expect(londonWeekStart(new Date('2026-10-05T09:00:00.000Z')).toISOString()).toBe('2026-10-04T23:00:00.000Z');
    // Monday 5 Jan 2026 10:00 GMT.
    expect(londonWeekStart(new Date('2026-01-05T10:00:00.000Z')).toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('starts the month at the 1st 00:00 London', () => {
    // Thursday 1 Oct 2026 12:00 BST.
    expect(londonMonthStart(new Date('2026-10-01T11:00:00.000Z')).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    // Thursday 1 Jan 2026 00:30 GMT.
    expect(londonMonthStart(new Date('2026-01-01T00:30:00.000Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('groupLeadsBoard', () => {
  it('counts a brand-new board as zeros', () => {
    const board = groupLeadsBoard({
      leads: [],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: LIVE,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(board.waiting).toEqual([]);
    expect(board.columns).toEqual({ new: [], contacted: [], won: [], lost: [] });
    expect(board.booked).toEqual([]);
    expect(board.tiles).toEqual({
      waiting: 0,
      newThisWeek: 0,
      wonThisMonth: { count: 0, amount: 0 },
      chatsThisWeek: { total: 0, leftDetails: 0 },
    });
    expect(board.websiteSet).toBe(true);
  });

  it('keeps websiteSet off until a live profile has a website', () => {
    const bare = groupLeadsBoard({
      leads: [],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: { state: 'live', profileVersion: 1, website: null, redoInProgress: false },
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(bare.websiteSet).toBe(false);
    const settingUp = groupLeadsBoard({
      leads: [],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: { state: 'in_progress', interviewId: 'i', stage: 'areas' },
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(settingUp.websiteSet).toBe(false);
  });

  it('puts booking requests oldest first, and groups the columns', () => {
    const now = new Date('2026-10-05T09:00:00.000Z');
    const board = groupLeadsBoard({
      leads: [
        source({ id: 'newer', createdAt: '2026-10-04T23:30:00.000Z', bookingStatus: 'requested' }),
        source({ id: 'older', createdAt: '2026-10-03T10:00:00.000Z', bookingStatus: 'requested' }),
        source({ id: 'talked', status: 'contacted', createdAt: '2026-10-02T10:00:00.000Z' }),
        source({ id: 'plain', createdAt: '2026-10-04T12:00:00.000Z' }),
      ],
      repliedIds: new Set(['plain']),
      conversationIdsThisWeek: [],
      setup: LIVE,
      now,
    });
    expect(board.waiting.map((lead) => lead.id)).toEqual(['older', 'newer']);
    expect(board.columns.new.map((lead) => lead.id)).toEqual(['newer', 'plain', 'older']);
    expect(board.columns.contacted.map((lead) => lead.id)).toEqual(['talked']);
    expect(board.columns.new.find((lead) => lead.id === 'plain')?.flags.replied).toBe(true);
    expect(board.columns.new.find((lead) => lead.id === 'newer')?.flags.replied).toBe(false);
  });

  it('keeps won and lost for the last 60 London days only', () => {
    // Friday 2 Oct 2026 12:00 BST. The 60-day line is Monday 3 Aug 2026 00:00 BST = 2 Aug 23:00 UTC.
    const now = new Date('2026-10-02T11:00:00.000Z');
    const board = groupLeadsBoard({
      leads: [
        source({
          id: 'inside',
          status: 'won',
          bookingStatus: 'accepted',
          statusChangedAt: '2026-08-02T23:00:00.000Z',
          agreedAmount: 85,
        }),
        source({
          id: 'outside',
          status: 'lost',
          bookingStatus: 'declined',
          statusChangedAt: '2026-08-02T22:00:00.000Z',
        }),
        source({
          id: 'old-booked',
          status: 'won',
          bookingStatus: 'accepted',
          statusChangedAt: '2026-07-01T10:00:00.000Z',
          bookedForDate: '2026-10-09',
          bookedForTime: '09:00',
          agreedAmount: 40,
        }),
      ],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: LIVE,
      now,
    });
    expect(board.columns.won.map((lead) => lead.id)).toEqual(['inside']);
    expect(board.columns.lost).toEqual([]);
    expect(board.booked.map((lead) => lead.id)).toEqual(['old-booked', 'inside']);
  });

  it('lists booked jobs from today onwards by date and time, then undated', () => {
    const now = new Date('2026-10-05T09:00:00.000Z');
    const board = groupLeadsBoard({
      leads: [
        source({
          id: 'later',
          status: 'won',
          bookingStatus: 'accepted',
          bookedForDate: '2026-10-09',
          bookedForTime: '14:30',
          createdAt: '2026-10-01T10:00:00.000Z',
        }),
        source({
          id: 'morning',
          status: 'won',
          bookingStatus: 'accepted',
          bookedForDate: '2026-10-09',
          bookedForTime: '09:00',
          createdAt: '2026-10-01T09:00:00.000Z',
        }),
        source({
          id: 'no-time',
          status: 'won',
          bookingStatus: 'accepted',
          bookedForDate: '2026-10-09',
          bookedForTime: null,
          createdAt: '2026-10-01T08:00:00.000Z',
        }),
        source({
          id: 'yesterday',
          status: 'won',
          bookingStatus: 'accepted',
          bookedForDate: '2026-10-04',
          bookedForTime: '10:00',
        }),
        source({
          id: 'undated-new',
          status: 'won',
          bookingStatus: 'accepted',
          createdAt: '2026-10-04T12:00:00.000Z',
        }),
        source({
          id: 'undated-old',
          status: 'won',
          bookingStatus: 'accepted',
          createdAt: '2026-10-01T12:00:00.000Z',
        }),
        source({ id: 'not-accepted', status: 'won', bookingStatus: 'none' }),
      ],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: LIVE,
      now,
    });
    expect(board.booked.map((lead) => lead.id)).toEqual([
      'morning',
      'later',
      'no-time',
      'undated-new',
      'undated-old',
    ]);
  });

  it('counts this week and this month on the London boundary, and adds agreed amounts only', () => {
    // Monday 5 Oct 2026 10:00 BST. Week starts Sunday 4 Oct 23:00 UTC. Month starts 30 Sep 23:00 UTC.
    const now = new Date('2026-10-05T09:00:00.000Z');
    const board = groupLeadsBoard({
      leads: [
        source({ id: 'sunday', createdAt: '2026-10-04T22:30:00.000Z' }),
        source({ id: 'monday', createdAt: '2026-10-04T23:30:00.000Z' }),
        source({
          id: 'september',
          status: 'won',
          statusChangedAt: '2026-09-30T22:30:00.000Z',
          agreedAmount: 10,
          createdAt: '2026-09-01T10:00:00.000Z',
        }),
        source({
          id: 'october-firm',
          status: 'won',
          statusChangedAt: '2026-09-30T23:30:00.000Z',
          agreedAmount: 85.5,
          createdAt: '2026-09-01T10:00:00.000Z',
        }),
        source({
          id: 'october-visit',
          status: 'won',
          statusChangedAt: '2026-10-02T10:00:00.000Z',
          quote: { kind: 'visit' },
          agreedAmount: null,
          createdAt: '2026-09-01T10:00:00.000Z',
        }),
      ],
      repliedIds: new Set(),
      conversationIdsThisWeek: ['chat-1', 'chat-2', 'chat-3'],
      setup: LIVE,
      now,
    });
    const withChat = groupLeadsBoard({
      leads: [
        source({ id: 'monday', createdAt: '2026-10-04T23:30:00.000Z', conversationId: 'chat-1' }),
        source({ id: 'other', createdAt: '2026-10-04T23:40:00.000Z', conversationId: 'chat-2' }),
      ],
      repliedIds: new Set(),
      conversationIdsThisWeek: ['chat-1', 'chat-2', 'chat-3'],
      setup: LIVE,
      now,
    });
    expect(board.tiles.newThisWeek).toBe(1);
    expect(board.tiles.wonThisMonth).toEqual({ count: 2, amount: 85.5 });
    expect(withChat.tiles.chatsThisWeek).toEqual({ total: 3, leftDetails: 2 });
  });

  it('counts a January week in GMT, not BST', () => {
    const now = new Date('2026-01-05T10:00:00.000Z');
    const board = groupLeadsBoard({
      leads: [
        source({ id: 'sunday', createdAt: '2026-01-04T23:30:00.000Z' }),
        source({ id: 'monday', createdAt: '2026-01-05T00:30:00.000Z' }),
      ],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: LIVE,
      now,
    });
    expect(board.tiles.newThisWeek).toBe(1);
    expect(board.columns.new.map((lead) => lead.id)).toEqual(['monday', 'sunday']);
  });
});

describe('mapLeadRow', () => {
  it('reads the quote, the clock time, the first name and the days that suit', () => {
    const mapped = mapLeadRow({
      id: 'lead-1',
      name: 'Sarah Jones',
      job_summary: 'Ceiling skim',
      quote_kind: 'guide',
      quote_min: '80.00',
      quote_max: '120.50',
      agreed_amount: null,
      status: 'new',
      booking_status: 'requested',
      decided_by: 'auto',
      created_at: '2026-10-01T10:00:00.000Z',
      status_changed_at: null,
      booked_for_date: '2026-10-09',
      booked_for_time: '14:30:00',
      postcode: 'SW1A 1AA',
      phone: '07123 456789',
      preferred_days: ['mon', 'thu'],
      follow_up_problem: 'opted_out',
      converted_customer_id: 'cust-1',
      converted_job_id: null,
      widget_conversation_id: 'chat-1',
    });
    expect(mapped).toMatchObject({
      name: 'Sarah Jones',
      quote: { kind: 'guide', min: 80, max: 120.5 },
      bookedForTime: '14:30',
      bookedForDate: '2026-10-09',
      preferredDays: ['mon', 'thu'],
      followUpProblem: 'opted_out',
      converted: true,
      decidedBy: 'auto',
      conversationId: 'chat-1',
    });
    const board = groupLeadsBoard({
      leads: mapped ? [mapped] : [],
      repliedIds: new Set(),
      conversationIdsThisWeek: [],
      setup: LIVE,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(board.waiting[0]?.firstName).toBe('Sarah');
  });
});
