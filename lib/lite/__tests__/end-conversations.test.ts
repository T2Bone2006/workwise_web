import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuardedQuote } from '@/lib/widget/turn-schema';

const harness = vi.hoisted(() => {
  const summarise = vi.fn(async (): Promise<{ summary: string | null; aiTags: string[] }> => ({
    summary: 'Back door lock in Bolton; quoted £85.',
    aiTags: ['question_only'],
  }));
  return { summarise };
});

vi.mock('@/lib/lite/summarise', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lite/summarise')>();
  return {
    ...actual,
    summariseConversation: () => harness.summarise(),
  };
});

import { endIdleConversations } from '@/lib/lite/end-conversations';

type Rec = Record<string, unknown>;

const state = {
  conversations: [] as Rec[],
  leads: [] as Rec[],
  widgets: [] as Rec[],
  bumpAfterSelect: false,
  leadError: false,
  summaryWriteError: false,
};

function rowsFor(table: string): Rec[] {
  if (table === 'widget_conversations') return state.conversations;
  if (table === 'leads') return state.leads;
  if (table === 'widget_clients') return state.widgets;
  return [];
}

function builder(table: string) {
  const filters: Array<(row: Rec) => boolean> = [];
  let mode: 'select' | 'update' = 'select';
  let patch: Rec | null = null;
  let orderKey: string | null = null;
  let limitN: number | null = null;

  function execute(single: boolean) {
    if (mode === 'select' && table === 'leads' && state.leadError) {
      return { data: null, error: { message: 'down' } };
    }
    const hit = rowsFor(table).filter((row) => filters.every((pred) => pred(row)));
    if (mode === 'update' && state.summaryWriteError && patch && 'summary' in patch) {
      return { data: null, error: { message: 'down' } };
    }
    if (mode === 'update') {
      for (const row of hit) Object.assign(row, patch);
      const copies = hit.map((row) => ({ ...row }));
      return { data: single ? (copies[0] ?? null) : copies, error: null };
    }
    const copies = hit.map((row) => ({ ...row }));
    if (state.bumpAfterSelect && table === 'widget_conversations') {
      for (const row of rowsFor(table)) {
        if (row.status === 'active') row.last_message_at = '2099-01-01T00:00:00.000Z';
      }
    }
    let list = copies;
    if (orderKey) {
      const key = orderKey;
      list = [...list].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')));
    }
    if (limitN != null) list = list.slice(0, limitN);
    return { data: single ? (list[0] ?? null) : list, error: null };
  }

  const api = {
    select: () => api,
    eq: (key: string, value: unknown) => {
      filters.push((row) => row[key] === value);
      return api;
    },
    lt: (key: string, value: unknown) => {
      filters.push((row) => String(row[key] ?? '') < String(value));
      return api;
    },
    order: (key: string) => {
      orderKey = key;
      return api;
    },
    limit: (n: number) => {
      limitN = n;
      return api;
    },
    update: (next: Rec) => {
      mode = 'update';
      patch = next;
      return api;
    },
    maybeSingle: async () => execute(true),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute(false)).then(resolve, reject),
  };
  return api;
}

const admin = { from: (table: string) => builder(table) } as unknown as SupabaseClient;

const now = new Date('2026-06-15T14:00:00.000Z');

function chat(id: string, minutesAgo: number, extra: Rec = {}): Rec {
  return {
    id,
    tenant_id: 'tenant-1',
    client_id: 'widget-1',
    status: 'active',
    last_message_at: new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString(),
    messages: [{ role: 'user', content: 'The back door lock is stuck', at: '2026-06-15T12:00:00.000Z' }],
    last_quote: { kind: 'firm', jobTypeKey: 'lock', amount: 85, summary: 'Back door lock' } satisfies GuardedQuote,
    summary: null,
    tags: [],
    ...extra,
  };
}

describe('endIdleConversations', () => {
  beforeEach(() => {
    state.conversations.length = 0;
    state.leads.length = 0;
    state.widgets.length = 0;
    state.bumpAfterSelect = false;
    state.leadError = false;
    state.summaryWriteError = false;
    state.widgets.push({ id: 'widget-1', tenant_id: 'tenant-1', business_name: "Dave's Plastering" });
    state.leads.push({ tenant_id: 'tenant-1', widget_conversation_id: 'old', booking_status: 'requested' });
    harness.summarise.mockClear();
    harness.summarise.mockResolvedValue({ summary: 'Back door lock in Bolton; quoted £85.', aiTags: ['question_only'] });
  });

  it('ends a chat idle 21 minutes and leaves a 19-minute chat open', async () => {
    state.conversations.push(chat('old', 21), chat('fresh', 19, { id: 'fresh' }));
    const result = await endIdleConversations(admin, now);
    expect(result).toEqual({ ended: 1, summarised: 1 });
    expect(state.conversations.find((row) => row.id === 'old')).toMatchObject({
      status: 'ended',
      summary: 'Back door lock in Bolton; quoted £85.',
      tags: ['lead', 'booking', 'firm_price', 'question_only'],
    });
    expect(state.conversations.find((row) => row.id === 'fresh')?.status).toBe('active');
    expect(harness.summarise).toHaveBeenCalledTimes(1);
  });

  it('skips a chat whose visitor wrote again between the read and the update', async () => {
    state.conversations.push(chat('old', 21));
    state.bumpAfterSelect = true;
    const result = await endIdleConversations(admin, now);
    expect(result).toEqual({ ended: 0, summarised: 0 });
    expect(state.conversations[0]?.status).toBe('active');
    expect(harness.summarise).not.toHaveBeenCalled();
  });

  it('ends at most the limit, oldest first', async () => {
    state.conversations.push(chat('a', 40), chat('b', 30), chat('c', 25));
    const result = await endIdleConversations(admin, now, 2);
    expect(result.ended).toBe(2);
    expect(state.conversations.find((row) => row.id === 'c')?.status).toBe('active');
    expect(state.conversations.find((row) => row.id === 'a')?.status).toBe('ended');
    expect(state.conversations.find((row) => row.id === 'b')?.status).toBe('ended');
  });

  it('keeps the rule tags and a null summary when the model fails, and replaces them when the chat is idle again', async () => {
    state.conversations.push(chat('old', 21, { summary: 'Old summary', tags: ['off_topic'] }));
    harness.summarise.mockResolvedValueOnce({ summary: null, aiTags: [] });
    const first = await endIdleConversations(admin, now);
    expect(first).toEqual({ ended: 1, summarised: 0 });
    expect(state.conversations[0]).toMatchObject({ summary: null, tags: ['lead', 'booking', 'firm_price'] });

    state.conversations[0]!.status = 'active';
    state.conversations[0]!.last_message_at = new Date(now.getTime() - 21 * 60 * 1000).toISOString();
    harness.summarise.mockResolvedValueOnce({ summary: 'Lock change in Bolton; £85.', aiTags: [] });
    const second = await endIdleConversations(admin, now);
    expect(second.summarised).toBe(1);
    expect(state.conversations[0]?.summary).toBe('Lock change in Bolton; £85.');
  });

  it('puts the chat back when the lead cannot be read', async () => {
    state.conversations.push(chat('old', 21));
    state.leadError = true;
    const result = await endIdleConversations(admin, now);
    expect(result).toEqual({ ended: 0, summarised: 0 });
    expect(state.conversations[0]).toMatchObject({ status: 'active', ended_at: null });
    expect(harness.summarise).not.toHaveBeenCalled();
  });

  it('puts the chat back when the summary cannot be saved', async () => {
    state.conversations.push(chat('old', 21));
    state.summaryWriteError = true;
    const result = await endIdleConversations(admin, now);
    expect(result).toEqual({ ended: 0, summarised: 0 });
    expect(state.conversations[0]).toMatchObject({ status: 'active', ended_at: null, summary: null });
    expect(harness.summarise).toHaveBeenCalledTimes(1);
  });
});
