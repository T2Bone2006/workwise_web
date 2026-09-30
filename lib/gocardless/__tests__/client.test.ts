import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoCardlessError,
  goCardlessClient,
  isRevokedError,
} from '@/lib/gocardless/client';
import { goCardlessConfig, isGoCardlessConfigured } from '@/lib/gocardless/config';

const TOKEN = 'sandbox_test_token_value';

function setGoCardlessEnv(): void {
  process.env.GOCARDLESS_ENVIRONMENT = 'sandbox';
  process.env.GOCARDLESS_CLIENT_ID = 'client-id';
  process.env.GOCARDLESS_CLIENT_SECRET = 'client-secret';
  process.env.GOCARDLESS_WEBHOOK_SECRET = 'webhook-secret';
  process.env.GOCARDLESS_TOKEN_KEY = randomBytes(32).toString('base64');
  process.env.GOCARDLESS_REDIRECT_URI = 'https://example.test/api/gocardless/callback';
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  setGoCardlessEnv();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('goCardlessConfig', () => {
  it('reads the sandbox urls', () => {
    const config = goCardlessConfig();
    expect(config.apiBase).toBe('https://api-sandbox.gocardless.com');
    expect(config.connectBase).toBe('https://connect-sandbox.gocardless.com');
    expect(config.verifyUrl).toBe('https://verify-sandbox.gocardless.com');
    expect(config.tokenKey).toHaveLength(32);
  });

  it('is not configured when a value is missing or wrong', () => {
    delete process.env.GOCARDLESS_WEBHOOK_SECRET;
    expect(isGoCardlessConfigured()).toBe(false);
    expect(() => goCardlessConfig()).toThrow('GoCardless is not configured');

    setGoCardlessEnv();
    process.env.GOCARDLESS_ENVIRONMENT = 'production';
    expect(isGoCardlessConfigured()).toBe(false);

    setGoCardlessEnv();
    process.env.GOCARDLESS_TOKEN_KEY = 'too-short';
    expect(isGoCardlessConfigured()).toBe(false);

    setGoCardlessEnv();
    expect(isGoCardlessConfigured()).toBe(true);
  });
});

describe('goCardlessClient', () => {
  it('sends the headers GoCardless needs on GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { creditors: [] }));
    await goCardlessClient(TOKEN).get('/creditors', { limit: 1, after: undefined });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-sandbox.gocardless.com/creditors?limit=1');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['GoCardless-Version']).toBe('2015-07-06');
    expect(headers.Accept).toBe('application/json');
    expect(headers['Idempotency-Key']).toBeUndefined();
    expect(init?.method).toBe('GET');
  });

  it('adds Content-Type and the idempotency key on POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { payments: { id: 'PM1' } }));
    const out = await goCardlessClient(TOKEN).post<{ payments: { id: string } }>(
      '/payments',
      { payments: { amount: 1500 } },
      { idempotencyKey: 'collection-123' },
    );
    expect(out.payments.id).toBe('PM1');
    const init = fetchMock.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('collection-123');
    expect(init?.body).toBe(JSON.stringify({ payments: { amount: 1500 } }));
  });

  it('refuses a POST without an idempotency key and a path without /', () => {
    const client = goCardlessClient(TOKEN);
    expect(() => client.post('/payments', {}, { idempotencyKey: '' })).toThrow();
    expect(() => client.get('creditors')).toThrow('must start with /');
  });

  it('actions post { data: {} } by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { mandates: { id: 'MD1' } }));
    await goCardlessClient(TOKEN).action('/mandates/MD1/actions/cancel');
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ data: {} }));
  });

  it('parses validation_failed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: {
          message: 'Validation failed',
          type: 'validation_failed',
          code: 422,
          request_id: 'req-1',
          errors: [{ field: 'amount', message: 'must be greater than 0', reason: 'greater_than' }],
        },
      }),
    );
    const err = await goCardlessClient(TOKEN).get('/payments').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoCardlessError);
    expect(err).toMatchObject({
      status: 422,
      type: 'validation_failed',
      code: 422,
      reasons: ['greater_than'],
      requestId: 'req-1',
      message: 'Validation failed',
    });
  });

  it('parses a 409 idempotent creation conflict with the conflicting id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: {
          message: 'A resource has already been created with this idempotency key',
          type: 'invalid_state',
          code: 409,
          errors: [
            {
              reason: 'idempotent_creation_conflict',
              message: 'A resource has already been created with this idempotency key',
              links: { conflicting_resource_id: 'PM123' },
            },
          ],
        },
      }),
    );
    const err = await goCardlessClient(TOKEN)
      .post('/payments', {}, { idempotencyKey: 'k' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      status: 409,
      reasons: ['idempotent_creation_conflict'],
      conflictingResourceId: 'PM123',
    });
  });

  it('recognises a revoked token, and never puts the token in the error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: {
          message: 'Access token revoked',
          type: 'invalid_api_usage',
          code: 401,
          errors: [{ reason: 'access_token_revoked', message: 'Access token revoked' }],
        },
      }),
    );
    const err = await goCardlessClient(TOKEN).get('/creditors').catch((e: unknown) => e);
    expect(isRevokedError(err)).toBe(true);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(isRevokedError(new GoCardlessError({ message: 'x', status: 401, reasons: ['other'] }))).toBe(false);
  });

  it('turns a timeout or network failure into status 0', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const err = await goCardlessClient(TOKEN).get('/creditors').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, message: 'GoCardless took too long to answer' });
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err2 = await goCardlessClient(TOKEN).get('/creditors').catch((e: unknown) => e);
    expect(err2).toMatchObject({ status: 0, message: 'Could not reach GoCardless' });
  });

  it('waits and retries once on 429', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate limited', code: 429 } }, { 'ratelimit-reset': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { creditors: [{ id: 'CR1' }] }));
    const pending = goCardlessClient(TOKEN).get<{ creditors: { id: string }[] }>('/creditors');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual({ creditors: [{ id: 'CR1' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the one 429 retry', async () => {
    vi.useFakeTimers();
    const limited = () =>
      jsonResponse(429, { error: { message: 'Rate limited', code: 429 } }, { 'ratelimit-reset': '60' });
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited());
    const pending = goCardlessClient(TOKEN).get('/creditors').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('listAll follows cursor pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { mandates: [{ id: 'MD1' }, { id: 'MD2' }], meta: { cursors: { after: 'MD2' } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { mandates: [{ id: 'MD3' }], meta: { cursors: { after: null } } }),
      );
    const all = await goCardlessClient(TOKEN).listAll<{ id: string }>('/mandates', 'mandates', {
      status: 'active',
    });
    expect(all.map((m) => m.id)).toEqual(['MD1', 'MD2', 'MD3']);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api-sandbox.gocardless.com/mandates?status=active&limit=500',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api-sandbox.gocardless.com/mandates?status=active&limit=500&after=MD2',
    );
  });

  it('listAll stops at maxPages', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { mandates: [{ id: 'MDx' }], meta: { cursors: { after: 'more' } } }),
    );
    const all = await goCardlessClient(TOKEN).listAll('/mandates', 'mandates', undefined, 3);
    expect(all).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
