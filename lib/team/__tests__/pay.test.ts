import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  addWorkDay,
  getPayLedger,
  getPersonStatement,
  recordTeamPayment,
  removeWorkDay,
  updateWorkDay,
  voidTeamPayment,
  weekSummary,
} from '@/lib/team/pay';
import { expenseIsTeamPay, TEAM_PAY_EXPENSE_MESSAGE } from '@/lib/data/expenses-team-pay';
import { deleteExpenseCore, saveExpenseCore } from '@/lib/expenses/expenses-core';
import { fakeDb, type FakeDb } from './fake-db';

const T = 't1';
const TODAY = '2026-10-16';

function seed(): FakeDb {
  const db = fakeDb({
    team_people: [
      { id: 'p-dave', tenant_id: T, kind: 'lead', name: 'Dave', day_rate_pence: 12000, ended_at: null },
      { id: 'h-lee', tenant_id: T, kind: 'helper', name: 'Lee', day_rate_pence: 9000, ended_at: null },
      { id: 'h-gone', tenant_id: T, kind: 'helper', name: 'Gone', day_rate_pence: 5000, ended_at: '2026-01-01T00:00:00Z' },
      { id: 'p-other', tenant_id: 'other', kind: 'helper', name: 'Zed', day_rate_pence: 1, ended_at: null },
    ],
    work_days: [
      ...['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((d, i) => ({ id: `d${i}`, tenant_id: T, person_id: 'p-dave', work_date: d, role: 'lead', rate_pence: 12000, source: 'start_day', with_person_id: null, note: null })),
      ...['2026-10-12', '2026-10-13', '2026-10-14'].map((d, i) => ({ id: `l${i}`, tenant_id: T, person_id: 'h-lee', work_date: d, role: 'helper', rate_pence: 9000, source: 'start_day', with_person_id: 'p-dave', note: null })),
      { id: 'old', tenant_id: T, person_id: 'p-dave', work_date: '2026-09-01', role: 'lead', rate_pence: 11000, source: 'start_day', with_person_id: null, note: null },
      { id: 'gone1', tenant_id: T, person_id: 'h-gone', work_date: '2026-09-02', role: 'helper', rate_pence: 5000, source: 'start_day', with_person_id: null, note: null },
    ],
    team_payments: [
      { id: 'pay1', tenant_id: T, person_id: 'p-dave', paid_on: '2026-10-14', amount_pence: 30000, note: null, voided_at: null },
      { id: 'pay2', tenant_id: T, person_id: 'p-dave', paid_on: '2026-10-15', amount_pence: 99900, note: 'mistake', voided_at: '2026-10-15T10:00:00Z' },
    ],
    expenses: [],
  });
  // The SQL functions, in miniature (the real ones are tested against Postgres separately).
  let seq = 0;
  db.rpcHandlers.record_team_payment = (a) => {
    if (a.p_client_mutation_id) {
      const dup = db.rows('team_payments').find((r) => r.tenant_id === a.p_tenant_id && r.client_mutation_id === a.p_client_mutation_id);
      if (dup) return dup.id;
    }
    const person = db.rows('team_people').find((r) => r.id === a.p_person_id && r.tenant_id === a.p_tenant_id);
    if (!person) throw new Error('person_not_found');
    if ((a.p_amount_pence as number) < 1) throw new Error('bad_amount');
    seq += 1;
    const expense = { id: `exp-${seq}`, tenant_id: a.p_tenant_id, category: 'wages', amount: (a.p_amount_pence as number) / 100, merchant: person.name, spent_on: a.p_paid_on };
    db.rows('expenses').push(expense);
    const row = { id: `tp-${seq}`, tenant_id: a.p_tenant_id, person_id: a.p_person_id, amount_pence: a.p_amount_pence, paid_on: a.p_paid_on, note: a.p_note, expense_id: expense.id, client_mutation_id: a.p_client_mutation_id, voided_at: null };
    db.rows('team_payments').push(row);
    return row.id;
  };
  db.rpcHandlers.void_team_payment = (a) => {
    const row = db.rows('team_payments').find((r) => r.id === a.p_payment_id && r.tenant_id === a.p_tenant_id && !r.voided_at);
    if (!row) return false;
    row.voided_at = '2026-10-16T09:00:00Z';
    db.tables.expenses = db.rows('expenses').filter((e) => e.id !== row.expense_id);
    return true;
  };
  return db;
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});

const person = (ledger: Awaited<ReturnType<typeof getPayLedger>>, id: string) => ledger.find((p) => p.personId === id)!;

describe('getPayLedger', () => {
  it('adds up days, earned, paid and owed per person', async () => {
    const ledger = await getPayLedger(db.client, T, { from: '2026-10-12', to: '2026-10-18' });
    expect(person(ledger, 'p-dave')).toMatchObject({ daysWorked: 4, earnedPence: 48000, paidPence: 30000, owedPence: 18000, lastPaidOn: '2026-10-14', lastWorkedOn: '2026-10-15' });
    expect(person(ledger, 'h-lee')).toMatchObject({ daysWorked: 3, earnedPence: 27000, paidPence: 0, owedPence: 27000 });
  });

  it('ignores voided payments and other businesses’ people', async () => {
    const ledger = await getPayLedger(db.client, T);
    expect(ledger.map((p) => p.personId)).not.toContain('p-other');
    expect(person(ledger, 'p-dave').paidPence).toBe(30000); // the voided £999 is not counted
  });

  it('uses the same range for earned and paid, and includes everyone, active first, leads before helpers', async () => {
    const week = await getPayLedger(db.client, T, { from: '2026-10-12', to: '2026-10-18' });
    expect(week.map((p) => p.name)).toEqual(['Dave', 'Lee', 'Gone']);
    expect(person(week, 'h-gone')).toMatchObject({ daysWorked: 0, earnedPence: 0, owedPence: 0, active: false });
    const all = await getPayLedger(db.client, T);
    expect(person(all, 'p-dave')).toMatchObject({ daysWorked: 5, earnedPence: 59000, owedPence: 29000 });
    expect(person(all, 'h-gone').owedPence).toBe(5000); // an ended person is still owed
  });

  it('a rate change later does not rewrite old days (each day keeps its own rate)', async () => {
    db.rows('team_people').find((p) => p.id === 'p-dave')!.day_rate_pence = 13000;
    expect(person(await getPayLedger(db.client, T), 'p-dave').earnedPence).toBe(59000);
  });

  it('shows paid ahead as a negative owed figure, never an error', async () => {
    db.rows('team_payments').push({ id: 'big', tenant_id: T, person_id: 'h-lee', paid_on: '2026-10-15', amount_pence: 50000, voided_at: null });
    expect(person(await getPayLedger(db.client, T, { from: '2026-10-12', to: '2026-10-18' }), 'h-lee').owedPence).toBe(-23000);
  });
});

describe('statements and the week', () => {
  it('lists a person’s days (with who the helper was with) and payments, newest first', async () => {
    const s = await getPersonStatement(db.client, T, 'h-lee', { from: '2026-10-12', to: '2026-10-18' });
    expect(s?.days.map((d) => d.date)).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    expect(s?.days[0]).toMatchObject({ withName: 'Dave', ratePence: 9000, role: 'helper', source: 'start_day' });
    const dave = await getPersonStatement(db.client, T, 'p-dave');
    expect(dave?.payments.map((p) => [p.id, p.voided])).toEqual([['pay2', true], ['pay1', false]]);
  });

  it('is null for another business’s person', async () => {
    expect(await getPersonStatement(db.client, T, 'p-other')).toBeNull();
  });

  it('this week: Dave 4 days £480, Lee 3 days £270', async () => {
    expect(await weekSummary(db.client, T, '2026-10-12')).toEqual([
      { name: 'Dave', days: 4, earnedPence: 48000 },
      { name: 'Lee', days: 3, earnedPence: 27000 },
    ]);
  });
});

describe('recording and voiding a payment', () => {
  const base = { tenantId: T, userId: 'owner', today: TODAY };

  it('makes the payment and its wages expense together', async () => {
    const r = await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 18000, paidOn: '2026-10-16', note: ' Friday ' });
    expect(r.ok).toBe(true);
    expect(db.rows('expenses')).toHaveLength(1);
    expect(db.rows('expenses')[0]).toMatchObject({ category: 'wages', amount: 180, merchant: 'Dave' });
    expect(db.rpcCalls[0].args).toMatchObject({ p_amount_pence: 18000, p_note: 'Friday', p_user_id: 'owner' });
  });

  it('a retry with the same key makes one payment and one expense', async () => {
    const a = await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 100, paidOn: TODAY, clientMutationId: 'key-12345678' });
    const b = await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 100, paidOn: TODAY, clientMutationId: 'key-12345678' });
    expect(a).toEqual(b);
    expect(db.rows('expenses')).toHaveLength(1);
  });

  it('refuses bad amounts, a date too far ahead, and a person who is not this business’s', async () => {
    expect((await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 0, paidOn: TODAY })).ok).toBe(false);
    expect((await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 10_000_001, paidOn: TODAY })).ok).toBe(false);
    expect((await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 100, paidOn: '2026-10-20' }))).toEqual({ ok: false, error: 'The date can’t be in the future.' });
    expect(await recordTeamPayment(db.client, { ...base, personId: 'p-other', amountPence: 100, paidOn: TODAY })).toEqual({ ok: false, error: 'Not found.' });
    expect(db.rows('expenses')).toHaveLength(0);
  });

  it('voiding removes the expense, keeps the payment (greyed), and a second void says so', async () => {
    const r = await recordTeamPayment(db.client, { ...base, personId: 'p-dave', amountPence: 18000, paidOn: TODAY });
    if (!r.ok) throw new Error('expected ok');
    expect(await voidTeamPayment(db.client, { tenantId: T, userId: 'owner', paymentId: r.paymentId })).toEqual({ ok: true });
    expect(db.rows('expenses')).toHaveLength(0);
    expect(db.rows('team_payments').find((p) => p.id === r.paymentId)!.voided_at).not.toBeNull();
    expect(await voidTeamPayment(db.client, { tenantId: T, userId: 'owner', paymentId: r.paymentId })).toEqual({ ok: false, error: 'Already voided.' });
  });
});

describe('fixing a day', () => {
  it('adds a missed day at the person’s rate, or a smaller amount for a half day', async () => {
    const full = await addWorkDay(db.client, { tenantId: T, personId: 'p-dave', date: '2026-10-16', today: TODAY });
    expect(full.ok).toBe(true);
    expect(db.rows('work_days').find((d) => d.work_date === '2026-10-16')).toMatchObject({ rate_pence: 12000, source: 'manual', role: 'lead' });
    const half = await addWorkDay(db.client, { tenantId: T, personId: 'h-lee', date: '2026-10-16', ratePence: 4500, today: TODAY });
    expect(half.ok).toBe(true);
    expect(db.rows('work_days').find((d) => d.person_id === 'h-lee' && d.work_date === '2026-10-16')).toMatchObject({ rate_pence: 4500, role: 'helper' });
  });

  it('refuses a duplicate day, a day in the future and a person from another business', async () => {
    expect(await addWorkDay(db.client, { tenantId: T, personId: 'p-dave', date: '2026-10-12', today: TODAY })).toEqual({ ok: false, error: 'Dave already has a day on 2026-10-12. Edit that one.' });
    expect((await addWorkDay(db.client, { tenantId: T, personId: 'p-dave', date: '2026-10-17', today: TODAY })).ok).toBe(false);
    expect(await addWorkDay(db.client, { tenantId: T, personId: 'p-other', date: '2026-10-16', today: TODAY })).toEqual({ ok: false, error: 'Not found.' });
  });

  it('changes a day to a half day, and removes a wrong one (only inside this business)', async () => {
    expect(await updateWorkDay(db.client, { tenantId: T, id: 'd0', ratePence: 6000 })).toEqual({ ok: true });
    expect(db.rows('work_days').find((d) => d.id === 'd0')!.rate_pence).toBe(6000);
    expect(await updateWorkDay(db.client, { tenantId: 'other', id: 'd0', ratePence: 1 })).toEqual({ ok: false, error: 'Not found.' });
    expect(await updateWorkDay(db.client, { tenantId: T, id: 'd0', ratePence: -5 })).toMatchObject({ ok: false });
    expect(await removeWorkDay(db.client, { tenantId: T, id: 'd1' })).toEqual({ ok: true });
    expect(db.rows('work_days').some((d) => d.id === 'd1')).toBe(false);
    expect(await removeWorkDay(db.client, { tenantId: 'other', id: 'd2' })).toEqual({ ok: false, error: 'Not found.' });
  });
});

describe('the wages line is changed on the Team page, not on Expenses', () => {
  it('recognises an expense made by a team payment, until it is voided', async () => {
    const r = await recordTeamPayment(db.client, { tenantId: T, userId: 'o', personId: 'p-dave', amountPence: 5000, paidOn: TODAY, today: TODAY });
    if (!r.ok) throw new Error('expected ok');
    const expenseId = db.rows('expenses')[0].id as string;
    expect(await expenseIsTeamPay(db.client, T, expenseId)).toBe(true);
    expect(await expenseIsTeamPay(db.client, T, 'some-other-expense')).toBe(false);
    expect(await expenseIsTeamPay(db.client, 'other', expenseId)).toBe(false);
  });

  it('the expense save and delete cores refuse it, and still work for ordinary expenses', async () => {
    await recordTeamPayment(db.client, { tenantId: T, userId: 'o', personId: 'p-dave', amountPence: 5000, paidOn: TODAY, today: TODAY });
    const wages = db.rows('expenses')[0].id as string;
    const values = { expenseId: wages, spentOn: TODAY, merchant: 'x', category: 'wages', amount: 1 } as never;
    expect(await saveExpenseCore(db.client, { tenantId: T, values })).toEqual({ ok: false, error: TEAM_PAY_EXPENSE_MESSAGE });
    expect(await deleteExpenseCore(db.client, db.client, { tenantId: T, expenseId: wages })).toEqual({ ok: false, error: TEAM_PAY_EXPENSE_MESSAGE });
    expect(db.rows('expenses')).toHaveLength(1);

    db.rows('expenses').push({ id: 'fuel', tenant_id: T, category: 'vehicle', receipt_path: null });
    expect(await deleteExpenseCore(db.client, db.client, { tenantId: T, expenseId: 'fuel' })).toMatchObject({ ok: true });
  });
});
