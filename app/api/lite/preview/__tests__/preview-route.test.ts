import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceProfile } from '@/lib/lite/profile-schema';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';

const { requireLite, answerVisitor } = vi.hoisted(() => ({
  requireLite: vi.fn(),
  answerVisitor: vi.fn(),
}));

vi.mock('@/lib/lite/require-lite', () => ({
  requireLite: () => requireLite(),
}));

vi.mock('@/lib/widget/brain', () => ({
  answerVisitor: (...args: unknown[]) => answerVisitor(...args),
}));

vi.mock('@/lib/widget/guard', () => ({
  guardWidgetRequest: () => {
    throw new Error('public widget guard must not run for preview');
  },
}));

type TableResult = { data: unknown; error: { message: string } | null; count: number | null };

const seen: string[] = [];
const writes: string[] = [];
const rpcCalls: string[] = [];
const filters: Array<{ table: string; method: string; args: unknown[] }> = [];
const tables = new Map<string, TableResult>();
let countThrows = false;

function builder(table: string, result: TableResult) {
  const b: Record<string, unknown> = {
    select: (...args: unknown[]) => {
      filters.push({ table, method: 'select', args });
      return b;
    },
    eq: (...args: unknown[]) => {
      filters.push({ table, method: 'eq', args });
      return b;
    },
    gte: (...args: unknown[]) => {
      filters.push({ table, method: 'gte', args });
      return b;
    },
    insert: () => {
      writes.push(table);
      return Promise.resolve({ data: null, error: null });
    },
    update: () => {
      writes.push(table);
      return b;
    },
    upsert: () => {
      writes.push(table);
      return Promise.resolve({ data: null, error: null });
    },
    delete: () => {
      writes.push(table);
      return b;
    },
    maybeSingle: async () => ({ data: result.data, error: result.error }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: result.data, error: result.error, count: result.count }).then(resolve, reject),
  };
  return b;
}

const admin = {
  from(table: string) {
    seen.push(table);
    if (table === 'ai_interactions' && countThrows) throw new Error('db down');
    const result = tables.get(table) ?? { data: null, error: null, count: null };
    return builder(table, result);
  },
  rpc(fn: string) {
    rpcCalls.push(fn);
    return Promise.resolve({ data: null, error: null });
  },
} as unknown as SupabaseClient;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin,
}));

import { POST } from '@/app/api/lite/preview/chat/route';

const profile: PriceProfile = {
  areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: 12 },
  callout_fee: null,
  hourly_rate: null,
  day_rate: null,
  minimum_charge: null,
  materials: '',
  job_types: [
    {
      key: 'skim',
      name: 'Skim',
      how_priced: 'from_description',
      guide_min: 80,
      guide_max: 150,
      what_changes_price: 'Room size',
      auto_accept: false,
    },
  ],
  rules: [],
  example_jobs: [],
  tone: 'Warm',
};

const ctx = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  widget: {
    id: 'widget-1',
    business_name: "Dave's Plastering",
    sign_off_name: 'Dave',
    trade: 'plastering',
    service_area: 'South Manchester',
    business_context: 'Family firm',
  },
};

function reset() {
  seen.length = 0;
  writes.length = 0;
  rpcCalls.length = 0;
  filters.length = 0;
  tables.clear();
  countThrows = false;
  tables.set('ai_interactions', { data: null, error: null, count: 0 });
  tables.set('lite_price_profiles', { data: null, error: null, count: null });
  tables.set('lite_interviews', { data: null, error: null, count: null });
  requireLite.mockReset();
  requireLite.mockResolvedValue({ ok: true, ctx });
  answerVisitor.mockReset();
  answerVisitor.mockResolvedValue({
    reply: 'Tell me a bit about the job.',
    quote: null,
    askForDetails: false,
    outOfArea: false,
    usedFallback: false,
  });
}

function post(body: unknown, raw = false): Promise<Response> {
  return POST(
    new Request('http://localhost/api/lite/preview/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

function userMessages(count: number) {
  return Array.from({ length: count }, () => ({ role: 'user' as const, content: 'A ceiling skim' }));
}

describe('POST /api/lite/preview/chat', () => {
  beforeEach(reset);

  it('lets a Lite tradie practise with no website check and saves nothing', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'I need a skim' }], source: 'live' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reply: 'Tell me a bit about the job.',
      quote: null,
      askForDetails: false,
      outOfArea: false,
      mode: 'enquiry',
    });
    expect(answerVisitor).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'preview',
        preview: true,
        profile: null,
        history: [{ role: 'user', content: 'I need a skim' }],
        business: expect.objectContaining({ businessName: "Dave's Plastering", signOff: 'Dave' }),
      }),
    );
    expect(seen).toEqual(['ai_interactions', 'lite_price_profiles']);
    expect(seen).not.toContain('leads');
    expect(seen).not.toContain('lite_texts');
    expect(seen).not.toContain('widget_conversations');
    expect(writes).toEqual([]);
    expect(rpcCalls).not.toContain('claim_widget_usage');
    expect(filters).toContainEqual({
      table: 'ai_interactions',
      method: 'gte',
      args: ['created_at', londonDayBoundsUtc(todayInLondon()).startIso],
    });
    expect(filters).toContainEqual({
      table: 'ai_interactions',
      method: 'eq',
      args: ['input_data->>preview', 'true'],
    });
  });

  it('uses the interview draft, and enquiry mode when that draft does not parse yet', async () => {
    tables.set('lite_interviews', { data: { draft_profile: profile }, error: null, count: null });
    answerVisitor.mockResolvedValue({
      reply: 'About £90.',
      quote: { kind: 'firm', jobTypeKey: 'skim', amount: 90, summary: 'Ceiling' },
      askForDetails: false,
      outOfArea: false,
      usedFallback: false,
    });
    const priced = await post({ messages: [{ role: 'user', content: 'Small ceiling' }], source: 'interview' });
    expect(priced.status).toBe(200);
    expect(await priced.json()).toMatchObject({
      quote: { kind: 'firm', amount: 90, summary: 'Ceiling' },
      mode: 'quote',
    });
    expect(answerVisitor).toHaveBeenCalledWith(admin, expect.objectContaining({ profile }));
    expect(seen).not.toContain('lite_price_profiles');

    seen.length = 0;
    tables.set('lite_interviews', { data: { draft_profile: {} }, error: null, count: null });
    tables.set('lite_price_profiles', { data: { profile }, error: null, count: null });
    const early = await post({ messages: [{ role: 'user', content: 'Hello' }], source: 'interview' });
    expect(early.status).toBe(200);
    expect(await early.json()).toMatchObject({ mode: 'enquiry' });
    expect(answerVisitor).toHaveBeenLastCalledWith(admin, expect.objectContaining({ profile: null }));
    expect(seen).not.toContain('lite_price_profiles');

    tables.set('lite_interviews', { data: null, error: null, count: null });
    const noDraft = await post({ messages: [{ role: 'user', content: 'Hello' }], source: 'interview' });
    expect(noDraft.status).toBe(200);
    expect(await noDraft.json()).toMatchObject({ mode: 'quote' });
    expect(answerVisitor).toHaveBeenLastCalledWith(admin, expect.objectContaining({ profile }));
  });

  it('passes through 401, 403 and 404 from the Lite guard', async () => {
    requireLite.mockResolvedValue({ ok: false, status: 401, error: 'Not signed in' });
    const loggedOut = await post({ messages: [{ role: 'user', content: 'Hi' }], source: 'live' });
    expect(loggedOut.status).toBe(401);
    expect(await loggedOut.json()).toEqual({ error: 'Not signed in' });

    requireLite.mockResolvedValue({ ok: false, status: 403, error: 'The website assistant is part of Lite.' });
    const forbidden = await POST(new Request('http://localhost/api/lite/preview/chat', { method: 'POST' }));
    expect(forbidden.status).toBe(403);

    requireLite.mockResolvedValue({ ok: false, status: 404, error: 'No widget' });
    const missing = await post({ messages: [{ role: 'user', content: 'Hi' }], source: 'live' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No widget' });
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('shows the brain fallback like any other reply', async () => {
    answerVisitor.mockResolvedValue({
      reply: "Sorry, I'm having a bit of trouble — leave your details and Dave will get back to you.",
      quote: null,
      askForDetails: true,
      outOfArea: false,
      usedFallback: true,
    });
    const res = await post({ messages: [{ role: 'user', content: 'Hi' }], source: 'live' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toContain('Dave will get back to you');
    expect(body.askForDetails).toBe(true);
    expect(body.quote).toBeNull();
  });

  it('refuses the 201st practice message of the day, and fails closed when the count errors', async () => {
    tables.set('ai_interactions', { data: null, error: null, count: 200 });
    const capped = await post({ messages: [{ role: 'user', content: 'One more' }], source: 'live' });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({
      limited: true,
      message: "That's a lot of practice for one day — try again tomorrow.",
    });
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(seen).toEqual(['ai_interactions']);

    tables.set('ai_interactions', { data: null, error: { message: 'boom' }, count: null });
    const errored = await post({ messages: [{ role: 'user', content: 'One more' }], source: 'live' });
    expect(errored.status).toBe(429);

    countThrows = true;
    const thrown = await post({ messages: [{ role: 'user', content: 'One more' }], source: 'live' });
    expect(thrown.status).toBe(429);
    expect(answerVisitor).not.toHaveBeenCalled();
  });

  it('rejects a bad body and more than 30 user messages', async () => {
    expect((await post('not-json', true)).status).toBe(400);
    expect((await post({ messages: [], source: 'live' })).status).toBe(400);
    expect((await post({ messages: [{ role: 'assistant', content: 'Hi' }], source: 'live' })).status).toBe(400);
    expect(
      (await post({ messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Yes' }], source: 'live' }))
        .status,
    ).toBe(400);
    expect((await post({ messages: userMessages(31), source: 'live' })).status).toBe(400);
    expect(answerVisitor).not.toHaveBeenCalled();

    tables.set('lite_price_profiles', { data: { profile }, error: null, count: null });
    const ok = await post({ messages: userMessages(30), source: 'live' });
    expect(ok.status).toBe(200);
    expect(answerVisitor).toHaveBeenCalledTimes(1);
  });
});
