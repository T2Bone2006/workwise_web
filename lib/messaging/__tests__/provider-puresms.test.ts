import { createHmac } from 'node:crypto';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  activeProvider,
  parseWebhook,
  sendText,
} from '@/lib/messaging/provider';
import {
  parsePureSmsEvent,
  verifyPureSmsSignature,
} from '@/lib/messaging/providers/puresms';

const SECRET = 'test-webhook-secret';
const SEND_INPUT = {
  to: '+447700900123',
  body: 'Hello from WorkWise test',
  clientReference: 'msg-uuid-1',
};

/** Real PureSMS delivery (event_type 1). MessageId is an unquoted integer. */
const DELIVERY_RECEIPT_JSON =
  '{"id":"e278ad16-1111-4111-8111-111111111111","timestamp":"2026-09-28T12:00:00Z","workspace_id":"3628","event_type":1,"data":{"MessageId":362974462422827008,"ClientReference":"241415ce-3570-4db7-a194-edac017acdb6","DeliveryStatus":7,"DeliveryStatusStr":"Delivered","ErrorCode":null,"ProcessedAt":"2026-09-28T12:00:01Z","DeliveredAt":"2026-09-28T12:00:05Z","SmsParts":1,"CostEur":null,"CostGbp":null}}';

/** Real PureSMS inbound (event_type 2). */
const INBOUND_JSON =
  '{"id":"057f6c05-2222-4222-8222-222222222222","timestamp":"2026-09-28T12:01:00Z","workspace_id":"3628","event_type":2,"data":{"MessageId":"362974480185692160","InboundNumber":"WorkWise","Sender":"+447700900003","Body":"Reply from the simulator: got \\"…\\"","ReceivedAt":"2026-09-28T12:01:00Z","Channel":"web"}}';

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('base64');
}

describe('activeProvider / sendText transport', () => {
  const prevTransport = process.env.MESSAGING_TRANSPORT;
  const prevKey = process.env.PURESMS_API_KEY;
  const prevSender = process.env.PURESMS_SENDER;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (prevTransport === undefined) delete process.env.MESSAGING_TRANSPORT;
    else process.env.MESSAGING_TRANSPORT = prevTransport;
    if (prevKey === undefined) delete process.env.PURESMS_API_KEY;
    else process.env.PURESMS_API_KEY = prevKey;
    if (prevSender === undefined) delete process.env.PURESMS_SENDER;
    else process.env.PURESMS_SENDER = prevSender;
  });

  it('defaults to log and never calls fetch when transport is unset or not puresms', async () => {
    delete process.env.MESSAGING_TRANSPORT;
    expect(activeProvider()).toBe('log');
    const unset = await sendText(SEND_INPUT);
    expect(unset.ok).toBe(true);
    if (unset.ok) {
      expect(unset.provider).toBe('log');
      expect(unset.providerMessageId).toMatch(/^log_/);
    }

    process.env.MESSAGING_TRANSPORT = '';
    expect(activeProvider()).toBe('log');

    process.env.MESSAGING_TRANSPORT = 'twilio';
    expect(activeProvider()).toBe('log');
    await sendText(SEND_INPUT);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps a PureSMS 200 with string id and null segments', async () => {
    process.env.MESSAGING_TRANSPORT = 'puresms';
    process.env.PURESMS_API_KEY = 'test-key';
    process.env.PURESMS_SENDER = '+447700900100';
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: '362902582244425728', countryCode: 44 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await sendText(SEND_INPUT);
    expect(result).toEqual({
      ok: true,
      provider: 'puresms',
      providerMessageId: '362902582244425728',
      segments: null,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
  });

  it('treats HTTP 400 as not retryable', async () => {
    process.env.MESSAGING_TRANSPORT = 'puresms';
    process.env.PURESMS_API_KEY = 'test-key';
    process.env.PURESMS_SENDER = '+447700900100';
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'bad recipient' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await sendText(SEND_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.error).toBe('PureSMS 400: bad recipient');
    }
  });

  it('treats a thrown TypeError as retryable', async () => {
    process.env.MESSAGING_TRANSPORT = 'puresms';
    process.env.PURESMS_API_KEY = 'test-key';
    process.env.PURESMS_SENDER = '+447700900100';
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    const result = await sendText(SEND_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('fetch failed');
    }
  });

  it('treats a slow response past 10s as retryable', async () => {
    vi.useFakeTimers();
    process.env.MESSAGING_TRANSPORT = 'puresms';
    process.env.PURESMS_API_KEY = 'test-key';
    process.env.PURESMS_SENDER = '+447700900100';

    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort);
      });
    });

    const promise = sendText(SEND_INPUT);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
    }
  });

  it('returns not configured when puresms is selected without keys', async () => {
    process.env.MESSAGING_TRANSPORT = 'puresms';
    delete process.env.PURESMS_API_KEY;
    delete process.env.PURESMS_SENDER;
    const result = await sendText(SEND_INPUT);
    expect(result).toEqual({
      ok: false,
      provider: 'puresms',
      error: 'PureSMS is not configured',
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('verifyPureSmsSignature', () => {
  const rawBody = '{"id":"evt_1"}';
  const now = new Date('2026-01-15T12:00:00.000Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));

  it('accepts a correct signature', () => {
    const signature = sign(rawBody, timestamp);
    expect(
      verifyPureSmsSignature({
        rawBody,
        signature,
        timestamp,
        secret: SECRET,
        now,
      }),
    ).toBe(true);
  });

  it('rejects a signature with one flipped character', () => {
    const signature = sign(rawBody, timestamp);
    const flipped =
      signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(
      verifyPureSmsSignature({
        rawBody,
        signature: flipped,
        timestamp,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it('rejects a timestamp 6 minutes old', () => {
    const oldTs = String(Math.floor(now.getTime() / 1000) - 6 * 60);
    const signature = sign(rawBody, oldTs);
    expect(
      verifyPureSmsSignature({
        rawBody,
        signature,
        timestamp: oldTs,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it('rejects missing headers', () => {
    const signature = sign(rawBody, timestamp);
    expect(
      verifyPureSmsSignature({
        rawBody,
        signature: null,
        timestamp,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
    expect(
      verifyPureSmsSignature({
        rawBody,
        signature,
        timestamp: null,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it('rejects a different-length signature without throwing', () => {
    expect(() =>
      verifyPureSmsSignature({
        rawBody,
        signature: 'short',
        timestamp,
        secret: SECRET,
        now,
      }),
    ).not.toThrow();
    expect(
      verifyPureSmsSignature({
        rawBody,
        signature: 'short',
        timestamp,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });
});

describe('parsePureSmsEvent', () => {
  it('maps every field on a delivery receipt', () => {
    expect(parsePureSmsEvent(DELIVERY_RECEIPT_JSON)).toEqual({
      kind: 'delivery',
      eventId: 'e278ad16-1111-4111-8111-111111111111',
      providerMessageId: '362974462422827008',
      clientReference: '241415ce-3570-4db7-a194-edac017acdb6',
      status: 'delivered',
      rawStatus: 'Delivered',
      errorCode: null,
      segments: 1,
      at: '2026-09-28T12:00:05Z',
    });
  });

  it('maps every field on an inbound message and normalises the sender', () => {
    const parsed = parsePureSmsEvent(INBOUND_JSON);
    expect(parsed).toEqual({
      kind: 'inbound',
      eventId: '057f6c05-2222-4222-8222-222222222222',
      providerMessageId: '362974480185692160',
      from: '+447700900003',
      to: 'WorkWise',
      body: 'Reply from the simulator: got "…"',
      receivedAt: '2026-09-28T12:01:00Z',
    });
    if (parsed.kind === 'inbound') {
      expect(parsed.from).toBe('+447700900003');
      expect(parsed.body).toBe('Reply from the simulator: got "…"');
    }
  });

  it('still accepts the doc camelCase field names', () => {
    const camel = JSON.stringify({
      id: 'evt_abc123',
      eventType: 1,
      data: {
        messageId: '362902582244425728',
        clientReference: 'msg-uuid-1',
        deliveryStatus: 'Delivered',
        errorCode: null,
        processedAt: '2026-01-15T10:30:01Z',
        deliveredAt: '2026-01-15T10:30:05Z',
        smsParts: 1,
      },
    });
    expect(parsePureSmsEvent(camel)).toMatchObject({
      kind: 'delivery',
      status: 'delivered',
      providerMessageId: '362902582244425728',
      clientReference: 'msg-uuid-1',
      rawStatus: 'Delivered',
    });
  });

  it('maps Failed delivery statuses and ignores other event types', () => {
    const failed = JSON.parse(DELIVERY_RECEIPT_JSON) as {
      data: { DeliveryStatusStr: string; ErrorCode: string | null };
    };
    failed.data.DeliveryStatusStr = 'Expired';
    failed.data.ErrorCode = 'E1';
    expect(parsePureSmsEvent(JSON.stringify(failed)).kind).toBe('delivery');
    const parsed = parsePureSmsEvent(JSON.stringify(failed));
    if (parsed.kind === 'delivery') {
      expect(parsed.status).toBe('failed');
      expect(parsed.rawStatus).toBe('Expired');
      expect(parsed.errorCode).toBe('E1');
    }

    expect(
      parsePureSmsEvent(
        JSON.stringify({
          id: 'evt_x',
          eventType: 99,
          data: {},
        }),
      ),
    ).toEqual({
      kind: 'ignored',
      eventId: 'evt_x',
      reason: 'unsupported_eventType_99',
    });
  });
});

describe('parseWebhook', () => {
  const prevSecret = process.env.PURESMS_WEBHOOK_SECRET;

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.PURESMS_WEBHOOK_SECRET;
    else process.env.PURESMS_WEBHOOK_SECRET = prevSecret;
  });

  it('returns null on a bad signature and parses when valid (including in log mode)', () => {
    process.env.PURESMS_WEBHOOK_SECRET = SECRET;
    delete process.env.MESSAGING_TRANSPORT; // log mode
    const now = new Date('2026-01-15T12:00:00.000Z');
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const badHeaders = new Headers({
      'X-Webhook-Signature': 'nope',
      'X-Webhook-Timestamp': timestamp,
    });
    expect(parseWebhook(DELIVERY_RECEIPT_JSON, badHeaders, now)).toBeNull();

    const signature = sign(DELIVERY_RECEIPT_JSON, timestamp);
    const goodHeaders = new Headers({
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp,
    });
    const event = parseWebhook(DELIVERY_RECEIPT_JSON, goodHeaders, now);
    expect(event?.kind).toBe('delivery');
  });
});
