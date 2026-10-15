import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceProfile } from '@/lib/lite/profile-schema';
import { makeWidgetSession } from '@/lib/widget/session';
import { visitorHash } from '@/lib/widget/usage';

const answerVisitor = vi.fn();

vi.mock('@/lib/widget/brain', () => ({
  answerVisitor: (...args: unknown[]) => answerVisitor(...args),
  BRAIN_FALLBACK_REPLY: (signOff: string) => `Sorry — ${signOff} will get back to you.`,
}));

type Row = Record<string, unknown>;
type Kind = 'conversation' | 'message';

const flags = {
  conversationMaybeError: false,
  insertError: false,
  visitorUpdateError: false,
  forceBusy: false,
  profileError: false,
  deny: new Set<Kind>(),
};

const conversations: Row[] = [];
const profiles: Row[] = [];
const widgets: Row[] = [];
const subs: Row[] = [];
const rpcCalls: Array<{ p_kind: Kind }> = [];

function chain(table: string, rows: Row[]) {
  const preds: Array<(row: Row) => boolean> = [];
  let patch: Row | null = null;
  const matched = () => rows.filter((row) => preds.every((pred) => pred(row)));
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (key: string, value: unknown) => {
      preds.push((row) => row[key] === value);
      return b;
    },
    in: (key: string, values: readonly unknown[]) => {
      preds.push((row) => values.includes(row[key]));
      return b;
    },
    gte: (key: string, value: string) => {
      preds.push((row) => String(row[key]) >= value);
      return b;
    },
    not: (key: string, op: string, value: unknown) => {
      if (op === 'is' && value === null) preds.push((row) => row[key] != null);
      return b;
    },
    limit: () => b,
    insert: (row: Row) => {
      if (flags.insertError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      if (rows.some((existing) => existing.id === row.id)) {
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
      }
      rows.push({
        messages: [],
        visitor_message_count: 0,
        status: 'active',
        created_at: new Date().toISOString(),
        ...row,
      });
      return Promise.resolve({ data: null, error: null });
    },
    update: (next: Row) => {
      patch = next;
      return b;
    },
    maybeSingle: async () => {
      if (table === 'widget_conversations' && flags.conversationMaybeError) {
        return { data: null, error: { message: 'boom' } };
      }
      if (table === 'lite_price_profiles' && flags.profileError) {
        return { data: null, error: { message: 'boom' } };
      }
      return { data: matched()[0] ?? null, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      if (patch && patch.visitor_message_count != null && flags.visitorUpdateError) {
        return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
      }
      if (patch && patch.visitor_message_count != null && flags.forceBusy) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
      if (patch) {
        const hit = matched();
        for (const row of hit) Object.assign(row, patch);
        return Promise.resolve({ data: hit.map((row) => ({ id: row.id })), error: null }).then(resolve, reject);
      }
      const data = matched();
      return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
    },
  };
  return b;
}

const admin = {
  from(table: string) {
    if (table === 'widget_clients') return chain(table, widgets);
    if (table === 'subscriptions') return chain(table, subs);
    if (table === 'lite_price_profiles') return chain(table, profiles);
    if (table === 'widget_conversations') return chain(table, conversations);
    throw new Error(table);
  },
  async rpc(_fn: string, args: { p_kind: Kind }) {
    rpcCalls.push(args);
    if (flags.deny.has(args.p_kind)) return { data: false, error: null };
    return { data: true, error: null };
  },
} as unknown as SupabaseClient;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin,
}));

import { GET, OPTIONS as optionsConfig } from '@/app/api/widget/[clientId]/config/route';
import { OPTIONS, POST } from '@/app/api/widget/chat/route';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const profile: PriceProfile = {
  areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: 12 },
  callout_fee: null,
  hourly_rate: null,
  day_rate: null,
  minimum_charge: null,
  materials: '',
  job_types: [
    {
      key: 'lock-change',
      name: 'Lock change',
      how_priced: 'from_description',
      guide_min: 70,
      guide_max: 120,
      what_changes_price: 'SECRET-PROFILE-RULE',
      auto_accept: false,
    },
  ],
  rules: [],
  example_jobs: [],
  tone: 'Warm',
};

function widget() {
  return {
    id: CLIENT,
    tenant_id: TENANT,
    business_name: 'Dave Plastering',
    trade: 'plastering',
    service_area: 'South Manchester',
    business_context: 'SECRET-CONTEXT',
    greeting: 'Hello',
    primary_colour: '#112233',
    allowed_domains: ['dave.co.uk'],
    owner_mobile_e164: '+447700900123',
    sign_off_name: 'Dave',
    follow_up_enabled: true,
    text_me_too: false,
    notification_email: 'secret@example.com',
    active: true,
  };
}

function reset() {
  conversations.length = 0;
  profiles.length = 0;
  widgets.length = 0;
  subs.length = 0;
  rpcCalls.length = 0;
  widgets.push(widget());
  subs.push({ id: 'sub-1', tenant_id: TENANT, product: 'lite', status: 'active' });
  flags.conversationMaybeError = false;
  flags.insertError = false;
  flags.visitorUpdateError = false;
  flags.forceBusy = false;
  flags.profileError = false;
  flags.deny.clear();
  answerVisitor.mockReset();
  answerVisitor.mockResolvedValue({
    reply: 'That would be £85.',
    quote: { kind: 'firm', jobTypeKey: 'lock-change', amount: 85, summary: 'Lock' },
    askForDetails: false,
    outOfArea: false,
    usedFallback: false,
  });
  process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
}

function chatRequest(body: unknown, origin = 'https://dave.co.uk'): Request {
  return new Request('https://app.joinworkwise.com/api/widget/chat', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function sessionFor(conversationId: string, clientId = CLIENT, now?: Date): string {
  return makeWidgetSession(clientId, conversationId, now).token;
}

async function post(body: unknown, origin?: string): Promise<Response> {
  return POST(chatRequest(body, origin));
}

describe('widget config', () => {
  beforeEach(reset);

  it('returns a fresh conversation each load and does not create a row or count usage', async () => {
    profiles.push({ tenant_id: TENANT, profile });
    const first = await GET(new Request('https://app.joinworkwise.com/api/widget/x/config', { headers: { origin: 'https://dave.co.uk' } }), {
      params: Promise.resolve({ clientId: CLIENT }),
    });
    const second = await GET(new Request('https://app.joinworkwise.com/api/widget/x/config', { headers: { origin: 'https://dave.co.uk' } }), {
      params: Promise.resolve({ clientId: CLIENT }),
    });
    const a = await first.json();
    const b = await second.json();
    expect(first.status).toBe(200);
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(a).toMatchObject({
      active: true,
      businessName: 'Dave Plastering',
      primaryColour: '#112233',
      greeting: 'Hello',
      mode: 'quote',
    });
    expect(Object.keys(a).sort()).toEqual([
      'active',
      'businessName',
      'conversationId',
      'greeting',
      'mode',
      'primaryColour',
      'session',
      'sessionExpiresAt',
    ]);
    expect(JSON.stringify(a)).not.toContain('SECRET-CONTEXT');
    expect(JSON.stringify(a)).not.toContain('secret@example.com');
    expect(JSON.stringify(a)).not.toContain(TENANT);
    expect(JSON.stringify(a)).not.toContain('+447700900123');
    expect(conversations).toHaveLength(0);
    expect(rpcCalls).toEqual([]);
    expect(first.headers.get('access-control-allow-origin')).toBe('https://dave.co.uk');
  });

  it('is enquiry mode without a valid profile, and preflight does not use a star', async () => {
    const response = await GET(new Request('https://app.joinworkwise.com/api/widget/x/config', { headers: { origin: 'https://dave.co.uk' } }), {
      params: Promise.resolve({ clientId: CLIENT }),
    });
    expect((await response.json()).mode).toBe('enquiry');
    const preflight = optionsConfig(new Request('https://app.joinworkwise.com/api/widget/x/config', { headers: { origin: 'https://dave.co.uk' } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).not.toBe('*');
  });
});

describe('widget chat', () => {
  beforeEach(() => {
    reset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('creates the row on the first message and reuses it on the next', async () => {
    const first = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Need a lock' });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      reply: 'That would be £85.',
      quote: { kind: 'firm', amount: 85, summary: 'Lock' },
      askForDetails: false,
      outOfArea: false,
    });
    expect(first.headers.get('access-control-allow-origin')).toBe('https://dave.co.uk');
    expect(conversations).toHaveLength(1);
    expect(conversations[0].visitor_message_count).toBe(1);
    expect(conversations[0].messages).toHaveLength(2);
    expect(rpcCalls.map((call) => call.p_kind)).toEqual(['conversation', 'message']);

    const second = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'A Yale one' });
    expect(second.status).toBe(200);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].visitor_message_count).toBe(2);
    expect(rpcCalls.map((call) => call.p_kind)).toEqual(['conversation', 'message', 'message']);
    const history = answerVisitor.mock.calls[1][1].history;
    expect(history.map((message: { content: string }) => message.content)).toEqual([
      'Need a lock',
      'That would be £85.',
      'A Yale one',
    ]);
    expect(answerVisitor.mock.calls[0][1].business.signOff).toBe('Dave');
  });

  it('ignores any history the browser tries to send', async () => {
    const response = await post({
      clientId: CLIENT,
      conversationId: CONV,
      session: sessionFor(CONV),
      message: 'Need a lock',
      messages: [{ role: 'user', content: 'HACK-HISTORY' }],
    });
    expect(response.status).toBe(200);
    expect(answerVisitor.mock.calls[0][1].history).toEqual([{ role: 'user', content: 'Need a lock' }]);
    expect(JSON.stringify(await response.json())).not.toContain('HACK-HISTORY');
  });

  it('stops the sixth new chat, the 61st chat of the day, and the 31st message', async () => {
    const hash = visitorHash(chatRequest({}));
    for (let i = 0; i < 5; i += 1) {
      conversations.push({
        id: `55555555-5555-4555-8555-55555555555${i}`,
        client_id: CLIENT,
        visitor_hash: hash,
        created_at: new Date().toISOString(),
        visitor_message_count: 0,
        messages: [],
      });
    }
    const sixth = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).limited).toBe(true);
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);

    conversations.length = 0;
    flags.deny.add('conversation');
    const day = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(day.status).toBe(429);
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(conversations).toHaveLength(0);

    flags.deny.clear();
    conversations.push({
      id: CONV,
      client_id: CLIENT,
      tenant_id: TENANT,
      visitor_hash: hash,
      visitor_message_count: 30,
      messages: [],
      status: 'active',
    });
    const full = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(full.status).toBe(429);
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(conversations[0].visitor_message_count).toBe(30);
  });

  it('answers one message and tells the other it is busy', async () => {
    conversations.push({
      id: CONV,
      client_id: CLIENT,
      tenant_id: TENANT,
      visitor_message_count: 0,
      messages: [],
      status: 'active',
    });
    flags.forceBusy = true;
    const response = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ busy: true });
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(conversations[0].messages).toEqual([]);
  });

  it('refuses a bad, expired or forged session and stores nothing', async () => {
    const before = conversations.length;
    const cases = [
      { clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV, OTHER), message: 'Hi' },
      { clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV, CLIENT, new Date(Date.now() - 3 * 60 * 60 * 1000)), message: 'Hi' },
      { clientId: CLIENT, conversationId: OTHER, session: sessionFor(CONV), message: 'Hi' },
    ];
    for (const body of cases) {
      const response = await post(body);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'session' });
    }
    conversations.push({
      id: CONV,
      client_id: OTHER,
      tenant_id: TENANT,
      visitor_message_count: 0,
      messages: [{ role: 'user', content: 'SECRET-OTHER', at: '2026-10-02T12:00:00.000Z' }],
      status: 'active',
    });
    const forged = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hi' });
    expect(forged.status).toBe(401);
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(conversations).toHaveLength(before + 1);
    expect(JSON.stringify(conversations[0].messages)).toContain('SECRET-OTHER');
  });

  it('reopens an ended chat inside the session', async () => {
    conversations.push({
      id: CONV,
      client_id: CLIENT,
      tenant_id: TENANT,
      visitor_message_count: 1,
      messages: [{ role: 'user', content: 'Earlier', at: '2026-10-02T10:00:00.000Z' }],
      status: 'ended',
      ended_at: '2026-10-02T11:00:00.000Z',
    });
    const response = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Still here' });
    expect(response.status).toBe(200);
    expect(conversations[0]).toMatchObject({ status: 'active', ended_at: null, visitor_message_count: 2 });
  });

  it('saves the friendly fallback when the assistant fails', async () => {
    answerVisitor.mockResolvedValue({
      reply: 'Sorry — Dave will get back to you.',
      quote: null,
      askForDetails: true,
      outOfArea: false,
      usedFallback: true,
    });
    const response = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ askForDetails: true, quote: null });
    expect(JSON.stringify(conversations[0].messages)).toContain('Sorry — Dave will get back to you.');

    answerVisitor.mockRejectedValue(new Error('boom'));
    const thrown = await post({ clientId: CLIENT, conversationId: OTHER, session: sessionFor(OTHER), message: 'Hello again' });
    expect(thrown.status).toBe(200);
    expect(await thrown.json()).toMatchObject({ askForDetails: true, quote: null });
  });

  it('returns 503 and does not call the assistant when the database fails', async () => {
    flags.conversationMaybeError = true;
    const load = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(load.status).toBe(503);
    expect(answerVisitor).not.toHaveBeenCalled();

    flags.conversationMaybeError = false;
    flags.insertError = true;
    const start = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(start.status).toBe(503);
    expect(answerVisitor).not.toHaveBeenCalled();

    flags.insertError = false;
    conversations.push({
      id: CONV,
      client_id: CLIENT,
      tenant_id: TENANT,
      visitor_message_count: 0,
      messages: [],
      status: 'active',
    });
    flags.visitorUpdateError = true;
    const append = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(append.status).toBe(503);
    expect(answerVisitor).not.toHaveBeenCalled();
  });

  it('uses the guard refusal for the wrong website or a cancelled Lite plan', async () => {
    const wrong = await post(
      { clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' },
      'https://evil.example',
    );
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ active: false });
    expect(answerVisitor).not.toHaveBeenCalled();
    expect(conversations).toHaveLength(0);

    subs[0].status = 'canceled';
    const cancelled = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(cancelled.status).toBe(404);
    expect(answerVisitor).not.toHaveBeenCalled();

    subs[0].status = 'active';
    widgets[0].allowed_domains = [];
    const unset = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    expect(unset.status).toBe(403);
    expect(conversations).toHaveLength(0);
  });

  it('rejects a bad body and keeps the reply free of private fields', async () => {
    expect((await post('not-json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: '   ' })).status).toBe(400);
    expect(answerVisitor).not.toHaveBeenCalled();

    profiles.push({ tenant_id: TENANT, profile });
    const response = await post({ clientId: CLIENT, conversationId: CONV, session: sessionFor(CONV), message: 'Hello' });
    const body = await response.json();
    const text = JSON.stringify(body);
    expect(text).not.toContain('SECRET-PROFILE-RULE');
    expect(text).not.toContain('SECRET-CONTEXT');
    expect(text).not.toContain(TENANT);
    expect(text).not.toContain('secret@example.com');
    expect(text).not.toContain('+447700900123');
    expect(text).not.toContain('lock-change');
    expect(answerVisitor.mock.calls[0][1].profile.job_types[0].key).toBe('lock-change');
    const logged = (console.info as unknown as { mock: { calls: unknown[] } }).mock.calls.flat().join(' ');
    expect(logged).toContain(CONV);
    expect(logged).not.toContain('Hello');
  });
});

describe('chat preflight', () => {
  it('answers 204', () => {
    const response = OPTIONS(new Request('https://app.joinworkwise.com/api/widget/chat', { headers: { origin: 'https://dave.co.uk' } }));
    expect(response.status).toBe(204);
  });
});
