import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetRow } from '@/lib/widget/guard';
import type { WidgetLeadValues } from '@/lib/validations/lite/lead';

type Rec = Record<string, unknown>;

const harness = vi.hoisted(() => {
  const state = {
    leads: [] as Rec[],
    conversations: [] as Rec[],
    profiles: [] as Rec[],
    insertError: false,
  };
  const onLeadCreated = vi.fn(async (..._args: unknown[]) => {});
  const onBookingDecided = vi.fn(async (..._args: unknown[]) => {});

  function matched(rows: Rec[], filters: Array<(row: Rec) => boolean>) {
    return rows.filter((row) => filters.every((pred) => pred(row)));
  }

  function builder(table: string) {
    const rows = table === 'leads' ? state.leads : table === 'widget_conversations' ? state.conversations : state.profiles;
    const filters: Array<(row: Rec) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let patch: Rec | null = null;
    let incoming: Rec | null = null;

    function execute(single: boolean) {
      if (mode === 'insert') {
        if (state.insertError) return { data: null, error: { message: 'boom' } };
        const row = incoming ?? {};
        const clash = rows.some(
          (existing) =>
            existing.widget_conversation_id && existing.widget_conversation_id === row.widget_conversation_id,
        );
        if (clash) return { data: null, error: { code: '23505', message: 'duplicate' } };
        const stored = { id: `lead-${rows.length + 1}`, booking_status: 'none', status: 'new', ...row };
        rows.push(stored);
        return { data: single ? stored : [stored], error: null };
      }
      if (mode === 'update') {
        const hit = matched(rows, filters);
        for (const row of hit) Object.assign(row, patch);
        return { data: hit.map((row) => ({ ...row })), error: null };
      }
      const hit = matched(rows, filters);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    }

    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return api;
      },
      neq: (key: string, value: unknown) => {
        filters.push((row) => row[key] !== value);
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
  } as unknown as SupabaseClient;

  return { state, admin, onLeadCreated, onBookingDecided };
});

vi.mock('@/lib/lite/lead-events', () => ({
  onLeadCreated: (...args: unknown[]) => harness.onLeadCreated(...args),
  onBookingDecided: (...args: unknown[]) => harness.onBookingDecided(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => harness.admin,
}));

vi.mock('@/lib/lite/require-lite', () => ({
  requireLite: async () => ({
    ok: true,
    ctx: { tenantId: 'tenant-1', userId: 'user-1', widget: { id: 'widget-1' } },
  }),
}));

import { acceptBookingAction } from '@/lib/actions/lite/leads';
import { createLeadFromWidget, decideBooking, quoteGivenText, setBookedFor, setLeadStatus } from '@/lib/lite/leads-core';

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
  owner_mobile_e164: null,
  sign_off_name: 'Dave',
  follow_up_enabled: true,
  text_me_too: false,
  notification_email: 'dave@example.com',
} as WidgetRow;

function quote(kind: 'firm' | 'guide' | 'visit') {
  if (kind === 'firm') return { kind, jobTypeKey: 'patch', amount: 85, summary: 'Patch a wall' };
  if (kind === 'guide') return { kind, jobTypeKey: 'patch', min: 70, max: 120, summary: 'Patch a wall' };
  return { kind, jobTypeKey: 'ceiling', summary: 'Come and look' };
}

function input(overrides: Partial<WidgetLeadValues> = {}): WidgetLeadValues {
  return {
    clientId: widget.id,
    conversationId: 'conv-1',
    session: 'session-token-value',
    name: 'Sam',
    mobile: '07700 900123',
    postcode: 'm206ab',
    email: '',
    preferredDays: ['mon', 'mon'],
    note: '',
    wantsBooking: true,
    ...overrides,
  };
}

function chat(kind: 'firm' | 'guide' | 'visit' | null) {
  harness.state.conversations.push({
    id: 'conv-1',
    client_id: widget.id,
    visitor_message_count: 2,
    last_quote: kind ? quote(kind) : null,
  });
}

beforeEach(() => {
  harness.state.leads.length = 0;
  harness.state.conversations.length = 0;
  harness.state.profiles.length = 0;
  harness.state.insertError = false;
  harness.onLeadCreated.mockReset();
  harness.onBookingDecided.mockReset();
  harness.onLeadCreated.mockResolvedValue(undefined);
  harness.onBookingDecided.mockResolvedValue(undefined);
});

describe('createLeadFromWidget', () => {
  it('creates one lead, and a second send is a duplicate with no second hook', async () => {
    chat('firm');
    const first = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    const second = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    expect(first).toMatchObject({ ok: true, duplicate: false, autoAccepted: false });
    expect(second).toMatchObject({ ok: true, duplicate: true, autoAccepted: false });
    expect(harness.state.leads).toHaveLength(1);
    expect(harness.state.leads[0]).toMatchObject({
      tenant_id: 'tenant-1',
      postcode: 'M20 6AB',
      phone_e164: '+447700900123',
      booking_status: 'requested',
      quote_kind: 'firm',
      quote_amount: 85,
      quote_given: '£85',
      preferred_days: ['mon'],
      status: 'new',
    });
    expect(harness.onLeadCreated).toHaveBeenCalledTimes(1);
  });

  it('stores a call-back when they leave details, or book with no quote', async () => {
    chat('firm');
    const details = await createLeadFromWidget(harness.admin, {
      widget,
      conversationId: 'conv-1',
      input: input({ wantsBooking: false, conversationId: 'conv-1' }),
    });
    expect(details.ok).toBe(true);
    expect(harness.state.leads[0].booking_status).toBe('none');
    expect(harness.state.leads[0].status).toBe('new');

    harness.state.leads.length = 0;
    harness.state.conversations[0].id = 'conv-2';
    harness.state.conversations[0].last_quote = null;
    const enquiry = await createLeadFromWidget(harness.admin, {
      widget,
      conversationId: 'conv-2',
      input: input({ conversationId: 'conv-2', wantsBooking: true }),
    });
    expect(enquiry.ok).toBe(true);
    expect(harness.state.leads[0]).toMatchObject({ booking_status: 'none', quote_kind: null });
  });

  it('auto-accepts a firm booking and leaves a guide booking waiting', async () => {
    harness.state.profiles.push({
      tenant_id: 'tenant-1',
      profile: {
        areas: { summary: 'South Manchester', postcodes: ['M20'], max_miles: null },
        callout_fee: null,
        hourly_rate: null,
        day_rate: null,
        minimum_charge: null,
        materials: '',
        job_types: [
          {
            key: 'patch',
            name: 'Patch repair',
            how_priced: 'from_description',
            guide_min: 70,
            guide_max: 120,
            what_changes_price: 'Size',
            auto_accept: true,
          },
        ],
        rules: [],
        example_jobs: [],
        tone: '',
      },
    });
    chat('firm');
    const firm = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    expect(firm).toMatchObject({ ok: true, autoAccepted: true });
    expect(harness.state.leads[0]).toMatchObject({ booking_status: 'accepted', status: 'won', decided_by: 'auto' });
    expect(harness.onBookingDecided).toHaveBeenCalledTimes(1);
    const decided = harness.onBookingDecided.mock.calls[0]?.[2] as { decision: string; priceChanged: boolean } | undefined;
    expect(decided).toMatchObject({ decision: 'accepted', priceChanged: false });

    harness.state.leads.length = 0;
    harness.state.conversations[0].id = 'conv-2';
    harness.state.conversations[0].last_quote = quote('guide');
    const guide = await createLeadFromWidget(harness.admin, {
      widget,
      conversationId: 'conv-2',
      input: input({ conversationId: 'conv-2' }),
    });
    expect(guide).toMatchObject({ ok: true, autoAccepted: false });
    expect(harness.state.leads[0].booking_status).toBe('requested');
    expect(harness.state.leads[0].decided_by).toBeUndefined();
  });

  it('refuses a bad mobile and a missing conversation, and a failed insert writes nothing', async () => {
    chat('firm');
    const mobile = await createLeadFromWidget(harness.admin, {
      widget,
      conversationId: 'conv-1',
      input: input({ mobile: '020 7946 0958' }),
    });
    expect(mobile).toMatchObject({ ok: false, field: 'mobile', error: 'invalid' });

    const missing = await createLeadFromWidget(harness.admin, {
      widget,
      conversationId: 'missing',
      input: input({ conversationId: 'missing' }),
    });
    expect(missing).toEqual({ ok: false, error: 'no_conversation' });

    harness.state.insertError = true;
    const failed = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    expect(failed).toEqual({ ok: false, error: 'save_failed' });
    expect(harness.state.leads).toHaveLength(0);
    expect(harness.onLeadCreated).not.toHaveBeenCalled();
  });

  it('still returns the lead when the created hook throws', async () => {
    chat('firm');
    harness.onLeadCreated.mockRejectedValueOnce(new Error('email down'));
    const result = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    expect(result.ok).toBe(true);
    expect(harness.state.leads).toHaveLength(1);
  });
});

describe('decideBooking', () => {
  beforeEach(() => {
    chat('firm');
  });

  async function requested(kind: 'firm' | 'guide' = 'firm') {
    harness.state.conversations[0].last_quote = quote(kind);
    const created = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    if (!created.ok) throw new Error('setup');
    return created.leadId;
  }

  it('lets one accept win and tells the other the booking is already decided', async () => {
    const leadId = await requested();
    harness.onBookingDecided.mockClear();
    const first = await decideBooking(harness.admin, { tenantId: 'tenant-1', leadId, by: 'owner', decision: 'accept' });
    const second = await decideBooking(harness.admin, { tenantId: 'tenant-1', leadId, by: 'owner', decision: 'accept' });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: 'not_requested' });
    expect(harness.onBookingDecided).toHaveBeenCalledTimes(1);
    expect(harness.state.leads[0]).toMatchObject({ status: 'won', booking_status: 'accepted', agreed_amount: 85 });

    const action = await acceptBookingAction(leadId);
    expect(action).toEqual({ success: false, error: 'That booking has already been decided.' });
  });

  it('accepts a changed firm price and refuses a guide', async () => {
    const leadId = await requested();
    const changed = await decideBooking(harness.admin, {
      tenantId: 'tenant-1',
      leadId,
      by: 'owner',
      decision: 'change_price',
      newAmount: 95,
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.lead.agreed_amount).toBe(95);
    expect(harness.onBookingDecided.mock.calls.at(-1)?.[2]).toMatchObject({ decision: 'accepted', priceChanged: true });

    harness.state.leads.length = 0;
    harness.state.conversations[0].id = 'conv-2';
    harness.state.conversations[0].last_quote = quote('guide');
    const guide = await createLeadFromWidget(harness.admin, {
      widget,
      conversationId: 'conv-2',
      input: input({ conversationId: 'conv-2' }),
    });
    if (!guide.ok) throw new Error('guide');
    const refused = await decideBooking(harness.admin, {
      tenantId: 'tenant-1',
      leadId: guide.leadId,
      by: 'owner',
      decision: 'change_price',
      newAmount: 95,
    });
    expect(refused).toEqual({ ok: false, error: 'not_firm' });
  });

  it('hides another business’s lead', async () => {
    const leadId = await requested();
    const other = await decideBooking(harness.admin, { tenantId: 'tenant-2', leadId, by: 'owner', decision: 'accept' });
    expect(other).toEqual({ ok: false, error: 'not_found' });
    expect(harness.state.leads[0].booking_status).toBe('requested');
  });
});

describe('setLeadStatus and setBookedFor', () => {
  it('lets the board move a lead freely (launch: lead capture, Accept hidden)', async () => {
    chat('firm');
    const created = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    if (!created.ok) throw new Error('setup');
    const moved = await setLeadStatus(harness.admin, { tenantId: 'tenant-1', leadId: created.leadId, status: 'contacted' });
    expect(moved).toEqual({ ok: true });
    expect(harness.state.leads[0].status).toBe('contacted');

    const other = await setLeadStatus(harness.admin, { tenantId: 'tenant-2', leadId: created.leadId, status: 'won' });
    expect(other).toEqual({ ok: false, error: 'not_found' });
  });

  it('sets a booked-for date only on a won lead, inside the window', async () => {
    chat('firm');
    const created = await createLeadFromWidget(harness.admin, { widget, conversationId: 'conv-1', input: input() });
    if (!created.ok) throw new Error('setup');
    const early = await setBookedFor(harness.admin, { tenantId: 'tenant-1', leadId: created.leadId, date: '2026-10-10', time: '09:30' });
    expect(early).toEqual({ ok: false, error: 'not_won' });

    await decideBooking(harness.admin, { tenantId: 'tenant-1', leadId: created.leadId, by: 'owner', decision: 'accept' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const booked = await setBookedFor(harness.admin, { tenantId: 'tenant-1', leadId: created.leadId, date: today, time: '09:30' });
    expect(booked).toEqual({ ok: true });
    expect(harness.state.leads[0]).toMatchObject({ booked_for_date: today, booked_for_time: '09:30' });

    const cleared = await setBookedFor(harness.admin, { tenantId: 'tenant-1', leadId: created.leadId, date: null, time: null });
    expect(cleared).toEqual({ ok: true });
    expect(harness.state.leads[0].booked_for_date).toBeNull();

    const nonsense = await setBookedFor(harness.admin, { tenantId: 'tenant-1', leadId: created.leadId, date: '2026-02-31', time: null });
    expect(nonsense).toEqual({ ok: false, error: 'bad_date' });
  });
});

describe('quoteGivenText', () => {
  it('prints a firm price, a range, a visit, or nothing', () => {
    expect(quoteGivenText({ kind: 'firm', amount: 85 })).toBe('£85');
    expect(quoteGivenText({ kind: 'guide', min: 70, max: 120 })).toBe('£70–£120');
    expect(quoteGivenText({ kind: 'visit' })).toBe('Free look-and-quote visit');
    expect(quoteGivenText({})).toBe('');
  });
});
