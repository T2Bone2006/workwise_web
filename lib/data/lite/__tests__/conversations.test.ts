import { describe, expect, it } from 'vitest';
import {
  buildConversationList,
  normaliseConversationQuery,
  type ConversationLeadSource,
  type ConversationSource,
} from '@/lib/data/lite/conversations';

function chat(id: string, startedAt: string, extras: Partial<ConversationSource> = {}): ConversationSource {
  return {
    id,
    startedAt,
    lastMessageAt: startedAt,
    status: 'ended',
    visitorMessages: 2,
    summary: `Summary ${id}`,
    tags: [],
    quote: null,
    ...extras,
  };
}

function lead(id: string, conversationId: string, status = 'won'): ConversationLeadSource {
  return { id, name: 'Sarah Jones', status, conversationId };
}

describe('normaliseConversationQuery', () => {
  it('sends junk filters and pages back to All, page 1', () => {
    expect(normaliseConversationQuery({ filter: 'nope', page: 0 })).toEqual({ filter: 'all', page: 1 });
    expect(normaliseConversationQuery({ filter: '', page: 'foo' })).toEqual({ filter: 'all', page: 1 });
    expect(normaliseConversationQuery({ filter: 'out_of_area', page: '3' })).toEqual({
      filter: 'out_of_area',
      page: 3,
    });
  });
});

describe('buildConversationList', () => {
  it('filters details, no details and out of area, newest first', () => {
    const list = buildConversationList({
      conversations: [
        chat('old', '2026-10-01T10:00:00.000Z', { tags: ['out_of_area'] }),
        chat('with-lead', '2026-10-03T10:00:00.000Z', { tags: ['lead'] }),
        chat('bare', '2026-10-02T10:00:00.000Z'),
        chat('area-lead', '2026-10-04T10:00:00.000Z', { tags: ['lead', 'out_of_area'] }),
      ],
      leads: [lead('lead-1', 'with-lead', 'new'), lead('lead-2', 'area-lead', 'won')],
      filter: 'all',
      page: 1,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(list.items.map((item) => item.id)).toEqual(['area-lead', 'with-lead', 'bare', 'old']);
    expect(list.items[0]?.lead).toEqual({ id: 'lead-2', firstName: 'Sarah', status: 'won' });
    expect(list.items[2]?.lead).toBeNull();

    const details = buildConversationList({
      conversations: list.items.map((item) => chat(item.id, item.startedAt, { tags: item.tags, quote: item.quote, summary: item.summary })),
      leads: [lead('lead-1', 'with-lead', 'new'), lead('lead-2', 'area-lead', 'won')],
      filter: 'details',
      page: 1,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(details.items.map((item) => item.id)).toEqual(['area-lead', 'with-lead']);

    const none = buildConversationList({
      conversations: [
        chat('old', '2026-10-01T10:00:00.000Z'),
        chat('with-lead', '2026-10-03T10:00:00.000Z'),
        chat('bare', '2026-10-02T10:00:00.000Z'),
      ],
      leads: [lead('lead-1', 'with-lead')],
      filter: 'no_details',
      page: 1,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(none.items.map((item) => item.id)).toEqual(['bare', 'old']);

    const area = buildConversationList({
      conversations: [
        chat('old', '2026-10-01T10:00:00.000Z', { tags: ['out_of_area'] }),
        chat('with-lead', '2026-10-03T10:00:00.000Z'),
        chat('area-lead', '2026-10-04T10:00:00.000Z', { tags: ['out_of_area'] }),
      ],
      leads: [lead('lead-2', 'area-lead')],
      filter: 'out_of_area',
      page: 1,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(area.items.map((item) => item.id)).toEqual(['area-lead', 'old']);
  });

  it('keeps an active chat summary so a reopened chat can still show it', () => {
    const list = buildConversationList({
      conversations: [chat('open', '2026-10-05T08:00:00.000Z', { status: 'active', summary: 'Asked about a skim.' })],
      leads: [],
      filter: 'all',
      page: 1,
      now: new Date('2026-10-05T09:00:00.000Z'),
    });
    expect(list.items[0]).toMatchObject({ status: 'active', summary: 'Asked about a skim.' });
  });

  it('serves 30 per page and clamps a page past the end, or a zero page, back into range', () => {
    const conversations = Array.from({ length: 31 }, (_, index) =>
      chat(`c${String(index).padStart(2, '0')}`, `2026-10-01T00:00:${String(index).padStart(2, '0')}.000Z`),
    );
    const now = new Date('2026-10-05T09:00:00.000Z');
    const first = buildConversationList({ conversations, leads: [], filter: 'all', page: 1, now });
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(2);
    expect(first.items).toHaveLength(30);
    expect(first.items[0]?.id).toBe('c30');

    const last = buildConversationList({ conversations, leads: [], filter: 'all', page: 9, now });
    expect(last.page).toBe(2);
    expect(last.items.map((item) => item.id)).toEqual(['c00']);

    const zero = buildConversationList({ conversations, leads: [], filter: 'all', page: 0, now });
    expect(zero.page).toBe(1);
    expect(zero.items[0]?.id).toBe('c30');

    const empty = buildConversationList({ conversations: [], leads: [], filter: 'all', page: 4, now });
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
    expect(empty.items).toEqual([]);
  });

  it('counts the London week and month at a BST boundary and a GMT boundary', () => {
    // Thursday 1 Oct 2026 12:00 BST. Month starts 1 Oct 00:00 BST = 30 Sep 23:00 UTC.
    // That Thursday's week starts Monday 28 Sep 2026 00:00 BST = 27 Sep 23:00 UTC.
    const bst = buildConversationList({
      now: new Date('2026-10-01T11:00:00.000Z'),
      filter: 'all',
      page: 1,
      leads: [lead('lead-1', 'week-lead')],
      conversations: [
        chat('before-month', '2026-09-30T22:59:59.000Z', { tags: ['out_of_area'] }),
        chat('month-start', '2026-09-30T23:00:00.000Z', { tags: ['out_of_area'] }),
        chat('week-lead', '2026-09-27T23:00:00.000Z'),
        chat('before-week', '2026-09-27T22:59:59.000Z'),
      ],
    });
    expect(bst.counts).toEqual({
      thisWeek: 3,
      leftDetailsThisWeek: 1,
      thisMonth: 1,
      outOfAreaThisMonth: 1,
    });

    // Monday 5 Jan 2026 10:00 GMT. Week starts that Monday 00:00 GMT. Month starts 1 Jan 00:00 GMT.
    const gmt = buildConversationList({
      now: new Date('2026-01-05T10:00:00.000Z'),
      filter: 'all',
      page: 1,
      leads: [lead('lead-1', 'week-lead')],
      conversations: [
        chat('before-month', '2025-12-31T23:59:59.000Z', { tags: ['out_of_area'] }),
        chat('month-start', '2026-01-01T00:00:00.000Z'),
        chat('week-lead', '2026-01-05T00:00:00.000Z', { tags: ['out_of_area'] }),
        chat('before-week', '2026-01-04T23:59:59.000Z', { tags: ['out_of_area'] }),
      ],
    });
    expect(gmt.counts).toEqual({
      thisWeek: 1,
      leftDetailsThisWeek: 1,
      thisMonth: 3,
      outOfAreaThisMonth: 2,
    });
  });
});
