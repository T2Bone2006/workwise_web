import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model';
import { addDays } from '@/lib/rounds/dates';

const parse = vi.fn();
const logStructuredAiInteraction = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { parse };
  },
}));

vi.mock('@/lib/services/ai-interaction-log', () => ({
  logStructuredAiInteraction: (...args: unknown[]) => logStructuredAiInteraction(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => fakeAdmin,
}));

import { classifyAndAct } from '@/lib/messaging/inbound';
import {
  buildClassifyPrompt,
  classifyReply,
  normaliseClassification,
} from '@/lib/messaging/classify';

type Row = Record<string, unknown>;

type Note = {
  threadId: unknown;
  needsAttention: unknown;
  reason: unknown;
};

type FakeDb = {
  messages: Row[];
  jobs: Row[];
  tenants: Row[];
  notes: Note[];
};

const TODAY = '2026-09-28';
const NOW = new Date('2026-09-28T12:00:00.000Z');

let db: FakeDb;
let fakeAdmin: SupabaseClient;

function buildAdmin(): SupabaseClient {
  return {
    from(table: string) {
      const filters: { col: string; val: unknown }[] = [];
      let payload: Row | null = null;
      let op: 'select' | 'update' = 'select';

      const rows = () => {
        if (table === 'jobs') return db.jobs;
        if (table === 'tenants') return db.tenants;
        return db.messages;
      };

      const run = () => {
        const matched = rows().filter((row) =>
          filters.every((filter) => row[filter.col] === filter.val),
        );
        if (op === 'update' && payload) {
          for (const row of matched) Object.assign(row, payload);
          return { data: null, error: null };
        }
        return { data: matched[0] ?? null, error: null };
      };

      const builder = {
        select() {
          return builder;
        },
        update(row: Row) {
          op = 'update';
          payload = row;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(run());
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'messaging_note_inbound') {
        return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
      }
      db.notes.push({
        threadId: args.p_thread_id,
        needsAttention: args.p_needs_attention,
        reason: args.p_reason,
      });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

function actInput(overrides: Partial<Parameters<typeof classifyAndAct>[0]> = {}) {
  return {
    tenantId: 'tenant-a',
    threadId: 'thread-a',
    customerId: 'cust-a',
    messageId: 'msg-1',
    body: 'ok thanks',
    boundJobIds: [] as string[],
    keyword: null,
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  db = {
    messages: [{ id: 'msg-1', tenant_id: 'tenant-a' }],
    jobs: [{ id: 'job-1', tenant_id: 'tenant-a', scheduled_date: '2026-10-01' }],
    tenants: [{ id: 'tenant-a', name: 'Acme Windows' }],
    notes: [],
  };
  fakeAdmin = buildAdmin();
  parse.mockReset();
  logStructuredAiInteraction.mockReset();
  logStructuredAiInteraction.mockResolvedValue(undefined);
});

describe('buildClassifyPrompt', () => {
  it('contains today and the visit date, and truncates a 900-character body to 500', () => {
    const prompt = buildClassifyPrompt({
      body: 'x'.repeat(900),
      today: TODAY,
      todayLabel: 'Mon 28 Sep 2026',
      visitDate: '2026-10-01',
      visitLabel: 'Thu 1 Oct 2026',
      businessName: 'Acme Windows',
    });

    expect(prompt).toBe(`You sort text-message replies sent to Acme Windows, a local tradesperson, about a planned visit.
Today is Mon 28 Sep 2026 (${TODAY}). The visit this reply is probably about is on Thu 1 Oct 2026 (2026-10-01).

Reply: """${'x'.repeat(500)}"""

Choose one intent:
- said_no: they do not want this visit (e.g. "no", "not this time", "we're away", "cancel", "skip us").
- asked_move: they want the visit on a different day or time.
- question: anything that needs the tradesperson to answer or do something (a question, a request, a complaint, extra work).
- other: needs nothing (e.g. "ok", "thanks", "see you then", an emoji).

proposed_date: only if they clearly name a day for asked_move. Resolve words like "Friday" or "next Tuesday" to the next such date after today, as YYYY-MM-DD. Never guess. Otherwise null.
confidence: 0 to 1, how sure you are of the intent.`);
  });
});

describe('normaliseClassification', () => {
  it('keeps a confident said_no and turns a weak one into a question', () => {
    expect(
      normaliseClassification(
        { intent: 'said_no', proposed_date: null, confidence: 0.9 },
        { today: TODAY },
      ),
    ).toEqual({ intent: 'said_no', proposedDate: null, confidence: 0.9, source: 'ai' });

    expect(
      normaliseClassification(
        { intent: 'said_no', proposed_date: null, confidence: 0.4 },
        { today: TODAY },
      ),
    ).toEqual({ intent: 'question', proposedDate: null, confidence: 0.4, source: 'ai' });
  });

  it('drops a date that is yesterday or too far ahead, and keeps next Friday', () => {
    const yesterday = normaliseClassification(
      { intent: 'asked_move', proposed_date: '2026-09-27', confidence: 0.9 },
      { today: TODAY },
    );
    expect(yesterday.intent).toBe('asked_move');
    expect(yesterday.proposedDate).toBeNull();

    const far = normaliseClassification(
      { intent: 'asked_move', proposed_date: addDays(TODAY, 200), confidence: 0.9 },
      { today: TODAY },
    );
    expect(far.intent).toBe('asked_move');
    expect(far.proposedDate).toBeNull();

    const friday = normaliseClassification(
      { intent: 'asked_move', proposed_date: '2026-10-02', confidence: 0.9 },
      { today: TODAY },
    );
    expect(friday).toEqual({
      intent: 'asked_move',
      proposedDate: '2026-10-02',
      confidence: 0.9,
      source: 'ai',
    });
  });
});

describe('classifyReply', () => {
  it('returns a fallback question when the API throws', async () => {
    const throwing = {
      messages: { parse: vi.fn().mockRejectedValue(new Error('down')) },
    } as unknown as Pick<Anthropic, 'messages'>;

    const result = await classifyReply(
      fakeAdmin,
      {
        tenantId: 'tenant-a',
        messageId: 'msg-9',
        body: 'can you come friday?',
        today: TODAY,
        visitDate: null,
        businessName: 'Acme Windows',
      },
      { anthropic: throwing },
    );

    expect(result).toEqual({
      intent: 'question',
      proposedDate: null,
      confidence: 0,
      source: 'fallback',
    });
  });

  it('logs the call as message_classification', async () => {
    parse.mockResolvedValue({
      parsed_output: { intent: 'question', proposed_date: null, confidence: 0.8 },
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    await classifyReply(fakeAdmin, {
      tenantId: 'tenant-a',
      messageId: 'msg-9',
      body: 'what time will you arrive?',
      today: TODAY,
      visitDate: '2026-10-01',
      businessName: 'Acme Windows',
    });

    expect(logStructuredAiInteraction).toHaveBeenCalledWith(
      fakeAdmin,
      expect.objectContaining({
        tenantId: 'tenant-a',
        interactionType: 'message_classification',
        inputData: { message_id: 'msg-9', has_visit: true },
        model: DEFAULT_AI_MODEL,
        tokensInput: 20,
        tokensOutput: 10,
      }),
    );
  });
});

describe('classifyAndAct', () => {
  it('does not call Anthropic for a keyword said_no', async () => {
    await classifyAndAct(actInput({ body: 'Cancel', keyword: 'said_no' }));

    expect(parse).not.toHaveBeenCalled();
    expect(db.messages[0]).toMatchObject({
      classification: 'said_no',
      classification_confidence: 1,
      requested_date: null,
    });
    expect(db.notes[0]).toEqual({
      threadId: 'thread-a',
      needsAttention: true,
      reason: 'Said no',
    });
  });

  it('does not flag the thread for other', async () => {
    parse.mockResolvedValue({
      parsed_output: { intent: 'other', proposed_date: null, confidence: 0.88 },
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    await classifyAndAct(actInput({ body: 'ok thanks' }));

    expect(db.messages[0]).toMatchObject({
      classification: 'other',
      requested_date: null,
    });
    expect(db.notes[0]).toEqual({
      threadId: 'thread-a',
      needsAttention: false,
      reason: null,
    });
  });
});

describe('normalisePaymentReply', () => {
  it('keeps a confident "says paid"', async () => {
    const { normalisePaymentReply } = await import('@/lib/messaging/classify');
    expect(normalisePaymentReply({ intent: 'says_paid', confidence: 0.9 }).intent).toBe('says_paid');
  });

  it('turns an unsure "says paid" into a payment question, so the trader still sees it', async () => {
    const { normalisePaymentReply } = await import('@/lib/messaging/classify');
    expect(normalisePaymentReply({ intent: 'says_paid', confidence: 0.4 }).intent).toBe(
      'payment_question',
    );
  });
});
