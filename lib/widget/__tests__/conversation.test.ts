import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  appendAssistantMessage,
  appendVisitorMessage,
  loadConversation,
  loadWidgetProfile,
  startConversation,
  toPublicQuote,
  type StoredMessage,
} from '@/lib/widget/conversation';

type Row = Record<string, unknown>;

function memory(flags: { failInsert?: boolean; failUpdate?: boolean; failRead?: boolean } = {}) {
  const conversations: Row[] = [];
  const profiles: Row[] = [];
  const admin = {
    from(table: string) {
      const rows = table === 'lite_price_profiles' ? profiles : conversations;
      const preds: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      const matched = () => rows.filter((row) => preds.every((pred) => pred(row)));
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (key: string, value: unknown) => {
          preds.push((row) => row[key] === value);
          return b;
        },
        insert: (row: Row) => {
          if (flags.failInsert) return Promise.resolve({ error: { message: 'boom' } });
          if (conversations.some((existing) => existing.id === row.id)) {
            return Promise.resolve({ error: { code: '23505', message: 'duplicate' } });
          }
          conversations.push({ ...row });
          return Promise.resolve({ error: null });
        },
        update: (next: Row) => {
          patch = next;
          return b;
        },
        maybeSingle: async () => {
          if (flags.failRead) return { data: null, error: { message: 'boom' } };
          return { data: matched()[0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          if (patch) {
            if (flags.failUpdate) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
            const hit = matched();
            for (const row of hit) Object.assign(row, patch);
            return Promise.resolve({ data: hit.map((row) => ({ id: row.id })), error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: matched(), error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  };
  return { admin: admin as unknown as SupabaseClient, conversations, profiles };
}

function message(content: string): StoredMessage {
  return { role: 'user', content, at: '2026-10-02T12:00:00.000Z' };
}

describe('toPublicQuote', () => {
  it('drops the job type key and anything that is not a price', () => {
    expect(toPublicQuote(null)).toBeNull();
    expect(
      toPublicQuote({ kind: 'firm', jobTypeKey: 'lock-change', amount: 85, summary: 'Lock' }),
    ).toEqual({ kind: 'firm', amount: 85, summary: 'Lock' });
    expect(
      toPublicQuote({ kind: 'guide', jobTypeKey: 'skim', min: 200, max: 450, summary: 'Ceiling' }),
    ).toEqual({ kind: 'guide', min: 200, max: 450, summary: 'Ceiling' });
    expect(toPublicQuote({ kind: 'visit', jobTypeKey: 'skim', summary: 'Come and look' })).toEqual({
      kind: 'visit',
      summary: 'Come and look',
    });
  });
});

describe('conversations', () => {
  it('starts a chat once, and reports a race as exists', async () => {
    const { admin, conversations } = memory();
    expect(
      await startConversation(admin, {
        id: 'c1',
        clientId: 'w1',
        tenantId: 't1',
        visitorHash: 'hash',
        originHost: 'dave.co.uk',
      }),
    ).toBe('ok');
    expect(conversations).toHaveLength(1);
    expect(
      await startConversation(admin, {
        id: 'c1',
        clientId: 'w1',
        tenantId: 't1',
        visitorHash: 'hash',
        originHost: 'dave.co.uk',
      }),
    ).toBe('exists');
    expect(conversations).toHaveLength(1);

    const broken = memory({ failInsert: true });
    expect(
      await startConversation(broken.admin, {
        id: 'c1',
        clientId: 'w1',
        tenantId: 't1',
        visitorHash: 'hash',
        originHost: 'dave.co.uk',
      }),
    ).toBe('error');
  });

  it('loads a row, including one that belongs to another widget, and fails closed', async () => {
    const { admin, conversations } = memory();
    conversations.push({
      id: 'c1',
      client_id: 'other',
      tenant_id: 't1',
      messages: [{ role: 'user', content: 'Hi', at: '2026-10-02T12:00:00.000Z' }],
      visitor_message_count: 1,
      status: 'ended',
    });
    const row = await loadConversation(admin, 'w1', 'c1');
    expect(row).toMatchObject({ client_id: 'other', visitor_message_count: 1 });
    expect(await loadConversation(admin, 'w1', 'missing')).toBeNull();
    expect(await loadConversation(memory({ failRead: true }).admin, 'w1', 'c1')).toBe('error');
  });

  it('answers one of two messages sent together, and never skips or doubles the count', async () => {
    const { admin, conversations } = memory();
    conversations.push({
      id: 'c1',
      client_id: 'w1',
      messages: [],
      visitor_message_count: 0,
      status: 'active',
      ended_at: null,
    });
    const [a, b] = await Promise.all([
      appendVisitorMessage(admin, { id: 'c1', expectedCount: 0, message: message('one') }),
      appendVisitorMessage(admin, { id: 'c1', expectedCount: 0, message: message('two') }),
    ]);
    expect([a, b].sort()).toEqual(['busy', 'ok']);
    expect(conversations[0].visitor_message_count).toBe(1);
    expect(conversations[0].messages).toHaveLength(1);
  });

  it('reopens a chat the tick had ended', async () => {
    const { admin, conversations } = memory();
    conversations.push({
      id: 'c1',
      client_id: 'w1',
      messages: [],
      visitor_message_count: 2,
      status: 'ended',
      ended_at: '2026-10-02T11:00:00.000Z',
    });
    expect(await appendVisitorMessage(admin, { id: 'c1', expectedCount: 2, message: message('again') })).toBe('ok');
    expect(conversations[0]).toMatchObject({ status: 'active', ended_at: null, visitor_message_count: 3 });
  });

  it('stores the assistant reply and the quote, and logs only the id when that fails', async () => {
    const { admin, conversations } = memory();
    conversations.push({ id: 'c1', messages: [message('Hi')], visitor_message_count: 1 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await appendAssistantMessage(admin, {
      id: 'c1',
      message: { role: 'assistant', content: 'SECRET-REPLY', at: '2026-10-02T12:00:01.000Z' },
      quote: { kind: 'firm', jobTypeKey: 'lock-change', amount: 85, summary: 'Lock' },
    });
    expect(conversations[0].messages).toHaveLength(2);
    expect(conversations[0].last_quote).toMatchObject({ kind: 'firm', amount: 85 });
    expect(error).not.toHaveBeenCalled();

    const broken = memory({ failRead: true });
    await appendAssistantMessage(broken.admin, {
      id: 'c1',
      message: { role: 'assistant', content: 'SECRET-REPLY', at: '2026-10-02T12:00:01.000Z' },
      quote: null,
    });
    expect(error).toHaveBeenCalledWith('[widget] assistant message not stored', 'c1');
    expect(error.mock.calls.flat().join(' ')).not.toContain('SECRET-REPLY');
    error.mockRestore();
  });
});

describe('loadWidgetProfile', () => {
  it('returns null when the profile is missing or the read fails', async () => {
    const { admin, profiles } = memory();
    expect(await loadWidgetProfile(admin, 't1')).toBeNull();
    profiles.push({ tenant_id: 't1', profile: { nope: true } });
    expect(await loadWidgetProfile(admin, 't1')).toBeNull();
    expect(await loadWidgetProfile(memory({ failRead: true }).admin, 't1')).toBeNull();
  });
});
