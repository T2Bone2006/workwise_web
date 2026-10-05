import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Rec = Record<string, unknown>;

const harness = vi.hoisted(() => {
  const state = {
    tokens: [] as Rec[],
    leads: [] as Rec[],
    widgets: [] as Rec[],
    tokenError: false,
  };
  const onBookingDecided = vi.fn(async (...args: unknown[]) => {
    void args;
  });

  function rowsFor(table: string): Rec[] {
    if (table === 'lead_action_tokens') return state.tokens;
    if (table === 'leads') return state.leads;
    if (table === 'widget_clients') return state.widgets;
    return [];
  }

  function builder(table: string) {
    const filters: Array<(row: Rec) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let patch: Rec | null = null;
    let incoming: Rec | null = null;

    function execute(single: boolean) {
      const rows = rowsFor(table);
      if (mode === 'insert') {
        const row = { id: `${table}-${rows.length + 1}`, ...(incoming ?? {}) };
        rows.push(row);
        return { data: single ? row : row, error: null };
      }
      if (table === 'lead_action_tokens' && state.tokenError && mode === 'select') {
        return { data: null, error: { message: 'down' } };
      }
      const hit = rows.filter((row) => filters.every((pred) => pred(row)));
      if (mode === 'update') {
        for (const row of hit) Object.assign(row, patch);
      }
      const copies = hit.map((row) => ({ ...row }));
      return { data: single ? (copies[0] ?? null) : copies, error: null };
    }

    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
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

  const admin = { from: (table: string) => builder(table) } as unknown as SupabaseClient;
  return { state, admin, onBookingDecided };
});

vi.mock('@/lib/lite/lead-events', () => ({
  onLeadCreated: vi.fn(async () => {}),
  onBookingDecided: (...args: unknown[]) => harness.onBookingDecided(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => harness.admin,
}));

import { issueLeadToken } from '@/lib/lite/action-tokens';
import { decideFromLinkAction } from '@/app/lead/[token]/actions';

const PRICE_ERROR = 'Enter a price between £1 and £50,000.';

function lead(overrides: Rec = {}): Rec {
  return {
    id: 'lead-1',
    tenant_id: 'tenant-1',
    name: 'Sarah Jones',
    phone: '07123 456789',
    phone_e164: '+447123456789',
    email: 'sarah@example.com',
    postcode: 'M1 2AB',
    job_summary: 'Patch a wall',
    quote_kind: 'firm',
    quote_amount: 85,
    quote_min: null,
    quote_max: null,
    preferred_days: ['mon'],
    customer_note: null,
    booking_status: 'requested',
    agreed_amount: null,
    decided_at: null,
    decided_by: null,
    status: 'new',
    ...overrides,
  };
}

async function liveToken(): Promise<string> {
  const raw = await issueLeadToken(harness.admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
  if (!raw) throw new Error('token');
  return raw;
}

describe('decideFromLinkAction', () => {
  beforeEach(() => {
    harness.state.tokens.length = 0;
    harness.state.leads.length = 0;
    harness.state.widgets.length = 0;
    harness.state.tokenError = false;
    harness.state.widgets.push({ id: 'widget-1', tenant_id: 'tenant-1', business_name: "Dave's Plastering" });
    harness.onBookingDecided.mockClear();
  });

  it('rejects a token that is not a real link', async () => {
    const result = await decideFromLinkAction({ token: 'notarealtoken', decision: 'accept' });
    expect(result).toEqual({ success: false, error: "This link doesn't work." });
  });

  it('rejects an expired link', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
      harness.state.leads.push(lead());
      const token = await liveToken();
      vi.setSystemTime(new Date('2026-06-15T12:00:01.000Z'));
      const result = await decideFromLinkAction({ token, decision: 'accept' });
      expect(result).toEqual({
        success: false,
        error: 'This link has expired — open WorkWise to decide.',
      });
      expect(harness.state.leads[0]?.booking_status).toBe('requested');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a firm booking once', async () => {
    harness.state.leads.push(lead());
    const token = await liveToken();
    const result = await decideFromLinkAction({ token, decision: 'accept' });
    expect(result.success).toBe(true);
    if (result.success && result.view.state === 'decided') {
      expect(result.view.lead.bookingStatus).toBe('accepted');
      expect(result.view.lead.agreedAmount).toBe(85);
      expect(result.view.lead.decidedBy).toBe('owner');
      expect(result.view.business.name).toBe("Dave's Plastering");
    } else {
      expect(result).toMatchObject({ success: true, view: { state: 'decided' } });
    }
    expect(JSON.stringify(result)).not.toContain('sarah@example.com');
    expect(harness.state.leads[0]).toMatchObject({ booking_status: 'accepted', status: 'won', agreed_amount: 85 });
    expect(typeof harness.state.tokens[0]?.last_used_at).toBe('string');
  });

  it('accepts at a new price', async () => {
    harness.state.leads.push(lead());
    const token = await liveToken();
    const result = await decideFromLinkAction({ token, decision: 'change_price', amount: 95 });
    expect(result.success).toBe(true);
    if (!result.success || result.view.state !== 'decided') {
      expect(result).toMatchObject({ success: true, view: { state: 'decided' } });
      return;
    }
    expect(result.view.lead.bookingStatus).toBe('accepted');
    expect(result.view.lead.agreedAmount).toBe(95);
    expect(harness.state.leads[0]).toMatchObject({
      booking_status: 'accepted',
      status: 'won',
      agreed_amount: 95,
    });
  });

  it('refuses a change of price outside £1 to £50,000, including text, and decides nothing', async () => {
    harness.state.leads.push(lead());
    const token = await liveToken();
    const bad = [0, -5, 50001, 'abc' as unknown as number];
    for (const amount of bad) {
      const result = await decideFromLinkAction({ token, decision: 'change_price', amount });
      expect(result).toEqual({ success: false, error: PRICE_ERROR });
    }
    expect(harness.state.leads[0]?.booking_status).toBe('requested');
    expect(harness.onBookingDecided).not.toHaveBeenCalled();
  });

  it('refuses change price on a guide quote', async () => {
    harness.state.leads.push(
      lead({ quote_kind: 'guide', quote_amount: null, quote_min: 70, quote_max: 120 }),
    );
    const token = await liveToken();
    const result = await decideFromLinkAction({ token, decision: 'change_price', amount: 90 });
    expect(result).toEqual({ success: false, error: 'Change price is only for a firm quote.' });
    expect(harness.state.leads[0]?.booking_status).toBe('requested');
  });

  it('a second tap sees the decision that already happened', async () => {
    harness.state.leads.push(lead());
    const token = await liveToken();
    const first = await decideFromLinkAction({ token, decision: 'accept' });
    expect(first.success).toBe(true);
    const second = await decideFromLinkAction({ token, decision: 'decline', tellCustomer: false });
    expect(second.success).toBe(true);
    if (second.success && second.view.state === 'decided') {
      expect(second.view.lead.bookingStatus).toBe('accepted');
      expect(second.view.lead.agreedAmount).toBe(85);
    } else {
      expect(second).toMatchObject({ success: true, view: { state: 'decided' } });
    }
    expect(harness.state.leads[0]?.booking_status).toBe('accepted');
    expect(harness.onBookingDecided).toHaveBeenCalledTimes(1);
  });
});
