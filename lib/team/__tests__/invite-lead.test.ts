import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const reconcile = vi.fn();
vi.mock('@/lib/billing/rounds-team', () => ({
  reconcileRoundsTeamAfterChange: (...a: unknown[]) => reconcile(...a),
}));

const preview = vi.fn();
vi.mock('@/lib/billing/rounds-team-preview', () => ({
  previewRoundsTeamCharge: (...a: unknown[]) => preview(...a),
}));

const sent: Array<{ to: string; subject: string; html: string }> = [];
let sendError: { message: string } | null = null;
vi.mock('@/lib/resend', () => ({
  FROM_EMAIL: 'noreply@test',
  resend: {
    emails: {
      send: async (args: { to: string; subject: string; html: string }) => {
        if (sendError) return { error: sendError };
        sent.push(args);
        return { error: null };
      },
    },
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { inviteLead, resendLeadInvite } from '@/lib/team/invite-lead';
import { fakeDb, type FakeDb } from './fake-db';
import type { LeadInvite } from '@/lib/validations/team';

const T = 'tenant-1';
const USER = 'owner-user';

const input = (over: Partial<LeadInvite> = {}): LeadInvite => ({
  name: 'Dave Cooper',
  email: 'dave@example.com',
  phone: '07700900123',
  dayRatePounds: 12000,
  usualDays: [1, 2, 3, 4],
  confirmedPriceCents: 1000,
  ...over,
});

function seed(sub: Record<string, unknown> | null = {}): FakeDb {
  return fakeDb({
    tenants: [{ id: T, name: 'Clearview Window Cleaning' }],
    subscriptions:
      sub === null
        ? []
        : [{ tenant_id: T, product: 'rounds', status: 'active', source: 'stripe', stripe_subscription_id: 'sub_1', billing_interval: 'month', ...sub }],
  });
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
  sent.length = 0;
  sendError = null;
  reconcile.mockReset();
  preview.mockReset();
  preview.mockResolvedValue({ ok: true, interval: 'month', perLeadPence: 1000, chargeNowPence: null, firstBillNote: 'x' });
});

describe('inviteLead: the price comes first', () => {
  it('asks and creates nothing when the price has not been agreed', async () => {
    const result = await inviteLead({ tenantId: T, userId: USER, input: input({ confirmedPriceCents: undefined }), db: db.client });
    expect(result).toEqual({
      ok: false,
      needsConfirm: {
        perLeadPence: 1000,
        interval: 'month',
        chargeNowPence: null,
        sentence: "£10 a month per extra worker, VAT included where applicable. You'll be charged from today.",
      },
    });
    expect(db.rows('workers')).toHaveLength(0);
    expect(db.authCreated).toHaveLength(0);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('asks again with the new figure if the price changed since the owner agreed', async () => {
    preview.mockResolvedValue({ ok: true, interval: 'year', perLeadPence: 10000, chargeNowPence: 5836, firstBillNote: 'x' });
    const result = await inviteLead({ tenantId: T, userId: USER, input: input({ confirmedPriceCents: 1000 }), db: db.client });
    expect(result).toMatchObject({
      ok: false,
      needsConfirm: {
        perLeadPence: 10000,
        interval: 'year',
        chargeNowPence: 5836,
        sentence: "£100 a year per extra worker, VAT included where applicable. You'll be charged from today: £58.36 now for the rest of your year.",
      },
    });
    expect(db.rows('workers')).toHaveLength(0);
  });

  it('falls back to the plan’s own interval when Stripe can’t be asked', async () => {
    preview.mockResolvedValue({ ok: false, reason: 'down' });
    db = seed({ billing_interval: 'year' });
    const result = await inviteLead({ tenantId: T, userId: USER, input: input({ confirmedPriceCents: undefined }), db: db.client });
    expect(result).toMatchObject({ ok: false, needsConfirm: { interval: 'year', perLeadPence: 10000, chargeNowPence: null } });
  });
});

describe('inviteLead: who may be added to', () => {
  it('refuses a Pro business', async () => {
    db = seed();
    db.rows('subscriptions').push({ tenant_id: T, product: 'growth', status: 'active', source: 'stripe', stripe_subscription_id: 'sub_2' });
    expect(await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client })).toEqual({ ok: false, error: 'Team members are for Rounds businesses.' });
    expect(db.rows('workers')).toHaveLength(0);
  });

  it('refuses a hand-set-up Rounds account rather than giving it free staff', async () => {
    db = seed({ source: 'manual', stripe_subscription_id: null });
    expect(await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client })).toEqual({
      ok: false,
      error: "Your plan can't add team members yet. Contact us.",
    });
  });

  it('refuses a business with no Rounds plan, and an ended plan', async () => {
    db = seed(null);
    expect((await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client })).ok).toBe(false);
    db = seed({ status: 'canceled' });
    expect((await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client })).ok).toBe(false);
    expect(db.rows('workers')).toHaveLength(0);
  });
});

describe('inviteLead: creating the lead', () => {
  it('creates the worker (employee), the team person, the invite and the consent, sends one email and starts the charge', async () => {
    const result = await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client });
    expect(result).toMatchObject({ ok: true, emailSent: true });

    expect(db.rows('workers')).toHaveLength(1);
    expect(db.rows('workers')[0]).toMatchObject({
      primary_tenant_id: T,
      full_name: 'Dave Cooper',
      email: 'dave@example.com',
      phone: '07700900123',
      worker_type: 'employee',
      invite_status: 'pending',
    });
    expect(db.rows('workers')[0]).not.toHaveProperty('home_postcode');
    expect(db.rows('team_people')).toHaveLength(1);
    expect(db.rows('team_people')[0]).toMatchObject({ kind: 'lead', name: 'Dave Cooper', day_rate_pence: 12000, usual_days: [1, 2, 3, 4] });
    expect(db.rows('team_people')[0].worker_id).toBe(db.rows('workers')[0].id);
    expect(db.rows('worker_invites')).toHaveLength(1);
    expect(db.rows('worker_invites')[0]).toMatchObject({ tenant_id: T, email: 'dave@example.com' });
    expect(db.rows('worker_allowance_confirmations')[0]).toMatchObject({
      tenant_id: T, confirmed_by_user_id: USER, tier: 'rounds', worker_number: 1, extra_worker_pounds: 10,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('dave@example.com');
    expect(sent[0].subject).toBe('Clearview Window Cleaning has added you to their team on WorkWise');
    expect(sent[0].html).toContain('/accept-invite?token=');
    expect(sent[0].html).not.toMatch(/£\d/); // no prices in the email
    expect(reconcile).toHaveBeenCalledWith(T);
  });

  it('rolls everything back if the team row cannot be saved, and charges nothing', async () => {
    const original = db.from.bind(db);
    db.from = ((table: string) => {
      if (table === 'team_people') {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }), delete: () => ({ eq: async () => ({}) }) };
      }
      return original(table);
    }) as never;
    const result = await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client });
    expect(result).toEqual({ ok: false, error: "Couldn't add them. Nothing was charged." });
    expect(db.rows('workers')).toHaveLength(0);
    expect(db.rows('worker_tenants')).toHaveLength(0);
    expect(db.authDeleted).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('keeps the lead, and the charge, when only the email fails; the owner can resend', async () => {
    sendError = { message: 'resend down' };
    const result = await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client });
    expect(result).toMatchObject({ ok: true, emailSent: false });
    expect(db.rows('team_people')).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledWith(T);
  });

  it('refuses an email already used in the business, or one that already has a WorkWise login', async () => {
    db.rows('workers').push({ id: 'w-old', primary_tenant_id: T, email: 'dave@example.com' });
    expect(await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client })).toEqual({
      ok: false,
      error: 'A team member with this email already exists.',
    });
    db.rows('workers').length = 0;
    db.authInviteError = { message: 'A user with this email address has already been registered', code: 'email_exists' };
    const second = await inviteLead({ tenantId: T, userId: USER, input: input(), db: db.client });
    expect(second.ok).toBe(false);
    expect(second).toMatchObject({ error: expect.stringContaining('already has a WorkWise login') });
    expect(db.rows('team_people')).toHaveLength(0);
  });

  it('counts leads for the consent record', async () => {
    db.rows('team_people').push({ id: 'existing', tenant_id: T, kind: 'lead', worker_id: 'w-x', ended_at: null });
    await inviteLead({ tenantId: T, userId: USER, input: input({ email: 'lee@example.com', name: 'Lee' }), db: db.client });
    expect(db.rows('worker_allowance_confirmations')[0].worker_number).toBe(2);
  });
});

describe('resendLeadInvite', () => {
  async function addLead(status: string, ended: string | null = null) {
    db.rows('workers').push({ id: 'w1', primary_tenant_id: T, email: 'dave@example.com', invite_status: status });
    db.rows('team_people').push({ id: 'p1', tenant_id: T, kind: 'lead', name: 'Dave', worker_id: 'w1', ended_at: ended });
  }

  it('sends a fresh link to a pending lead', async () => {
    await addLead('pending');
    expect(await resendLeadInvite({ tenantId: T, personId: 'p1', db: db.client })).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(db.rows('worker_invites')).toHaveLength(1);
  });

  it('says so for someone who has joined or been removed, and sends nothing', async () => {
    await addLead('accepted');
    expect(await resendLeadInvite({ tenantId: T, personId: 'p1', db: db.client })).toEqual({ ok: false, error: "They've already joined." });
    db.rows('workers')[0].invite_status = 'deactivated';
    expect(await resendLeadInvite({ tenantId: T, personId: 'p1', db: db.client })).toEqual({ ok: false, error: "They've been removed." });
    expect(sent).toHaveLength(0);
  });

  it('refuses another business’s person or a helper', async () => {
    await addLead('pending');
    expect(await resendLeadInvite({ tenantId: 'other', personId: 'p1', db: db.client })).toEqual({ ok: false, error: 'Not found.' });
    db.rows('team_people').push({ id: 'h1', tenant_id: T, kind: 'helper', name: 'Lee', worker_id: null, ended_at: null });
    expect(await resendLeadInvite({ tenantId: T, personId: 'h1', db: db.client })).toEqual({ ok: false, error: 'Not found.' });
  });
});
