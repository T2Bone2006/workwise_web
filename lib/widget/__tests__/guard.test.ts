import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@/lib/accountant/tokens';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { guardWidgetRequest, limitedResponse, preflightResponse, type WidgetRow } from '@/lib/widget/guard';
import { WIDGET_LIMITS } from '@/lib/widget/limits-config';
import { claimUsage, visitorConversationsLastHour, visitorHash } from '@/lib/widget/usage';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';

type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;

function widget(overrides: Partial<WidgetRow> & { active?: boolean } = {}): Row {
  return {
    id: CLIENT,
    tenant_id: TENANT,
    business_name: 'Dave Plastering',
    trade: 'plastering',
    service_area: 'Manchester',
    business_context: 'private pricing notes',
    greeting: 'Hi',
    primary_colour: '#0C66E4',
    allowed_domains: ['dave.co.uk'],
    owner_mobile_e164: '+447700900123',
    sign_off_name: 'Dave',
    follow_up_enabled: true,
    text_me_too: false,
    notification_email: 'dave@example.com',
    active: true,
    ...overrides,
  };
}

function chain(rows: Row[], error: { message: string } | null) {
  const preds: Pred[] = [];
  const b: Record<string, unknown> = {};
  const matched = () => {
    if (error) return { data: null as Row[] | null, error, count: null as number | null };
    const data = rows.filter((row) => preds.every((pred) => pred(row)));
    return { data, error: null, count: data.length };
  };
  b.select = () => b;
  b.eq = (key: string, value: unknown) => {
    preds.push((row) => row[key] === value);
    return b;
  };
  b.in = (key: string, values: readonly unknown[]) => {
    preds.push((row) => values.includes(row[key]));
    return b;
  };
  b.not = (key: string, op: string, value: unknown) => {
    if (op === 'is' && value === null) preds.push((row) => row[key] != null);
    return b;
  };
  b.gte = (key: string, value: string) => {
    preds.push((row) => String(row[key]) >= value);
    return b;
  };
  b.limit = () => b;
  b.insert = () => {
    throw new Error('guard must not write');
  };
  b.maybeSingle = async () => {
    const result = matched();
    if (result.error) return { data: null, error: result.error };
    return { data: result.data?.[0] ?? null, error: null };
  };
  b.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(matched()).then(resolve, reject);
  return b;
}

function mockAdmin(opts: {
  widgets?: Row[];
  widgetError?: { message: string } | null;
  subs?: Row[];
  subError?: { message: string } | null;
  conversations?: Row[];
  conversationError?: { message: string } | null;
  rpc?: { data: unknown; error: { message: string } | null } | 'throw';
}) {
  const calls: string[] = [];
  const rpcArgs: unknown[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      if (table === 'widget_clients') return chain(opts.widgets ?? [], opts.widgetError ?? null);
      if (table === 'subscriptions') return chain(opts.subs ?? [], opts.subError ?? null);
      if (table === 'widget_conversations') return chain(opts.conversations ?? [], opts.conversationError ?? null);
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(fn: string, args: unknown) {
      calls.push(`rpc:${fn}`);
      rpcArgs.push(args);
      if (opts.rpc === 'throw') throw new Error('rpc down');
      return opts.rpc ?? { data: true, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcArgs };
}

function request(origin?: string, extra: Record<string, string> = {}, url = 'https://app.joinworkwise.com/api/widget/x'): Request {
  const headers = new Headers(extra);
  if (origin !== undefined) headers.set('origin', origin);
  return new Request(url, { headers });
}

const entitled = { id: 'sub-1', tenant_id: TENANT, product: 'lite', status: 'active' };

async function bodyOf(response: Response): Promise<unknown> {
  return response.json();
}

describe('guardWidgetRequest', () => {
  const originalSecret = process.env.WIDGET_SESSION_SECRET;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalSecret === undefined) delete process.env.WIDGET_SESSION_SECRET;
    else process.env.WIDGET_SESSION_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it('refuses a client id that is not a uuid, without reading the database', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { client, calls } = mockAdmin({});
    const result = await guardWidgetRequest(client, request('https://dave.co.uk'), 'not-a-uuid', {
      methods: 'GET, OPTIONS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await bodyOf(result.response)).toEqual({ active: false });
    }
    expect(calls).toEqual([]);
  });

  it('answers 503 when the session secret is missing, and logs no request detail', async () => {
    delete process.env.WIDGET_SESSION_SECRET;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = mockAdmin({ widgets: [widget()], subs: [entitled] });
    const result = await guardWidgetRequest(client, request('https://dave.co.uk'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(calls).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).not.toContain('dave.co.uk');
    expect(logged).not.toContain('test-widget-secret');
  });

  it('answers 404 when the widget is missing', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { client } = mockAdmin({ widgets: [], subs: [entitled] });
    const result = await guardWidgetRequest(client, request('https://dave.co.uk'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await bodyOf(result.response)).toEqual({ active: false });
    }
  });

  it('answers 404 when Lite is cancelled, even on the right website', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { client } = mockAdmin({
      widgets: [widget()],
      subs: [{ id: 'sub-1', tenant_id: TENANT, product: 'lite', status: 'canceled' }],
    });
    const result = await guardWidgetRequest(client, request('https://dave.co.uk'), CLIENT, {
      methods: 'POST, OPTIONS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await bodyOf(result.response)).toEqual({ active: false });
    }
  });

  it('answers 404 when the subscription query errors', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = mockAdmin({
      widgets: [widget()],
      subError: { message: 'db down' },
      subs: [entitled],
    });
    const result = await guardWidgetRequest(client, request('https://dave.co.uk'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it('answers 403 with no CORS header when the origin is missing or not the tradie website', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const cases = [undefined, 'https://evil-dave.co.uk', 'https://dave.co.uk.evil.com', 'https://shop.dave.co.uk'];
    for (const origin of cases) {
      const { client, calls } = mockAdmin({ widgets: [widget()], subs: [entitled] });
      const result = await guardWidgetRequest(client, request(origin), CLIENT, { methods: 'GET, OPTIONS' });
      expect(result.ok, String(origin)).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
        expect(result.response.headers.get('access-control-allow-origin')).toBeNull();
        expect(await bodyOf(result.response)).toEqual({ active: false });
      }
      expect(calls).not.toContain('rpc:claim_widget_usage');
    }
  });

  it('allows the website with and without www, and echoes that exact origin', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    for (const origin of ['https://dave.co.uk', 'https://www.dave.co.uk']) {
      const { client, calls } = mockAdmin({ widgets: [widget()], subs: [entitled] });
      const result = await guardWidgetRequest(client, request(origin), CLIENT, { methods: 'GET, OPTIONS' });
      expect(result.ok, origin).toBe(true);
      if (result.ok) {
        expect(result.originHost).toBe(new URL(origin).hostname);
        expect(result.cors['Access-Control-Allow-Origin']).toBe(origin);
        expect(result.cors['Access-Control-Allow-Origin']).not.toBe('*');
        expect(result.cors.Vary).toBe('Origin');
        expect(result.cors['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
        expect(result.widget.notification_email).toBe('dave@example.com');
      }
      expect(calls).toEqual(['widget_clients', 'subscriptions']);
    }
  });

  it('keeps a past_due Lite subscription on, and a Pro subscription off', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const pastDue = mockAdmin({
      widgets: [widget()],
      subs: [{ id: 'sub-1', tenant_id: TENANT, product: 'lite', status: 'past_due' }],
    });
    expect(ENTITLED_STATUSES).toContain('past_due');
    const ok = await guardWidgetRequest(pastDue.client, request('https://dave.co.uk'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(ok.ok).toBe(true);

    const pro = mockAdmin({
      widgets: [widget()],
      subs: [{ id: 'sub-1', tenant_id: TENANT, product: 'pro', status: 'active' }],
    });
    const refused = await guardWidgetRequest(pro.client, request('https://dave.co.uk'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.response.status).toBe(404);
  });

  it('allows localhost on the laptop and refuses it in production', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    vi.stubEnv('WIDGET_ALLOW_LOCALHOST', '1');
    vi.stubEnv('NODE_ENV', 'test');
    const laptop = mockAdmin({ widgets: [widget({ allowed_domains: [] })], subs: [entitled] });
    const allowed = await guardWidgetRequest(laptop.client, request('http://localhost:3000'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(allowed.ok).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    const live = mockAdmin({ widgets: [widget({ allowed_domains: [] })], subs: [entitled] });
    const refused = await guardWidgetRequest(live.client, request('http://localhost:3000'), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.response.status).toBe(403);
  });

  it('allows the laptop test page when the browser sends no Origin', async () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    vi.stubEnv('WIDGET_ALLOW_LOCALHOST', '1');
    vi.stubEnv('NODE_ENV', 'test');
    const laptop = mockAdmin({ widgets: [widget({ allowed_domains: ['joinworkwise.com'] })], subs: [entitled] });
    const page = 'http://localhost:3000/api/widget/x/config';
    const allowed = await guardWidgetRequest(laptop.client, request(undefined, {}, page), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(allowed.ok).toBe(true);

    vi.stubEnv('WIDGET_ALLOW_LOCALHOST', '');
    const refused = await guardWidgetRequest(laptop.client, request(undefined, {}, page), CLIENT, {
      methods: 'GET, OPTIONS',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.response.status).toBe(403);
  });
});

describe('preflightResponse', () => {
  it('echoes a parsable origin and sends no CORS header when the origin does not parse', () => {
    const ok = preflightResponse(request('https://evil.example'), 'POST, OPTIONS');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://evil.example');
    expect(ok.headers.get('access-control-allow-origin')).not.toBe('*');

    const bad = preflightResponse(request('not a url'), 'GET, OPTIONS');
    expect(bad.status).toBe(204);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();

    const missing = preflightResponse(request(), 'GET, OPTIONS');
    expect(missing.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('limitedResponse', () => {
  const cors = {
    'Access-Control-Allow-Origin': 'https://dave.co.uk',
    Vary: 'Origin',
  };

  it('asks the visitor to call when the tradie has a mobile', async () => {
    const response = limitedResponse(cors, '+447700900123');
    expect(response.status).toBe(429);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://dave.co.uk');
    expect(await bodyOf(response)).toEqual({
      limited: true,
      message: "Sorry, I can't take more messages right now — please call 07700 900123 instead.",
    });
  });

  it('asks them to try later when there is no mobile', async () => {
    const response = limitedResponse(cors, null);
    expect(await bodyOf(response)).toEqual({
      limited: true,
      message: "Sorry, I can't take more messages right now — please try again later.",
    });
  });
});

describe('claimUsage', () => {
  it('returns false unless the usage function returns exactly true', async () => {
    const clientId = CLIENT;
    const ok = mockAdmin({ rpc: { data: true, error: null } });
    expect(await claimUsage(ok.client, clientId, 'conversation')).toBe(true);
    expect(ok.rpcArgs[0]).toEqual({
      p_client_id: clientId,
      p_kind: 'conversation',
      p_max: WIDGET_LIMITS.conversationsPerDay,
    });

    const message = mockAdmin({ rpc: { data: true, error: null } });
    expect(await claimUsage(message.client, clientId, 'message')).toBe(true);
    expect(message.rpcArgs[0]).toMatchObject({ p_kind: 'message', p_max: WIDGET_LIMITS.messagesPerDay });

    for (const data of [false, null, 'true', 1]) {
      const { client } = mockAdmin({ rpc: { data, error: null } });
      expect(await claimUsage(client, clientId, 'message')).toBe(false);
    }

    const erred = mockAdmin({ rpc: { data: true, error: { message: 'boom' } } });
    expect(await claimUsage(erred.client, clientId, 'conversation')).toBe(false);

    const thrown = mockAdmin({ rpc: 'throw' });
    expect(await claimUsage(thrown.client, clientId, 'conversation')).toBe(false);
  });

  it('returns null when the visitor-conversation count errors', async () => {
    const { client } = mockAdmin({ conversationError: { message: 'boom' } });
    expect(await visitorConversationsLastHour(client, CLIENT, 'abc')).toBeNull();
  });
});

describe('visitorHash', () => {
  const original = process.env.WIDGET_SESSION_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.WIDGET_SESSION_SECRET;
    else process.env.WIDGET_SESSION_SECRET = original;
    vi.restoreAllMocks();
  });

  it('hashes the first forwarded IP with the secret, and never returns or logs the IP', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ip = '203.0.113.50';
    const req = request(undefined, { 'x-forwarded-for': `${ip}, 198.51.100.2` });
    const hash = visitorHash(req);
    expect(hash).toBe(sha256Hex(`${ip}|test-widget-secret`).slice(0, 32));
    expect(hash).not.toContain(ip);
    expect(visitorHash(request(undefined, { 'x-forwarded-for': ip }))).toBe(hash);
    expect(error.mock.calls.flat().join(' ')).not.toContain(ip);
    expect(log.mock.calls.flat().join(' ')).not.toContain(ip);
  });

  it('changes when the secret changes, and falls back to x-real-ip then unknown', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const ip = '203.0.113.50';
    const first = visitorHash(request(undefined, { 'x-forwarded-for': ip }));
    process.env.WIDGET_SESSION_SECRET = 'other-secret';
    expect(visitorHash(request(undefined, { 'x-forwarded-for': ip }))).not.toBe(first);

    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const viaReal = visitorHash(request(undefined, { 'x-real-ip': ip }));
    expect(viaReal).toBe(first);
    const unknown = visitorHash(request());
    expect(unknown).toBe(sha256Hex('unknown|test-widget-secret').slice(0, 32));
    expect(unknown).not.toBe(first);
  });
});
