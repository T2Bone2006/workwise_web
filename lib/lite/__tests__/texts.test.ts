import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countSegments } from '@/lib/messaging/gsm';
import type { WidgetRow } from '@/lib/widget/guard';

type Rec = Record<string, unknown>;

const harness = vi.hoisted(() => {
  const state = {
    texts: [] as Rec[],
    leads: [] as Rec[],
    widgets: [] as Rec[],
    optOuts: [] as Rec[],
    refunds: [] as Rec[],
    creditCalls: 0,
    creditFrom: 'allowance' as unknown,
    creditError: false,
    loseClaim: false,
    throwOnLeadSelect: false,
    optOutError: false,
    emailError: false,
    sendRefuse: false,
    emails: [] as Rec[],
    subs: [{ tenant_id: 'tenant-1', product: 'lite', status: 'active' }] as Rec[],
    subsError: false,
  };

  const sendText = vi.fn(async (input: Rec) => {
    if (state.sendRefuse) {
      return { ok: false, provider: 'log' as const, error: 'rejected by carrier', retryable: false };
    }
    return { ok: true, provider: 'log' as const, providerMessageId: 'log-1', segments: 1, ...input };
  });

  const sendEmail = vi.fn(async (input: Rec) => {
    state.emails.push(input);
    if (state.emailError) return { error: { name: 'ResendError' } };
    return { error: null };
  });

  function rowsFor(table: string): Rec[] {
    if (table === 'lite_texts') return state.texts;
    if (table === 'leads') return state.leads;
    if (table === 'widget_clients') return state.widgets;
    if (table === 'messaging_opt_outs') return state.optOuts;
    if (table === 'subscriptions') return state.subs;
    return [];
  }

  function builder(table: string) {
    const filters: Array<(row: Rec) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let patch: Rec | null = null;
    let incoming: Rec | null = null;
    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    function execute(single: boolean) {
      if (mode === 'select' && table === 'leads' && state.throwOnLeadSelect) {
        throw new TypeError('lead read failed');
      }
      if (mode === 'select' && table === 'messaging_opt_outs' && state.optOutError) {
        return { data: null, error: { message: 'down' } };
      }
      if (mode === 'select' && table === 'subscriptions' && state.subsError) {
        return { data: null, error: { message: 'down' } };
      }
      if (mode === 'insert') {
        const row = { ...(incoming ?? {}) };
        if (table === 'lite_texts') {
          const clash = state.texts.some(
            (existing) => existing.dedupe_key && existing.dedupe_key === row.dedupe_key && existing.tenant_id === row.tenant_id,
          );
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate' } };
          row.id = row.id ?? `text-${state.texts.length + 1}`;
          state.texts.push(row);
        }
        return { data: single ? row : [row], error: null };
      }
      const hit = rowsFor(table).filter((row) => filters.every((pred) => pred(row)));
      if (mode === 'update') {
        if (state.loseClaim && patch?.status === 'sending') return { data: [], error: null };
        for (const row of hit) Object.assign(row, patch);
      }
      let list = hit.map((row) => ({ ...row }));
      if (orderKey) {
        const key = orderKey;
        list = [...list].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')));
        if (!orderAsc) list.reverse();
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
      lte: (key: string, value: unknown) => {
        filters.push((row) => String(row[key] ?? '') <= String(value));
        return api;
      },
      in: (key: string, values: unknown[]) => {
        const allowed = new Set(values);
        filters.push((row) => allowed.has(row[key]));
        return api;
      },
      lt: (key: string, value: unknown) => {
        filters.push((row) => String(row[key] ?? '') < String(value));
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

  const admin = {
    from(table: string) {
      return builder(table);
    },
    async rpc(name: string, args: Rec) {
      if (name === 'refund_text_credits') {
        state.refunds.push(args);
        return { data: null, error: null };
      }
      if (name === 'claim_text_credits') {
        state.creditCalls += 1;
        if (state.creditError) return { data: null, error: { message: 'down' } };
        return { data: state.creditFrom, error: null };
      }
      return { data: null, error: { message: name } };
    },
  } as unknown as SupabaseClient;

  return { state, admin, sendText, sendEmail };
});

vi.mock('@/lib/messaging/provider', () => ({
  sendText: (...args: unknown[]) => harness.sendText(...(args as [Rec])),
  activeProvider: () => 'log',
  ourNumber: () => null,
}));

vi.mock('@/lib/resend', () => ({
  FROM_EMAIL: 'noreply@joinworkwise.com',
  resend: { emails: { send: (...args: unknown[]) => harness.sendEmail(...(args as [Rec])) } },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    constructor() {}
    messages = { parse: () => Promise.reject(new Error('no ai')) };
  },
}));

vi.mock('@/lib/services/ai-interaction-log', () => ({
  logStructuredAiInteraction: async () => {},
}));

import { onBookingDecided, onLeadCreated, type LeadRow } from '@/lib/lite/lead-events';
import { buildTextContext, failStuckLeadTexts, scheduleLeadText, sendDueLeadTexts } from '@/lib/lite/texts';

const widget = {
  id: 'widget-1',
  tenant_id: 'tenant-1',
  business_name: "Dave's Plastering",
  trade: 'plastering',
  service_area: 'South Manchester',
  business_context: '',
  greeting: 'Hi',
  primary_colour: '#0C66E4',
  allowed_domains: ['daveplastering.co.uk'],
  owner_mobile_e164: '+447700900999',
  sign_off_name: 'Dave',
  follow_up_enabled: true,
  text_me_too: false,
  notification_email: 'dave@example.com',
} as WidgetRow;

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1',
    tenant_id: 'tenant-1',
    source: 'widget',
    name: 'Sarah Jones',
    phone: '07700 900456',
    email: 'sarah@example.com',
    job_description: 'Patch a wall',
    quote_given: '£85',
    status: 'new',
    notes: null,
    widget_conversation_id: 'conv-1',
    source_data: {},
    converted_customer_id: null,
    converted_job_id: null,
    created_at: null,
    updated_at: null,
    client_id: 'widget-1',
    phone_e164: '+447700900456',
    postcode: 'M20 6AB',
    preferred_days: ['mon'],
    customer_note: null,
    job_summary: 'Patch a wall',
    job_type_key: 'patch',
    quote_kind: 'firm',
    quote_amount: 85,
    quote_min: null,
    quote_max: null,
    booking_status: 'requested',
    agreed_amount: null,
    decided_at: null,
    decided_by: null,
    booked_for_date: null,
    booked_for_time: null,
    status_changed_at: null,
    follow_up_problem: null,
    ...overrides,
  };
}

const sendAt = new Date('2026-06-15T13:00:00.000Z');

function remember(row: LeadRow) {
  harness.state.leads.push({ ...row });
  return row;
}

async function scheduleFollowUp(row: LeadRow, dedupe = `follow_up:${row.id}`) {
  return scheduleLeadText(harness.admin, {
    tenantId: row.tenant_id,
    leadId: row.id,
    kind: 'follow_up',
    to: row.phone_e164,
    context: buildTextContext(row, widget, 'follow_up'),
    dedupeKey: dedupe,
    now: new Date('2026-06-15T12:00:00.000Z'),
  });
}

describe('lead texts', () => {
  beforeEach(() => {
    harness.state.texts.length = 0;
    harness.state.leads.length = 0;
    harness.state.widgets.length = 0;
    harness.state.optOuts.length = 0;
    harness.state.refunds.length = 0;
    harness.state.emails.length = 0;
    harness.state.creditCalls = 0;
    harness.state.creditFrom = 'allowance';
    harness.state.creditError = false;
    harness.state.loseClaim = false;
    harness.state.throwOnLeadSelect = false;
    harness.state.optOutError = false;
    harness.state.emailError = false;
    harness.state.sendRefuse = false;
    harness.state.subs = [{ tenant_id: 'tenant-1', product: 'lite', status: 'active' }];
    harness.state.subsError = false;
    harness.state.widgets.push({ ...widget });
    harness.sendText.mockClear();
    harness.sendEmail.mockClear();
  });

  it('schedules one follow-up, and a second call for the same purpose is a duplicate', async () => {
    const row = remember(lead());
    const first = await scheduleFollowUp(row);
    const second = await scheduleFollowUp(row);
    expect(first.outcome).toBe('scheduled');
    expect(second).toEqual({ outcome: 'duplicate' });
    expect(harness.state.texts).toHaveLength(1);
    expect(harness.state.texts[0]?.dedupe_key).toBe('follow_up:lead-1');
  });

  it('holds a text booked at 22:30 until the next morning', async () => {
    const row = remember(lead());
    await scheduleLeadText(harness.admin, {
      tenantId: row.tenant_id,
      leadId: row.id,
      kind: 'follow_up',
      to: row.phone_e164,
      context: buildTextContext(row, widget, 'follow_up'),
      dedupeKey: 'follow_up:lead-1',
      now: new Date('2026-01-15T22:30:00.000Z'),
    });
    expect(String(harness.state.texts[0]?.send_after)).toMatch(/^2026-01-16T08:0[0-5]:/);
  });

  it('sends a due text through the log provider and marks the row sent', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
    const sent = harness.sendText.mock.calls[0]?.[0] as { to: string; body: string; clientReference: string };
    expect(sent.to).toBe('+447700900456');
    expect(sent.body).toContain('Dave');
    expect(sent.clientReference).toBe(harness.state.texts[0]?.id);
    expect(harness.state.texts[0]).toMatchObject({
      status: 'sent',
      provider: 'log',
      drafted_by: 'template',
      billed_from: 'allowance',
      billed_month: '2026-06',
      provider_message_id: 'log-1',
    });
    expect(harness.state.creditCalls).toBe(1);
  });

  it('skips a follow-up once the booking is already decided', async () => {
    const row = remember(lead({ booking_status: 'accepted', decided_by: 'owner', status: 'won' }));
    await scheduleFollowUp(row);
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(harness.state.texts[0]?.skip_reason).toBe('lead_closed');
    expect(harness.sendText).not.toHaveBeenCalled();
    expect(harness.state.creditCalls).toBe(0);
  });

  it('still sends the accepted text after the lead is accepted', async () => {
    const row = remember(lead({ booking_status: 'accepted', agreed_amount: 85, decided_by: 'owner', status: 'won' }));
    await scheduleLeadText(harness.admin, {
      tenantId: row.tenant_id,
      leadId: row.id,
      kind: 'booking_accepted',
      to: row.phone_e164,
      context: buildTextContext(row, widget, 'booking_accepted'),
      dedupeKey: 'booking_accepted:lead-1',
      now: new Date('2026-06-15T12:00:00.000Z'),
    });
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals.sent).toBe(1);
    expect(String(harness.sendText.mock.calls[0]?.[0] && (harness.sendText.mock.calls[0]?.[0] as { body: string }).body)).toContain(
      '£85',
    );
  });

  it('loses a claim race without sending', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    harness.state.loseClaim = true;
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals).toEqual({ claimed: 0, sent: 0, emailed: 0, skipped: 0, failed: 0 });
    expect(harness.state.texts[0]?.status).toBe('scheduled');
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it('skips a STOP’d number, and treats an opt-out lookup error as opted out', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    harness.state.optOuts.push({ phone_e164: row.phone_e164 });
    const stopped = await sendDueLeadTexts(harness.admin, sendAt);
    expect(stopped.skipped).toBe(1);
    expect(harness.state.texts[0]).toMatchObject({ status: 'skipped', skip_reason: 'opted_out' });
    expect(harness.state.leads[0]?.follow_up_problem).toBe('opted_out');
    expect(harness.sendText).not.toHaveBeenCalled();
    expect(harness.state.creditCalls).toBe(0);

    harness.state.texts.length = 0;
    harness.state.optOuts.length = 0;
    harness.state.optOutError = true;
    await scheduleFollowUp(row, 'follow_up:again');
    const errored = await sendDueLeadTexts(harness.admin, sendAt);
    expect(errored.skipped).toBe(1);
    expect(harness.state.texts.at(-1)?.skip_reason).toBe('opted_out');
  });

  it('emails the same words when the business is out of texts, or skips when there is no email', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    harness.state.creditFrom = 'none';
    const emailed = await sendDueLeadTexts(harness.admin, sendAt);
    expect(emailed).toMatchObject({ emailed: 1, sent: 0 });
    expect(harness.state.texts[0]?.status).toBe('emailed');
    expect(harness.state.emails[0]).toMatchObject({
      from: 'noreply@joinworkwise.com',
      to: 'sarah@example.com',
      subject: "Dave's Plastering: your enquiry",
    });
    expect(harness.sendText).not.toHaveBeenCalled();
    expect(harness.state.leads[0]?.follow_up_problem).toBeNull();

    harness.state.texts.length = 0;
    harness.state.emails.length = 0;
    harness.state.leads[0]!.email = null;
    await scheduleFollowUp(row, 'follow_up:no-email');
    const skipped = await sendDueLeadTexts(harness.admin, sendAt);
    expect(skipped.skipped).toBe(1);
    expect(harness.state.texts.at(-1)).toMatchObject({ status: 'skipped', skip_reason: 'no_texts_left' });
    expect(harness.state.leads[0]?.follow_up_problem).toBe('out_of_texts');
  });

  it('refunds when the provider refuses, and marks a throw after the claim as failed', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    harness.state.sendRefuse = true;
    const refused = await sendDueLeadTexts(harness.admin, sendAt);
    expect(refused).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(harness.state.texts[0]).toMatchObject({ status: 'failed', error: 'rejected by carrier' });
    expect(harness.state.leads[0]?.follow_up_problem).toBe('failed');
    const body = (harness.sendText.mock.calls[0]?.[0] as { body: string }).body;
    expect(harness.state.refunds[0]).toMatchObject({
      p_tenant_id: 'tenant-1',
      p_segments: countSegments(body).segments,
      p_from: 'allowance',
      p_month: '2026-06',
    });

    harness.state.texts.length = 0;
    harness.state.refunds.length = 0;
    harness.state.sendRefuse = false;
    harness.state.throwOnLeadSelect = true;
    await scheduleFollowUp(row, 'follow_up:throw');
    const thrown = await sendDueLeadTexts(harness.admin, sendAt);
    expect(thrown).toMatchObject({ claimed: 1, failed: 1 });
    expect(harness.state.texts.at(-1)).toMatchObject({ status: 'failed', error: 'TypeError' });
    expect(harness.state.refunds).toHaveLength(0);
    expect(harness.sendText).toHaveBeenCalledTimes(1);
  });

  it('fails the row when the credit claim errors, and when the lead is gone', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    harness.state.creditError = true;
    const credits = await sendDueLeadTexts(harness.admin, sendAt);
    expect(credits).toMatchObject({ claimed: 1, failed: 1 });
    expect(harness.state.texts[0]).toMatchObject({ status: 'failed', error: 'credits' });
    expect(harness.sendText).not.toHaveBeenCalled();

    harness.state.texts.length = 0;
    harness.state.leads.length = 0;
    harness.state.creditError = false;
    await scheduleFollowUp(row, 'follow_up:gone');
    const gone = await sendDueLeadTexts(harness.admin, sendAt);
    expect(gone.failed).toBe(1);
    expect(harness.state.texts.at(-1)).toMatchObject({ status: 'failed', error: 'lead gone' });
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it('skips a follow-up when Text customers for me is switched off', async () => {
    const row = remember(lead());
    await scheduleFollowUp(row);
    harness.state.widgets[0]!.follow_up_enabled = false;
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals.skipped).toBe(1);
    expect(harness.state.texts[0]?.skip_reason).toBe('follow_ups_off');
    expect(harness.sendText).not.toHaveBeenCalled();
    expect(harness.state.creditCalls).toBe(0);
  });

  it('fails a text stuck in sending and never sends it again', async () => {
    const row = remember(lead());
    const old = new Date(sendAt.getTime() - 11 * 60 * 1000).toISOString();
    const recent = new Date(sendAt.getTime() - 5 * 60 * 1000).toISOString();
    harness.state.texts.push(
      {
        id: 'stuck-1',
        tenant_id: row.tenant_id,
        lead_id: row.id,
        kind: 'follow_up',
        status: 'sending',
        claimed_at: old,
        to_address: row.phone_e164,
      },
      {
        id: 'fresh-1',
        tenant_id: row.tenant_id,
        lead_id: row.id,
        kind: 'follow_up',
        status: 'sending',
        claimed_at: recent,
        to_address: row.phone_e164,
      },
    );
    expect(await failStuckLeadTexts(harness.admin, sendAt)).toBe(1);
    expect(harness.state.texts.find((text) => text.id === 'stuck-1')).toMatchObject({ status: 'failed', error: 'stuck' });
    expect(harness.state.texts.find((text) => text.id === 'fresh-1')?.status).toBe('sending');
    expect(harness.state.leads[0]?.follow_up_problem).toBe('stuck');
    expect(await failStuckLeadTexts(harness.admin, sendAt)).toBe(0);
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it('does not schedule a follow-up for an auto-accepted lead, and does for everyone else', async () => {
    await onLeadCreated(harness.admin, lead({ booking_status: 'accepted', decided_by: 'auto', status: 'won' }));
    expect(harness.state.texts).toHaveLength(0);

    await onLeadCreated(harness.admin, lead());
    expect(harness.state.texts).toHaveLength(1);
    expect(harness.state.texts[0]).toMatchObject({
      kind: 'follow_up',
      dedupe_key: 'follow_up:lead-1',
      status: 'scheduled',
      to_address: '+447700900456',
    });

    harness.state.texts.length = 0;
    await onLeadCreated(harness.admin, lead({ phone_e164: null }));
    expect(harness.state.texts).toHaveLength(0);
  });

  it('schedules the accepted or declined text from the decision', async () => {
    const accepted = lead({ booking_status: 'accepted', agreed_amount: 90, decided_by: 'owner', status: 'won' });
    await onBookingDecided(harness.admin, accepted, { decision: 'accepted', tellCustomer: true, priceChanged: true });
    expect(harness.state.texts).toHaveLength(1);
    expect(harness.state.texts[0]).toMatchObject({ kind: 'booking_accepted', dedupe_key: 'booking_accepted:lead-1' });
    expect(harness.state.texts[0]?.context).toMatchObject({ price_changed: true, allowed_amounts: [90] });

    await onBookingDecided(harness.admin, lead({ id: 'lead-2', booking_status: 'declined' }), {
      decision: 'declined',
      tellCustomer: false,
      priceChanged: false,
    });
    expect(harness.state.texts).toHaveLength(1);

    await onBookingDecided(harness.admin, lead({ id: 'lead-3', booking_status: 'declined' }), {
      decision: 'declined',
      tellCustomer: true,
      priceChanged: false,
    });
    expect(harness.state.texts.at(-1)).toMatchObject({
      kind: 'booking_declined',
      dedupe_key: 'booking_declined:lead-3',
    });
  });

  it('skips a due text when the business has no entitled Lite plan', async () => {
    harness.state.subs = [];
    const row = remember(lead());
    await scheduleFollowUp(row);
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals).toMatchObject({ claimed: 0, sent: 0, skipped: 1 });
    expect(harness.state.texts[0]).toMatchObject({ status: 'skipped', skip_reason: 'plan_ended' });
    expect(harness.sendText).not.toHaveBeenCalled();
    expect(harness.state.creditCalls).toBe(0);
  });

  it('sends nothing when the Lite plan check fails', async () => {
    harness.state.subsError = true;
    const row = remember(lead());
    await scheduleFollowUp(row);
    const totals = await sendDueLeadTexts(harness.admin, sendAt);
    expect(totals).toMatchObject({ claimed: 0, sent: 0, skipped: 0, failed: 0 });
    expect(harness.state.texts[0]?.status).toBe('scheduled');
    expect(harness.sendText).not.toHaveBeenCalled();
  });
});
