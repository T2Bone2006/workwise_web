import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueLeadToken } from '@/lib/lite/action-tokens';
import { loadLeadLinkView } from '@/lib/lite/lead-link-view';

type Rec = Record<string, unknown>;

const state = {
  tokens: [] as Rec[],
  leads: [] as Rec[],
  widgets: [] as Rec[],
  tokenError: false,
  leadError: false,
  widgetError: false,
  leadUpdates: 0,
};

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
    if (table === 'leads' && state.leadError && mode === 'select') {
      return { data: null, error: { message: 'down' } };
    }
    if (table === 'widget_clients' && state.widgetError && mode === 'select') {
      return { data: null, error: { message: 'down' } };
    }
    const hit = rows.filter((row) => filters.every((pred) => pred(row)));
    if (mode === 'update') {
      if (table === 'leads') state.leadUpdates += 1;
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

function reset() {
  state.tokens.length = 0;
  state.leads.length = 0;
  state.widgets.length = 0;
  state.tokenError = false;
  state.leadError = false;
  state.widgetError = false;
  state.leadUpdates = 0;
}

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
    preferred_days: ['mon', 'wed'],
    customer_note: 'After school',
    booking_status: 'requested',
    agreed_amount: null,
    decided_at: null,
    decided_by: null,
    ...overrides,
  };
}

function widget(overrides: Rec = {}): Rec {
  return { id: 'widget-1', tenant_id: 'tenant-1', business_name: "Dave's Plastering", ...overrides };
}

describe('loadLeadLinkView', () => {
  afterEach(() => {
    vi.useRealTimers();
    reset();
  });

  it('returns invalid for a token that is not a real link', async () => {
    await expect(loadLeadLinkView(admin, 'notarealtoken')).resolves.toEqual({ state: 'invalid' });
    expect(state.leadUpdates).toBe(0);
  });

  it('returns expired 14 days and one second after the link was issued, even if still undecided', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    state.leads.push(lead());
    state.widgets.push(widget());
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
    vi.setSystemTime(new Date('2026-06-15T12:00:01.000Z'));
    await expect(loadLeadLinkView(admin, raw ?? '')).resolves.toEqual({ state: 'expired' });
    expect(state.leads[0]?.booking_status).toBe('requested');
    expect(state.leadUpdates).toBe(0);
  });

  it('returns the open booking and the business name, and never the email', async () => {
    state.leads.push(lead());
    state.widgets.push(widget());
    state.widgets.push(widget({ id: 'widget-2', tenant_id: 'tenant-2', business_name: 'Other Co' }));
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
    const view = await loadLeadLinkView(admin, raw ?? '');
    expect(view).toEqual({
      state: 'open',
      business: { name: "Dave's Plastering" },
      lead: {
        fullName: 'Sarah Jones',
        firstName: 'Sarah',
        mobileDisplay: '07123 456789',
        postcode: 'M1 2AB',
        jobSummary: 'Patch a wall',
        quoteKind: 'firm',
        quoteAmount: 85,
        quoteMin: null,
        quoteMax: null,
        preferredDays: ['mon', 'wed'],
        note: 'After school',
        bookingStatus: 'requested',
        agreedAmount: null,
        decidedAt: null,
        decidedBy: null,
      },
    });
    expect(JSON.stringify(view)).not.toContain('sarah@example.com');
    expect(state.leadUpdates).toBe(0);
  });

  it('returns decided once the booking has been accepted', async () => {
    state.leads.push(
      lead({
        booking_status: 'accepted',
        agreed_amount: 95,
        decided_at: '2026-06-02T15:30:00.000Z',
        decided_by: 'owner',
      }),
    );
    state.widgets.push(widget());
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
    const view = await loadLeadLinkView(admin, raw ?? '');
    expect(view.state).toBe('decided');
    if (view.state === 'decided') {
      expect(view.lead.bookingStatus).toBe('accepted');
      expect(view.lead.agreedAmount).toBe(95);
      expect(view.lead.decidedBy).toBe('owner');
    }
  });

  it('treats a lead that was never a booking request as already decided', async () => {
    state.leads.push(lead({ booking_status: 'none', quote_kind: null, quote_amount: null }));
    state.widgets.push(widget());
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
    const view = await loadLeadLinkView(admin, raw ?? '');
    expect(view.state).toBe('decided');
    if (view.state === 'decided') expect(view.lead.bookingStatus).toBe('none');
  });

  it('only loads the lead belonging to the token’s business', async () => {
    state.leads.push(lead({ id: 'lead-1', tenant_id: 'tenant-2', postcode: 'SW1A 1AA', email: 'other@example.com' }));
    state.widgets.push(widget());
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
    await expect(loadLeadLinkView(admin, raw ?? '')).resolves.toEqual({ state: 'invalid' });
    expect(JSON.stringify(state.leads)).toContain('other@example.com');
  });

  it('throws when the token lookup or the lead query fails', async () => {
    const raw = 'a'.repeat(43);
    state.tokenError = true;
    await expect(loadLeadLinkView(admin, raw)).rejects.toThrow('Could not load this link.');
    state.tokenError = false;
    state.leads.push(lead());
    state.widgets.push(widget());
    const live = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1' });
    state.leadError = true;
    await expect(loadLeadLinkView(admin, live ?? '')).rejects.toThrow(/Could not load this link/);
    expect(String(await loadLeadLinkView(admin, live ?? '').catch((error: unknown) => error))).not.toContain(live);
  });
});
