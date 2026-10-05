import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackText, type TextContext } from '@/lib/lite/text-templates';
import { countSegments } from '@/lib/messaging/gsm';

type Rec = Record<string, unknown>;

const harness = vi.hoisted(() => {
  const state = {
    texts: [] as Rec[],
    leads: [] as Rec[],
    widgets: [] as Rec[],
    textError: false,
    nextId: 1,
  };
  const sendEmail = vi.fn(async (_input: Rec) => {
    void _input;
    return { data: { id: 'email-1' }, error: null };
  });
  return { state, sendEmail };
});

vi.mock('@/lib/resend', () => ({
  FROM_EMAIL: 'WorkWise <hello@joinworkwise.com>',
  resend: { emails: { send: (input: Rec) => harness.sendEmail(input) } },
}));

import { handleLeadReply } from '@/lib/lite/lead-replies';

const FROM = '+447700900123';
const OWNER = '+447700900999';
const AT = new Date('2026-06-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function rowsFor(table: string): Rec[] {
  if (table === 'lite_texts') return harness.state.texts;
  if (table === 'leads') return harness.state.leads;
  if (table === 'widget_clients') return harness.state.widgets;
  return [];
}

function builder(table: string) {
  const filters: Array<(row: Rec) => boolean> = [];
  let mode: 'select' | 'insert' = 'select';
  let incoming: Rec | null = null;
  let orderKey: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;

  function execute(single: boolean) {
    const rows = rowsFor(table);
    if (table === 'lite_texts' && harness.state.textError && mode === 'select') {
      return { data: null, error: { message: 'down' } };
    }
    if (mode === 'insert') {
      const key = incoming?.provider_message_id;
      if (typeof key === 'string' && key !== '' && rows.some((row) => row.provider_message_id === key)) {
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      const stored = {
        id: `text-${harness.state.nextId++}`,
        created_at: AT.toISOString(),
        ...(incoming ?? {}),
      };
      rows.push(stored);
      return { data: single ? { id: stored.id } : stored, error: null };
    }
    let hit = rows.filter((row) => filters.every((pred) => pred(row)));
    if (orderKey) {
      const key = orderKey;
      hit = [...hit].sort((a, b) => {
        const av = String(a[key] ?? '');
        const bv = String(b[key] ?? '');
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return orderAsc ? cmp : -cmp;
      });
    }
    if (limitN != null) hit = hit.slice(0, limitN);
    const copies = hit.map((row) => ({ ...row }));
    return { data: single ? (copies[0] ?? null) : copies, error: null };
  }

  const api = {
    select: () => api,
    eq: (key: string, value: unknown) => {
      filters.push((row) => row[key] === value);
      return api;
    },
    in: (key: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[key]));
      return api;
    },
    gte: (key: string, value: unknown) => {
      filters.push((row) => String(row[key] ?? '') >= String(value));
      return api;
    },
    order: (key: string, opts?: { ascending?: boolean }) => {
      orderKey = key;
      orderAsc = opts?.ascending !== false;
      return api;
    },
    limit: (n: number) => {
      limitN = n;
      return api;
    },
    insert: (row: Rec) => {
      mode = 'insert';
      incoming = row;
      return api;
    },
    maybeSingle: async () => execute(true),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute(false)).then(resolve, reject),
  };
  return api;
}

const admin = { from: (table: string) => builder(table) } as unknown as SupabaseClient;

function outbound(overrides: Rec = {}): Rec {
  return {
    id: 'out-1',
    tenant_id: 'tenant-1',
    lead_id: 'lead-1',
    kind: 'follow_up',
    direction: 'outbound',
    to_address: FROM,
    status: 'sent',
    created_at: new Date(AT.getTime() - 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function seedPeople(overrides: { textMe?: boolean; ownerMobile?: string | null } = {}) {
  harness.state.leads.push({
    id: 'lead-1',
    tenant_id: 'tenant-1',
    name: 'Sarah Jones',
    phone: '07700 900123',
    phone_e164: FROM,
    client_id: 'widget-1',
    job_summary: 'Patch a wall',
    quote_kind: 'firm',
    quote_amount: 85,
    booking_status: 'requested',
    preferred_days: ['thu'],
    decided_by: null,
  });
  harness.state.widgets.push({
    id: 'widget-1',
    tenant_id: 'tenant-1',
    business_name: "Dave's Plastering",
    trade: 'plastering',
    sign_off_name: 'Dave',
    follow_up_enabled: true,
    text_me_too: overrides.textMe ?? false,
    owner_mobile_e164: overrides.ownerMobile === undefined ? OWNER : overrides.ownerMobile,
    notification_email: 'dave@example.com',
  });
}

function replyRows(): Rec[] {
  return harness.state.texts.filter((row) => row.kind === 'reply_in');
}

describe('handleLeadReply', () => {
  beforeEach(() => {
    harness.state.texts.length = 0;
    harness.state.leads.length = 0;
    harness.state.widgets.length = 0;
    harness.state.textError = false;
    harness.state.nextId = 1;
    harness.sendEmail.mockClear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.joinworkwise.com';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('stores a reply from the last 30 days, emails the tradie, and does not answer the customer', async () => {
    harness.state.texts.push(outbound());
    seedPeople({ textMe: true });
    const result = await handleLeadReply(admin, {
      from: FROM,
      body: "Thursday's good",
      providerMessageId: 'sms-1',
      keyword: null,
      at: AT,
    });
    expect(result).toEqual({ handled: true, duplicate: false });
    expect(replyRows()).toHaveLength(1);
    expect(replyRows()[0]).toMatchObject({
      tenant_id: 'tenant-1',
      lead_id: 'lead-1',
      kind: 'reply_in',
      direction: 'inbound',
      from_address: FROM,
      body: "Thursday's good",
      status: 'received',
      provider_message_id: 'sms-1',
    });
    expect(harness.sendEmail).toHaveBeenCalledTimes(1);
    const email = harness.sendEmail.mock.calls[0]?.[0] as unknown as {
      subject: string;
      html: string;
      text: string;
    };
    expect(email.subject).toBe('Sarah replied to your text');
    expect(email.html).toContain('Sarah Jones replied:');
    expect(email.html).toContain("Thursday&#39;s good");
    expect(email.html).toContain('tel:07700900123');
    expect(email.html).toContain('sms:07700900123');
    expect(email.html).toContain('https://app.joinworkwise.com/lite/leads/lead-1');
    expect(email.html).toContain('See the lead');
    expect(email.text).not.toContain("isn't read");
    const alert = harness.state.texts.find((row) => row.kind === 'owner_alert');
    expect(alert).toMatchObject({
      direction: 'outbound',
      to_address: OWNER,
      dedupe_key: 'owner_alert:reply:text-1',
    });
    const context = alert?.context as { reply_text?: string; customer_mobile_display?: string };
    expect(context.reply_text).toBe("Thursday's good");
    expect(context.customer_mobile_display).toBe('07700 900123');
  });

  it('keeps only the first 100 characters of the reply in the owner text', async () => {
    harness.state.texts.push(outbound());
    seedPeople({ textMe: true });
    const body = 'a'.repeat(120);
    await handleLeadReply(admin, {
      from: FROM,
      body,
      providerMessageId: 'sms-long',
      keyword: null,
      at: AT,
    });
    const alert = harness.state.texts.find((row) => row.kind === 'owner_alert');
    expect((alert?.context as { reply_text?: string }).reply_text).toBe('a'.repeat(100));
    expect(replyRows()[0]?.body).toBe(body);
  });

  it('treats a reply 31 days later as not a lead reply', async () => {
    harness.state.texts.push(
      outbound({ created_at: new Date(AT.getTime() - 31 * DAY_MS).toISOString() }),
    );
    seedPeople();
    const result = await handleLeadReply(admin, {
      from: FROM,
      body: 'Hello?',
      providerMessageId: 'sms-old',
      keyword: null,
      at: AT,
    });
    expect(result).toEqual({ handled: false });
    expect(replyRows()).toHaveLength(0);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('still matches a text sent exactly 30 days ago', async () => {
    harness.state.texts.push(
      outbound({ created_at: new Date(AT.getTime() - 30 * DAY_MS).toISOString() }),
    );
    seedPeople();
    const result = await handleLeadReply(admin, {
      from: FROM,
      body: 'Still here',
      providerMessageId: 'sms-30',
      keyword: null,
      at: AT,
    });
    expect(result).toEqual({ handled: true, duplicate: false });
  });

  it('uses the latest customer text when there are two', async () => {
    harness.state.texts.push(
      outbound({ id: 'old', lead_id: 'lead-old', created_at: new Date(AT.getTime() - 2 * DAY_MS).toISOString() }),
      outbound({ id: 'new', lead_id: 'lead-1', created_at: new Date(AT.getTime() - 60 * 1000).toISOString() }),
    );
    seedPeople();
    await handleLeadReply(admin, {
      from: FROM,
      body: 'The new one',
      providerMessageId: 'sms-new',
      keyword: null,
      at: AT,
    });
    expect(replyRows()[0]).toMatchObject({ lead_id: 'lead-1' });
  });

  it('ignores a reply from the tradie to their own alert', async () => {
    harness.state.texts.push(outbound({ kind: 'owner_alert', to_address: OWNER }));
    seedPeople();
    const result = await handleLeadReply(admin, {
      from: OWNER,
      body: 'Reply to my own alert',
      providerMessageId: 'sms-owner',
      keyword: null,
      at: AT,
    });
    expect(result).toEqual({ handled: false });
    expect(replyRows()).toHaveLength(0);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('ignores an emailed follow-up, which had no text to reply to', async () => {
    harness.state.texts.push(outbound({ to_address: FROM, status: 'emailed' }));
    seedPeople();
    const result = await handleLeadReply(admin, {
      from: FROM,
      body: 'Hello?',
      providerMessageId: 'sms-emailed',
      keyword: null,
      at: AT,
    });
    expect(result).toEqual({ handled: false });
    expect(replyRows()).toHaveLength(0);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('emails that they opted out and does not text the tradie', async () => {
    harness.state.texts.push(outbound());
    seedPeople({ textMe: true });
    const result = await handleLeadReply(admin, {
      from: FROM,
      body: 'STOP',
      providerMessageId: 'sms-stop',
      keyword: 'opt_out',
      at: AT,
    });
    expect(result).toEqual({ handled: true, duplicate: false });
    const email = harness.sendEmail.mock.calls[0]?.[0] as unknown as { subject: string; text: string };
    expect(email.subject).toBe('Sarah asked not to get texts');
    expect(email.text).toContain("WorkWise won't text them again. You can still ring them.");
    expect(harness.state.texts.some((row) => row.kind === 'owner_alert')).toBe(false);
  });

  it('stores one row and sends one email when the webhook is delivered twice', async () => {
    harness.state.texts.push(outbound());
    seedPeople({ textMe: true });
    const input = {
      from: FROM,
      body: "Thursday's good",
      providerMessageId: 'sms-1',
      keyword: null,
      at: AT,
    };
    expect(await handleLeadReply(admin, input)).toEqual({ handled: true, duplicate: false });
    expect(await handleLeadReply(admin, input)).toEqual({ handled: true, duplicate: true });
    expect(replyRows()).toHaveLength(1);
    expect(harness.sendEmail).toHaveBeenCalledTimes(1);
    expect(harness.state.texts.filter((row) => row.kind === 'owner_alert')).toHaveLength(1);
  });

  it('throws when the match query fails and stores nothing', async () => {
    harness.state.textError = true;
    harness.state.texts.push(outbound());
    await expect(
      handleLeadReply(admin, {
        from: FROM,
        body: 'Hi',
        providerMessageId: 'sms-err',
        keyword: null,
        at: AT,
      }),
    ).rejects.toThrow('Could not match this reply to a lead.');
    expect(replyRows()).toHaveLength(0);
  });
});

describe('owner alert reply wording', () => {
  const base: TextContext = {
    first_name: 'Sarah',
    business_name: "Dave's Plastering",
    sign_off: 'Dave',
    trade: 'plastering',
    owner_mobile_display: '07700 900999',
    job_summary: 'Patch a wall',
    quote_kind: 'firm',
    allowed_amounts: [85],
    booking_requested: true,
    price_changed: false,
    preferred_days: [],
    reply_text: "Thursday's good",
    customer_mobile_display: '07700 900123',
  };

  it('quotes the reply and the customer mobile', () => {
    expect(fallbackText('owner_alert', base)).toBe(
      'Sarah replied: "Thursday\'s good" - reply from your own phone on 07700 900123.',
    );
  });

  it('trims a long reply down to 2 segments, ending with an ellipsis', () => {
    const text = fallbackText('owner_alert', { ...base, reply_text: 'word '.repeat(80) });
    expect(countSegments(text).segments).toBeLessThanOrEqual(2);
    expect(text).toContain('...');
    expect(text).toContain('07700 900123');
    expect(text.startsWith('Sarah replied: "')).toBe(true);
  });
});
