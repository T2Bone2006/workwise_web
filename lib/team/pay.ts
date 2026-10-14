import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, compareYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';

/**
 * Pay (D4, D5, T6, T7): for each person, the days they worked at their day rate (earned), what the owner has told the app
 * they paid (paid) and what is left (owed). The app never pays anyone: it records. Recording a payment also makes the
 * matching `wages` expense, in one SQL call (record_team_payment) so the pay log and the books cannot drift apart.
 * Takes the SERVICE-ROLE client; the caller took tenantId from the owner's session.
 */

export type PayRange = { from?: Ymd; to?: Ymd };

export type PersonPay = {
  personId: string;
  name: string;
  kind: 'lead' | 'helper';
  active: boolean;
  daysWorked: number;
  earnedPence: number;
  paidPence: number;
  /** earned − paid over the same range. Negative = paid ahead. */
  owedPence: number;
  lastPaidOn: Ymd | null;
  lastWorkedOn: Ymd | null;
};

export type DayRow = {
  id: string;
  date: Ymd;
  role: 'lead' | 'helper';
  ratePence: number;
  source: 'start_day' | 'manual';
  withName: string | null;
  note: string | null;
};
export type PaymentRow = { id: string; paidOn: Ymd; amountPence: number; note: string | null; voided: boolean };

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_FOUND = 'Not found.';

type PersonRow = { id: string; name: string; kind: 'lead' | 'helper'; day_rate_pence: number; ended_at: string | null };
type DayDb = { id: string; person_id: string; work_date: Ymd; role: 'lead' | 'helper'; rate_pence: number; source: 'start_day' | 'manual'; with_person_id: string | null; note: string | null };
type PayDb = { id: string; person_id: string; paid_on: Ymd; amount_pence: number; note: string | null; voided_at: string | null };

async function loadPeople(db: SupabaseClient, tenantId: string): Promise<PersonRow[]> {
  const { data, error } = await db.from('team_people').select('id, name, kind, day_rate_pence, ended_at').eq('tenant_id', tenantId);
  if (error || !Array.isArray(data)) throw new Error('Could not load your team.');
  return (data as PersonRow[]).map((p) => ({ id: p.id, name: p.name, kind: p.kind, day_rate_pence: p.day_rate_pence, ended_at: p.ended_at }));
}

function inRange(date: Ymd, range?: PayRange): boolean {
  if (range?.from && compareYmd(date, range.from) < 0) return false;
  if (range?.to && compareYmd(date, range.to) > 0) return false;
  return true;
}

async function loadDays(db: SupabaseClient, tenantId: string, range?: PayRange, personId?: string): Promise<DayDb[]> {
  let q = db.from('work_days').select('id, person_id, work_date, role, rate_pence, source, with_person_id, note').eq('tenant_id', tenantId);
  if (personId) q = q.eq('person_id', personId);
  if (range?.from) q = q.gte('work_date', range.from);
  if (range?.to) q = q.lte('work_date', range.to);
  const { data, error } = await q.order('work_date', { ascending: false });
  if (error || !Array.isArray(data)) throw new Error('Could not load the days worked.');
  return (data as DayDb[]).filter((d) => inRange(d.work_date, range));
}

async function loadPayments(db: SupabaseClient, tenantId: string, range?: PayRange, personId?: string): Promise<PayDb[]> {
  let q = db.from('team_payments').select('id, person_id, paid_on, amount_pence, note, voided_at').eq('tenant_id', tenantId);
  if (personId) q = q.eq('person_id', personId);
  if (range?.from) q = q.gte('paid_on', range.from);
  if (range?.to) q = q.lte('paid_on', range.to);
  const { data, error } = await q.order('paid_on', { ascending: false });
  if (error || !Array.isArray(data)) throw new Error('Could not load the payments.');
  return (data as PayDb[]).filter((p) => inRange(p.paid_on, range));
}

function summarise(person: PersonRow, days: DayDb[], payments: PayDb[]): PersonPay {
  const mine = days.filter((d) => d.person_id === person.id);
  const paid = payments.filter((p) => p.person_id === person.id && !p.voided_at);
  const earnedPence = mine.reduce((sum, d) => sum + d.rate_pence, 0);
  const paidPence = paid.reduce((sum, p) => sum + p.amount_pence, 0);
  const lastWorkedOn = mine.map((d) => d.work_date).sort(compareYmd).pop() ?? null;
  const lastPaidOn = paid.map((p) => p.paid_on).sort(compareYmd).pop() ?? null;
  return {
    personId: person.id,
    name: person.name,
    kind: person.kind,
    active: !person.ended_at,
    daysWorked: mine.length,
    earnedPence,
    paidPence,
    owedPence: earnedPence - paidPence,
    lastPaidOn,
    lastWorkedOn,
  };
}

/** Everyone on the team (ended people too, they may still be owed), leads before helpers. Throws if it cannot be read. */
export async function getPayLedger(db: SupabaseClient, tenantId: string, range?: PayRange): Promise<PersonPay[]> {
  const [people, days, payments] = await Promise.all([loadPeople(db, tenantId), loadDays(db, tenantId, range), loadPayments(db, tenantId, range)]);
  return people
    .map((p) => summarise(p, days, payments))
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'lead' ? -1 : 1));
}

export async function getPersonStatement(
  db: SupabaseClient,
  tenantId: string,
  personId: string,
  range?: PayRange,
): Promise<{ person: PersonPay; days: DayRow[]; payments: PaymentRow[] } | null> {
  const people = await loadPeople(db, tenantId);
  const person = people.find((p) => p.id === personId);
  if (!person) return null;
  const [days, payments] = await Promise.all([loadDays(db, tenantId, range, personId), loadPayments(db, tenantId, range, personId)]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  return {
    person: summarise(person, days, payments),
    days: days.map((d) => ({
      id: d.id,
      date: d.work_date,
      role: d.role,
      ratePence: d.rate_pence,
      source: d.source,
      withName: d.with_person_id ? (nameById.get(d.with_person_id) ?? null) : null,
      note: d.note,
    })),
    payments: payments.map((p) => ({ id: p.id, paidOn: p.paid_on, amountPence: p.amount_pence, note: p.note, voided: Boolean(p.voided_at) })),
  };
}

/** "This week: Dave 4 days £480, Lee 3 days £270": only people who worked that week, Monday to Sunday. */
export async function weekSummary(
  db: SupabaseClient,
  tenantId: string,
  weekStart: Ymd,
): Promise<Array<{ name: string; days: number; earnedPence: number }>> {
  const ledger = await getPayLedger(db, tenantId, { from: weekStart, to: addDays(weekStart, 6) });
  return ledger.filter((p) => p.daysWorked > 0).map((p) => ({ name: p.name, days: p.daysWorked, earnedPence: p.earnedPence }));
}

// ---------------------------------------------------------------------------
// Payments (the SQL functions make the wages expense with them)

export const MAX_PAYMENT_PENCE = 10_000_000;

export async function recordTeamPayment(
  db: SupabaseClient,
  p: { tenantId: string; userId: string; personId: string; amountPence: number; paidOn: Ymd; note?: string | null; clientMutationId?: string | null; today?: Ymd },
): Promise<Result<{ paymentId: string }>> {
  if (!Number.isInteger(p.amountPence) || p.amountPence < 1 || p.amountPence > MAX_PAYMENT_PENCE) {
    return { ok: false, error: 'Enter an amount between 1p and £100,000.' };
  }
  if (compareYmd(p.paidOn, addDays(p.today ?? todayInLondon(), 1)) > 0) {
    return { ok: false, error: 'The date can’t be in the future.' };
  }
  const { data, error } = await db.rpc('record_team_payment', {
    p_tenant_id: p.tenantId,
    p_person_id: p.personId,
    p_amount_pence: p.amountPence,
    p_paid_on: p.paidOn,
    p_note: p.note?.trim() ? p.note.trim().slice(0, 300) : null,
    p_client_mutation_id: p.clientMutationId ?? null,
    p_user_id: p.userId,
  });
  if (error) {
    const message = error.message ?? '';
    if (/person_not_found/.test(message)) return { ok: false, error: NOT_FOUND };
    if (/bad_amount/.test(message)) return { ok: false, error: 'Enter an amount between 1p and £100,000.' };
    console.error('[team-pay] record:', message);
    return { ok: false, error: 'Could not record that. Try again.' };
  }
  return { ok: true, paymentId: String(data) };
}

export async function voidTeamPayment(
  db: SupabaseClient,
  p: { tenantId: string; userId: string; paymentId: string },
): Promise<Result> {
  const { data, error } = await db.rpc('void_team_payment', { p_tenant_id: p.tenantId, p_payment_id: p.paymentId, p_user_id: p.userId });
  if (error) {
    console.error('[team-pay] void:', error.message);
    return { ok: false, error: 'Could not void that. Try again.' };
  }
  return data === true ? { ok: true } : { ok: false, error: 'Already voided.' };
}

// ---------------------------------------------------------------------------
// Days worked: fixing a missed or wrong day

async function personRow(db: SupabaseClient, tenantId: string, personId: string): Promise<PersonRow | null> {
  const { data, error } = await db
    .from('team_people')
    .select('id, name, kind, day_rate_pence, ended_at')
    .eq('id', personId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return error || !data ? null : (data as PersonRow);
}

export async function addWorkDay(
  db: SupabaseClient,
  p: { tenantId: string; personId: string; date: Ymd; ratePence?: number; note?: string | null; today?: Ymd },
): Promise<Result<{ id: string }>> {
  const person = await personRow(db, p.tenantId, p.personId);
  if (!person) return { ok: false, error: NOT_FOUND };
  if (compareYmd(p.date, p.today ?? todayInLondon()) > 0) return { ok: false, error: 'You can’t add a day in the future.' };
  const rate = p.ratePence ?? person.day_rate_pence;
  if (!Number.isInteger(rate) || rate < 0 || rate > 100000) return { ok: false, error: 'Enter a rate between £0 and £1,000.' };

  const { data: existing, error: existingError } = await db
    .from('work_days')
    .select('id')
    .eq('tenant_id', p.tenantId)
    .eq('person_id', p.personId)
    .eq('work_date', p.date)
    .maybeSingle();
  if (existingError) return { ok: false, error: 'Could not add that. Try again.' };
  if (existing) return { ok: false, error: `${person.name} already has a day on ${p.date}. Edit that one.` };

  const { data, error } = await db
    .from('work_days')
    .insert({
      tenant_id: p.tenantId,
      work_date: p.date,
      person_id: p.personId,
      role: person.kind,
      rate_pence: rate,
      source: 'manual',
      note: p.note?.trim() ? p.note.trim().slice(0, 300) : null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[team-pay] add day:', error?.message);
    return { ok: false, error: 'Could not add that. Try again.' };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateWorkDay(
  db: SupabaseClient,
  p: { tenantId: string; id: string; ratePence?: number; note?: string | null },
): Promise<Result> {
  const patch: Record<string, unknown> = {};
  if (p.ratePence !== undefined) {
    if (!Number.isInteger(p.ratePence) || p.ratePence < 0 || p.ratePence > 100000) return { ok: false, error: 'Enter a rate between £0 and £1,000.' };
    patch.rate_pence = p.ratePence;
  }
  if (p.note !== undefined) patch.note = p.note?.trim() ? p.note.trim().slice(0, 300) : null;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { data, error } = await db.from('work_days').update(patch).eq('id', p.id).eq('tenant_id', p.tenantId).select('id');
  if (error) return { ok: false, error: 'Could not save that. Try again.' };
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, error: NOT_FOUND };
}

/** The one place a work_days row is deleted: the owner correcting a day that was wrong. */
export async function removeWorkDay(db: SupabaseClient, p: { tenantId: string; id: string }): Promise<Result> {
  const { data, error } = await db.from('work_days').delete().eq('id', p.id).eq('tenant_id', p.tenantId).select('id');
  if (error) return { ok: false, error: 'Could not remove that. Try again.' };
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, error: NOT_FOUND };
}
