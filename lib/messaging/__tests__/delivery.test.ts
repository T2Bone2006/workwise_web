import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryEvent } from '@/lib/messaging/provider';

const {
  parseWebhook,
  activeProvider,
  createAdminClient,
  sendEmailFallbackForMessage,
} = vi.hoisted(() => ({
  parseWebhook: vi.fn(),
  activeProvider: vi.fn(() => 'log' as const),
  createAdminClient: vi.fn(),
  sendEmailFallbackForMessage: vi.fn(),
}));

vi.mock('@/lib/messaging/provider', () => ({
  parseWebhook: (...args: unknown[]) => parseWebhook(...args),
  activeProvider: () => activeProvider(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClient(),
}));

vi.mock('@/lib/messaging/email-fallback', () => ({
  sendEmailFallbackForMessage: (...args: unknown[]) =>
    sendEmailFallbackForMessage(...args),
}));

import { POST } from '@/app/api/messaging/webhook/route';
import { handleDeliveryEvent } from '@/lib/messaging/delivery';

type Row = {
  id: string;
  provider: string;
  provider_message_id: string | null;
  status: string;
  kind: string;
  email_fallback_at: string | null;
  segments: number | null;
  delivered_at?: string | null;
  provider_status?: string | null;
  error?: string | null;
};

let row: Row | null;
let updates: Record<string, unknown>[];
let fakeAdmin: { from: (table: string) => unknown };

function matches(filters: { col: string; val: unknown }[]): boolean {
  if (!row) return false;
  return filters.every(
    (f) => (row as Record<string, unknown>)[f.col] === f.val,
  );
}

function buildFakeAdmin() {
  return {
    from(table: string) {
      if (table !== 'messages') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          const filters: { col: string; val: unknown }[] = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push({ col, val });
              return api;
            },
            maybeSingle() {
              if (!matches(filters) || !row) {
                return Promise.resolve({ data: null, error: null });
              }
              return Promise.resolve({ data: { ...row }, error: null });
            },
          };
          return api;
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              if (row && (row as Record<string, unknown>)[col] === val) {
                updates.push(payload);
                Object.assign(row, payload);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

function sentRow(overrides: Partial<Row> = {}): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'log',
    provider_message_id: 'sms_1',
    status: 'sent',
    kind: 'visit_change',
    email_fallback_at: null,
    segments: 1,
    ...overrides,
  };
}

function deliveryEvent(overrides: Partial<DeliveryEvent> = {}): DeliveryEvent {
  return {
    kind: 'delivery',
    eventId: 'evt_1',
    providerMessageId: 'sms_1',
    clientReference: null,
    status: 'delivered',
    rawStatus: 'Delivered',
    errorCode: null,
    segments: 1,
    at: '2026-09-28T11:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  row = null;
  updates = [];
  fakeAdmin = buildFakeAdmin();
  parseWebhook.mockReset();
  activeProvider.mockReset();
  activeProvider.mockReturnValue('log');
  createAdminClient.mockReset();
  createAdminClient.mockImplementation(() => fakeAdmin);
  sendEmailFallbackForMessage.mockReset();
});

describe('handleDeliveryEvent', () => {
  it('marks a sent text delivered and sets delivered_at', async () => {
    row = sentRow();
    const at = '2026-09-28T11:00:00.000Z';

    const result = await handleDeliveryEvent(deliveryEvent({ at }));

    expect(result).toEqual({ outcome: 'updated' });
    expect(row.status).toBe('delivered');
    expect(row.delivered_at).toBe(at);
    expect(row.provider_status).toBe('Delivered');
    expect(row.segments).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('ignores a second delivered report', async () => {
    row = sentRow({
      status: 'delivered',
      delivered_at: '2026-09-28T11:00:00.000Z',
    });

    const result = await handleDeliveryEvent(deliveryEvent());

    expect(result).toEqual({ outcome: 'already_final' });
    expect(updates).toEqual([]);
  });

  it('emails once when a visit_change text fails, and ignores the retry', async () => {
    row = sentRow({ kind: 'visit_change' });
    sendEmailFallbackForMessage.mockResolvedValue({ sent: true });
    const event = deliveryEvent({
      status: 'failed',
      rawStatus: 'Failed',
      errorCode: '27',
      at: null,
    });

    const first = await handleDeliveryEvent(event);

    expect(first).toEqual({ outcome: 'fallback_sent' });
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Not delivered: Failed, code 27');
    expect(sendEmailFallbackForMessage).toHaveBeenCalledTimes(1);
    expect(sendEmailFallbackForMessage).toHaveBeenCalledWith(fakeAdmin, row.id);

    const second = await handleDeliveryEvent(event);

    expect(second).toEqual({ outcome: 'already_final' });
    expect(sendEmailFallbackForMessage).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
  });

  it('marks a reminder failed and does not email', async () => {
    row = sentRow({ kind: 'reminder' });
    const event = deliveryEvent({
      status: 'failed',
      rawStatus: 'Expired',
      errorCode: null,
    });

    const result = await handleDeliveryEvent(event);

    expect(result).toEqual({ outcome: 'fallback_skipped' });
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Not delivered: Expired');
    expect(sendEmailFallbackForMessage).not.toHaveBeenCalled();
  });

  it('finds the message by clientReference when the provider id does not match', async () => {
    row = sentRow({ provider_message_id: 'stored-at-send' });

    const result = await handleDeliveryEvent(
      deliveryEvent({
        providerMessageId: '362974462422827008',
        clientReference: row.id,
      }),
    );

    expect(result).toEqual({ outcome: 'updated' });
    expect(row.status).toBe('delivered');
  });

  it('returns not_found when the id is unknown and clientReference is not a uuid', async () => {
    row = sentRow({ provider_message_id: 'sms_other' });

    const result = await handleDeliveryEvent(
      deliveryEvent({
        providerMessageId: 'sms_missing',
        clientReference: 'not-a-uuid',
      }),
    );

    expect(result).toEqual({ outcome: 'not_found' });
    expect(updates).toEqual([]);
    expect(sendEmailFallbackForMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/messaging/webhook', () => {
  it('returns 401 for a bad signature and does not touch the database', async () => {
    parseWebhook.mockReturnValue(null);
    row = sentRow();

    const response = await POST(
      new Request('http://localhost/api/messaging/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(parseWebhook).toHaveBeenCalledTimes(1);
    expect(parseWebhook.mock.calls[0][0]).toBe('{}');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
