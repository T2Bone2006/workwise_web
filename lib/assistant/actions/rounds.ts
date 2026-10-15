import 'server-only';

import { z } from 'zod';
import { defineAction, type Executed } from '@/lib/assistant/actions/types';
import type { AssistantCtx } from '@/lib/assistant/caller';
import { asNum, asText, asYmd, dayLabel, friendlyDay, oftenLabel, pounds } from '@/lib/assistant/format';
import { actorForUser } from '@/lib/api/rounds-request';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@/lib/books/categories';
import { getCustomerBalance } from '@/lib/data/payments/owed';
import { addExpenseCore, deleteExpenseCore } from '@/lib/expenses/expenses-core';
import { recordPaymentCore, voidPaymentCore } from '@/lib/payments/money-core';
import { afterManualPayment } from '@/lib/payments/notify';
import { emailPayLinkCore } from '@/lib/payments/pay-link-email';
import { createAgreementCore } from '@/lib/rounds/create-agreement';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { joinHouse } from '@/lib/rounds/house';
import { loadAgreementRow, pauseAgreementCore, resumeAgreementCore } from '@/lib/rounds/pause-agreement';
import { SKIP_REASON_LABELS, USER_SKIP_REASONS, type SkipReason } from '@/lib/rounds/skip-reasons';
import { updateAgreementCore } from '@/lib/rounds/update-agreement';
import {
  moveRemainingWithLog,
  moveStopToDayWithLog,
  skipStopWithLog,
  undoVisitChangeCore,
} from '@/lib/rounds/visit-changes';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import { visitServiceTitle } from '@/lib/rounds/visit-title';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { addExpenseSchema } from '@/lib/validations/expenses';
import { ukPostcodeSchema } from '@/lib/validations/rounds/agreement';

const OPEN = new Set<string>(RESCHEDULE_STATUSES);
const ymd = z.string().refine(isValidYmd, 'Use YYYY-MM-DD');
const NOT_TOLD = "Customers aren't told. You can tell them from the calendar.";

type VisitInfo = { id: string; status: string; date: Ymd | null; customer: string; service: string; price: number | null };

async function loadVisits(ctx: AssistantCtx, ids: string[]): Promise<VisitInfo[] | null> {
  const { data, error } = await ctx.db
    .from('jobs')
    .select('id, status, scheduled_date, quoted_amount, job_description, custom_fields, customers(name)')
    .eq('tenant_id', ctx.tenantId)
    .in('id', ids);
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((j) => {
    const embed = j.customers as { name?: unknown } | { name?: unknown }[] | null;
    const one = Array.isArray(embed) ? embed[0] : embed;
    return {
      id: String(j.id),
      status: String(j.status),
      date: asYmd(j.scheduled_date),
      customer: asText(one?.name) ?? 'Customer',
      service: visitServiceTitle(j as { custom_fields?: unknown; job_description?: string | null }),
      price: asNum(j.quoted_amount),
    };
  });
}

function visitLine(v: VisitInfo, today: Ymd): string {
  const price = v.price != null ? ` ${pounds(v.price)}` : '';
  return `${v.customer} — ${v.service}${price}${v.date ? ` (${friendlyDay(v.date, today)})` : ''}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

async function checkOpenVisits(ctx: AssistantCtx, ids: string[]): Promise<{ ok: true; visits: VisitInfo[] } | { ok: false; error: string }> {
  const unique = [...new Set(ids)];
  const visits = await loadVisits(ctx, unique);
  if (!visits) return { ok: false, error: 'Could not read those visits.' };
  if (visits.length !== unique.length) return { ok: false, error: 'Some of those visit ids are not in this calendar. Look them up again with get_schedule.' };
  const closed = visits.filter((v) => !OPEN.has(v.status));
  if (closed.length > 0) {
    return { ok: false, error: `${closed.map((v) => v.customer).join(', ')}: already done or skipped, so it can't be changed.` };
  }
  return { ok: true, visits };
}

async function undoChange(ctx: AssistantCtx, changeId: string | null) {
  if (!changeId) return { ok: false as const, error: 'Nothing to undo.' };
  const actor = await actorForUser(ctx.db, ctx.userId);
  const r = await undoVisitChangeCore(ctx.db, { tenantId: ctx.tenantId, changeId, actor });
  if (!r.success) return { ok: false as const, error: r.error };
  return {
    ok: true as const,
    result: r.leftAlone > 0 ? `Put ${plural(r.restored, 'visit')} back. ${plural(r.leftAlone, 'visit')} had changed since, so I left them.` : `Put ${plural(r.restored, 'visit')} back.`,
  };
}

// ---------------------------------------------------------------------------

export const moveVisits = defineAction({
  name: 'move_visits',
  description: 'Propose moving booked visits (ids from get_schedule or get_customer) to another day, today or later.',
  product: 'rounds',
  status: 'Getting the move ready',
  schema: z.object({ visit_ids: z.array(z.string().uuid()).min(1).max(60), to_date: ymd }),
  async prepare(ctx, input) {
    if (input.to_date < ctx.today) return { ok: false, error: 'Visits can only move to today or later.' };
    const check = await checkOpenVisits(ctx, input.visit_ids);
    if (!check.ok) return check;
    const moving = check.visits.filter((v) => v.date !== input.to_date);
    if (moving.length === 0) return { ok: false, error: `They are already on ${dayLabel(input.to_date)}.` };
    return {
      ok: true,
      params: { visitIds: moving.map((v) => v.id), toDate: input.to_date },
      preview: {
        title: `Move ${moving.length === 1 ? moving[0]!.customer : plural(moving.length, 'visit')} to ${dayLabel(input.to_date)}`,
        lines: moving.slice(0, 12).map((v) => visitLine(v, ctx.today)).concat(moving.length > 12 ? [`…and ${moving.length - 12} more`] : []),
        confirmLabel: moving.length === 1 ? 'Move it' : 'Move them',
        tone: 'sky',
        note: NOT_TOLD,
        href: `/calendar?view=day&date=${input.to_date}`,
      },
    };
  },
  async execute(ctx, p: { visitIds: string[]; toDate: Ymd }): Promise<Executed> {
    const actor = await actorForUser(ctx.db, ctx.userId);
    const r = await moveStopToDayWithLog(ctx.db, { tenantId: ctx.tenantId, jobIds: p.visitIds, toDate: p.toDate, today: ctx.today, actor });
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: `Moved ${plural(r.moved, 'visit')} to ${dayLabel(p.toDate)}.`, changeId: r.changeId, href: `/calendar?view=day&date=${p.toDate}` };
  },
  undo: (ctx, _p, saved) => undoChange(ctx, saved.changeId),
});

export const skipVisits = defineAction({
  name: 'skip_visits',
  description: 'Propose skipping booked visits this time only; later visits stay booked.',
  product: 'rounds',
  status: 'Getting the skip ready',
  schema: z.object({ visit_ids: z.array(z.string().uuid()).min(1).max(60), reason: z.enum(USER_SKIP_REASONS) }),
  async prepare(ctx, input) {
    const check = await checkOpenVisits(ctx, input.visit_ids);
    if (!check.ok) return check;
    const v = check.visits;
    return {
      ok: true,
      params: { visitIds: v.map((x) => x.id), reason: input.reason },
      preview: {
        title: `Skip ${v.length === 1 ? v[0]!.customer : plural(v.length, 'visit')} — ${SKIP_REASON_LABELS[input.reason as SkipReason].toLowerCase()}`,
        lines: v.slice(0, 12).map((x) => visitLine(x, ctx.today)).concat(v.length > 12 ? [`…and ${v.length - 12} more`] : []),
        confirmLabel: v.length === 1 ? 'Skip it' : 'Skip them',
        tone: 'amber',
        note: `This time only — their next visits stay booked. ${NOT_TOLD}`,
      },
    };
  },
  async execute(ctx, p: { visitIds: string[]; reason: (typeof USER_SKIP_REASONS)[number] }): Promise<Executed> {
    const actor = await actorForUser(ctx.db, ctx.userId);
    const r = await skipStopWithLog(ctx.db, { tenantId: ctx.tenantId, jobIds: p.visitIds, reason: p.reason, actor, notifyCustomers: false });
    if (!r.success) return { ok: false, error: r.error };
    // Same as skipping on the calendar: if the rest of that house was done, its visit-done message goes now.
    const { sendVisitDoneAfterSkip } = await import('@/lib/payments/notify');
    for (const jobId of p.visitIds) {
      await sendVisitDoneAfterSkip(ctx.db, { tenantId: ctx.tenantId, jobId });
    }
    return { ok: true, result: `Skipped ${plural(r.skipped, 'visit')}.`, changeId: r.changeId };
  },
  undo: (ctx, _p, saved) => undoChange(ctx, saved.changeId),
});

export const moveDay = defineAction({
  name: 'move_day',
  description: "Propose moving everything not done on one day to another day (rain, van, running late). Next time round they're back on their usual day.",
  product: 'rounds',
  status: 'Getting the day move ready',
  schema: z.object({ from_date: ymd, to_date: ymd }),
  async prepare(ctx, input) {
    if (input.from_date === input.to_date) return { ok: false, error: 'Pick a different day to move to.' };
    if (input.to_date < ctx.today) return { ok: false, error: 'Visits can only move to today or later.' };
    const { data, error } = await ctx.db
      .from('jobs')
      .select('id, quoted_amount')
      .eq('tenant_id', ctx.tenantId)
      .eq('scheduled_date', input.from_date)
      .in('status', [...RESCHEDULE_STATUSES]);
    if (error) return { ok: false, error: 'Could not read that day.' };
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return { ok: false, error: `Nothing is left to do on ${dayLabel(input.from_date)}.` };
    const worth = rows.reduce((s, r) => s + (asNum(r.quoted_amount) ?? 0), 0);
    const { count } = await ctx.db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('scheduled_date', input.to_date)
      .in('status', [...RESCHEDULE_STATUSES]);
    return {
      ok: true,
      params: { fromDate: input.from_date, toDate: input.to_date },
      preview: {
        title: `Move ${friendlyDay(input.from_date, ctx.today)}'s round to ${dayLabel(input.to_date)}`,
        lines: [
          `${plural(rows.length, 'visit')} still to do, worth ${pounds(worth)}`,
          (count ?? 0) > 0 ? `${dayLabel(input.to_date)} already has ${plural(count ?? 0, 'visit')}; they'll sit together` : `${dayLabel(input.to_date)} is empty at the moment`,
        ],
        confirmLabel: 'Move the day',
        tone: 'sky',
        note: `Done visits stay where they are. Next time round they're back on their usual day. ${NOT_TOLD}`,
        href: `/calendar?view=day&date=${input.to_date}`,
      },
    };
  },
  async execute(ctx, p: { fromDate: Ymd; toDate: Ymd }): Promise<Executed> {
    const actor = await actorForUser(ctx.db, ctx.userId);
    const r = await moveRemainingWithLog(ctx.db, { tenantId: ctx.tenantId, fromDate: p.fromDate, toDate: p.toDate, actor, notifyCustomers: false });
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: `Moved ${plural(r.moved, 'visit')} to ${dayLabel(p.toDate)}.`, changeId: r.changeId, href: `/calendar?view=day&date=${p.toDate}` };
  },
  undo: (ctx, _p, saved) => undoChange(ctx, saved.changeId),
});

// ---------------------------------------------------------------------------

const METHOD_LABELS = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other' } as const;

async function customerName(ctx: AssistantCtx, id: string): Promise<{ name: string; email: string | null; active: boolean } | null> {
  const { data } = await ctx.db.from('customers').select('name, email, is_active').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { name: asText(r.name) ?? 'Customer', email: asText(r.email), active: r.is_active !== false };
}

export const recordPayment = defineAction({
  name: 'record_payment',
  description: 'Propose recording money a customer paid outside WorkWise. Pays off their oldest visits first; their usual thank-you goes if switched on.',
  product: 'rounds',
  status: 'Getting the payment ready',
  schema: z.object({
    customer_id: z.string().uuid(),
    amount: z.number().positive().max(100000),
    method: z.enum(['cash', 'cheque', 'bank_transfer', 'card', 'other']),
    date: ymd.optional(),
    note: z.string().max(200).optional(),
  }),
  async prepare(ctx, input) {
    const c = await customerName(ctx, input.customer_id);
    if (!c) return { ok: false, error: 'No customer with that id.' };
    const date = input.date ?? ctx.today;
    if (date > ctx.today) return { ok: false, error: "A payment can't be in the future." };
    const balance = await getCustomerBalance(ctx.db, ctx.tenantId, input.customer_id);
    const after = balance.owedAmount - input.amount;
    return {
      ok: true,
      params: { customerId: input.customer_id, amount: Math.round(input.amount * 100) / 100, method: input.method, date, note: input.note ?? null },
      preview: {
        title: `${c.name} paid ${pounds(input.amount)}`,
        lines: [
          `${METHOD_LABELS[input.method]}, ${friendlyDay(date, ctx.today)}`,
          balance.owedAmount > 0
            ? after > 0
              ? `They owe ${pounds(balance.owedAmount)}; this leaves ${pounds(after)}`
              : after < 0
                ? `They owe ${pounds(balance.owedAmount)}; the extra ${pounds(-after)} is kept as credit`
                : `This clears the ${pounds(balance.owedAmount)} they owe`
            : `They don't owe anything, so it's kept as credit`,
          ...(input.note ? [`Note: ${input.note}`] : []),
        ],
        confirmLabel: 'Record it',
        tone: 'emerald',
        note: 'Your usual payment thank-you goes to them if it is switched on.',
        href: `/customers/${input.customer_id}`,
      },
    };
  },
  async execute(ctx, p: { customerId: string; amount: number; method: keyof typeof METHOD_LABELS; date: Ymd; note: string | null }, actionId) {
    const r = await recordPaymentCore(ctx.db, {
      tenantId: ctx.tenantId,
      customerId: p.customerId,
      amount: p.amount,
      method: p.method,
      receivedAt: p.date === ctx.today ? null : `${p.date}T12:00:00.000Z`,
      note: p.note,
      clientMutationId: `assistant-${actionId}`,
      userId: ctx.userId,
    });
    if (!r.success) return { ok: false, error: r.error };
    await afterManualPayment(ctx.db, { tenantId: ctx.tenantId, paymentId: r.paymentId, duplicate: r.duplicate });
    return { ok: true, result: `Recorded ${pounds(p.amount)}.`, data: { paymentId: r.paymentId }, href: `/customers/${p.customerId}` };
  },
  async undo(ctx, _p, saved) {
    const paymentId = typeof saved.data.paymentId === 'string' ? saved.data.paymentId : null;
    if (!paymentId) return { ok: false, error: 'Nothing to undo.' };
    const r = await voidPaymentCore(ctx.db, { tenantId: ctx.tenantId, paymentId, reason: 'Undone in the assistant', userId: ctx.userId });
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: 'Payment removed.' };
  },
});

export const addExpense = defineAction({
  name: 'add_expense',
  description: 'Propose saving a business expense.',
  product: 'rounds',
  status: 'Getting the expense ready',
  schema: z.object({
    date: ymd.optional(),
    amount: z.number().positive().max(100000).describe('Total, VAT included.'),
    category: z.enum(EXPENSE_CATEGORIES),
    supplier: z.string().max(120).optional(),
    note: z.string().max(300).optional(),
    vat: z.number().min(0).optional(),
  }),
  async prepare(ctx, input) {
    const date = input.date ?? ctx.today;
    const values = {
      spentOn: date,
      merchant: input.supplier ?? '',
      category: input.category,
      amount: Math.round(input.amount * 100) / 100,
      vatAmount: input.vat ?? null,
      note: input.note ?? '',
    };
    const check = addExpenseSchema.safeParse({ ...values, clientMutationId: 'check-only' });
    if (!check.success) return { ok: false, error: check.error.issues[0]?.message ?? 'That expense is not right.' };
    return {
      ok: true,
      params: values,
      preview: {
        title: `${input.supplier ? `${input.supplier}: ` : ''}${pounds(values.amount)} expense`,
        lines: [
          `${EXPENSE_CATEGORY_LABELS[input.category]}, ${friendlyDay(date, ctx.today)}`,
          ...(input.vat != null ? [`VAT ${pounds(input.vat)}`] : []),
          ...(input.note ? [input.note] : []),
        ],
        confirmLabel: 'Save it',
        tone: 'violet',
        href: '/expenses',
      },
    };
  },
  async execute(ctx, p: { spentOn: Ymd; merchant: string; category: (typeof EXPENSE_CATEGORIES)[number]; amount: number; vatAmount: number | null; note: string }, actionId) {
    const values = addExpenseSchema.parse({ ...p, clientMutationId: `assistant-${actionId}` });
    const r = await addExpenseCore(ctx.db, { tenantId: ctx.tenantId, userId: ctx.userId, values });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: `Saved the ${pounds(p.amount)} expense.`, data: { expenseId: r.expenseId }, href: '/expenses' };
  },
  async undo(ctx, _p, saved) {
    const expenseId = typeof saved.data.expenseId === 'string' ? saved.data.expenseId : null;
    if (!expenseId) return { ok: false, error: 'Nothing to undo.' };
    const r = await deleteExpenseCore(ctx.db, ctx.admin, { tenantId: ctx.tenantId, expenseId });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: 'Expense removed.' };
  },
});

// ---------------------------------------------------------------------------

type NewService = { catalogId: string | null; title: string; price: number; durationMinutes: number; frequencyDays: number; firstVisit: Ymd; preferredWeekday: number | null };
type NewCustomer = { name: string; phone: string | null; email: string | null; address: string; postcode: string; accessNotes: string | null; service: NewService | null };

export const addCustomer = defineAction({
  name: 'add_customer',
  description: "Propose adding a customer, optionally with a regular service (service_id from list_services, or a title and price). Ask for anything essential that's missing.",
  product: 'rounds',
  status: 'Getting the new customer ready',
  schema: z.object({
    name: z.string().min(2).max(120),
    phone: z.string().max(30).optional(),
    email: z.string().email().optional(),
    address: z.string().min(5).max(200).describe('Without the postcode.'),
    postcode: z.string().max(10),
    access_notes: z.string().max(500).optional(),
    service: z
      .object({
        service_id: z.string().uuid().optional(),
        title: z.string().min(2).max(120).optional(),
        price: z.number().min(0).max(100000).optional(),
        every_weeks: z.number().int().min(1).max(52).optional(),
        every_days: z.number().int().min(1).max(365).optional(),
        first_visit: ymd,
        preferred_weekday: z.number().int().min(1).max(7).optional().describe('1 = Mon … 7 = Sun.'),
      })
      .optional(),
  }),
  async prepare(ctx, input) {
    const postcode = ukPostcodeSchema.safeParse(input.postcode);
    if (!postcode.success) return { ok: false, error: `"${input.postcode}" isn't a UK postcode.` };
    let service: NewService | null = null;
    if (input.service) {
      const s = input.service;
      let catalog: { name: string; price: number; minutes: number; days: number | null } | null = null;
      if (s.service_id) {
        const { data } = await ctx.db.from('service_catalog').select('name, default_price, default_duration_minutes, default_frequency_days')
          .eq('tenant_id', ctx.tenantId).eq('id', s.service_id).maybeSingle();
        if (!data) return { ok: false, error: 'That service is not in their price list.' };
        const r = data as Record<string, unknown>;
        catalog = { name: asText(r.name) ?? 'Regular visit', price: asNum(r.default_price) ?? 0, minutes: asNum(r.default_duration_minutes) ?? 30, days: asNum(r.default_frequency_days) };
      }
      const frequencyDays = s.every_days ?? (s.every_weeks ? s.every_weeks * 7 : catalog?.days ?? null);
      if (!frequencyDays) return { ok: false, error: 'How often should the visits be?' };
      const price = s.price ?? catalog?.price;
      if (price == null) return { ok: false, error: 'What do they pay each visit?' };
      if (s.first_visit < ctx.today) return { ok: false, error: 'The first visit has to be today or later.' };
      service = {
        catalogId: s.service_id ?? null,
        title: s.title ?? catalog?.name ?? 'Regular visit',
        price,
        durationMinutes: catalog?.minutes ?? 30,
        frequencyDays,
        firstVisit: s.first_visit,
        preferredWeekday: s.preferred_weekday ?? null,
      };
    }

    const { data: same } = await ctx.db.from('customers').select('id, name').eq('tenant_id', ctx.tenantId).ilike('name', input.name.trim()).limit(3);
    const duplicate = (same ?? []).length > 0;
    const params: NewCustomer = {
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address.trim(),
      postcode: postcode.data,
      accessNotes: input.access_notes?.trim() || null,
      service,
    };
    return {
      ok: true,
      params,
      preview: {
        title: `Add ${params.name}`,
        lines: [
          `${params.address}, ${params.postcode}`,
          [params.phone, params.email].filter(Boolean).join(' · ') || 'No phone or email yet',
          service
            ? `${service.title} ${pounds(service.price)} ${oftenLabel(service.frequencyDays).toLowerCase()}, first visit ${dayLabel(service.firstVisit)}`
            : 'No regular service yet',
          ...(params.accessNotes ? [`Access: ${params.accessNotes}`] : []),
          ...(duplicate ? [`You already have a customer called ${params.name} — this adds another.`] : []),
        ],
        confirmLabel: 'Add them',
        tone: 'sky',
      },
    };
  },
  async execute(ctx, p: NewCustomer): Promise<Executed> {
    const now = new Date().toISOString();
    const { data: customer, error } = await ctx.db
      .from('customers')
      .insert({
        tenant_id: ctx.tenantId,
        name: p.name,
        type: 'individual',
        email: p.email,
        phone: p.phone,
        phone_e164: p.phone ? normalizeUkPhoneE164(p.phone) : null,
        billing_address: joinHouse(p.address, p.postcode),
        access_notes: p.accessNotes,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (error || typeof customer?.id !== 'string') return { ok: false, error: 'Could not add the customer.' };

    if (p.service) {
      const created = await createAgreementCore(ctx.db, {
        tenantId: ctx.tenantId,
        values: {
          customer_id: customer.id,
          service_catalog_id: p.service.catalogId,
          title: p.service.title,
          address: p.address,
          postcode: p.postcode,
          price: p.service.price,
          duration_minutes: p.service.durationMinutes,
          frequency_days: p.service.frequencyDays,
          schedule_mode: 'fixed',
          anchor_date: p.service.firstVisit,
          preferred_weekday: p.service.preferredWeekday,
          preferred_time: null,
          reminder_enabled: true,
          access_notes: p.accessNotes ?? '',
        },
      });
      if (!created.success) {
        await ctx.db.from('customers').delete().eq('id', customer.id).eq('tenant_id', ctx.tenantId);
        return { ok: false, error: created.error };
      }
    }
    return {
      ok: true,
      result: p.service ? `Added ${p.name}; first visit ${dayLabel(p.service.firstVisit)}.` : `Added ${p.name}.`,
      data: { customerId: customer.id },
      href: `/customers/${customer.id}`,
    };
  },
});

// ---------------------------------------------------------------------------

async function agreementWithName(ctx: AssistantCtx, agreementId: string) {
  const a = await loadAgreementRow(ctx.db, ctx.tenantId, agreementId);
  if (!a) return null;
  const c = await customerName(ctx, a.customer_id);
  return { a, name: c?.name ?? 'Customer' };
}

async function bookedVisits(ctx: AssistantCtx, agreementId: string, until: Ymd | null): Promise<number> {
  let q = ctx.db.from('jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId)
    .eq('service_agreement_id', agreementId).in('status', [...RESCHEDULE_STATUSES]).gte('scheduled_date', ctx.today);
  if (until) q = q.lte('scheduled_date', until);
  const { count } = await q;
  return count ?? 0;
}

export const pauseService = defineAction({
  name: 'pause_service',
  description: 'Propose pausing a regular service (agreement_id from get_customer) until a date or until resumed. Booked visits in that time come off.',
  product: 'rounds',
  status: 'Getting the pause ready',
  schema: z.object({ agreement_id: z.string().uuid(), until: ymd.optional().describe('Last paused day; omit for until resumed.') }),
  async prepare(ctx, input) {
    const found = await agreementWithName(ctx, input.agreement_id);
    if (!found) return { ok: false, error: 'No service with that agreement id.' };
    if (found.a.status !== 'active') return { ok: false, error: `That service is already ${found.a.status}.` };
    if (input.until && input.until < ctx.today) return { ok: false, error: 'The pause has to end today or later.' };
    const removing = await bookedVisits(ctx, input.agreement_id, input.until ?? null);
    return {
      ok: true,
      params: { agreementId: input.agreement_id, until: input.until ?? null },
      preview: {
        title: `Pause ${found.name}'s ${found.a.title.toLowerCase()}`,
        lines: [
          input.until ? `Until ${dayLabel(input.until)}, then visits start again` : 'Until you resume it',
          removing > 0 ? `${plural(removing, 'booked visit')} taken off the calendar` : 'No booked visits to take off',
        ],
        confirmLabel: 'Pause it',
        tone: 'amber',
        note: "The customer isn't told.",
        href: `/customers/${found.a.customer_id}`,
      },
    };
  },
  async execute(ctx, p: { agreementId: string; until: Ymd | null }): Promise<Executed> {
    const r = await pauseAgreementCore(ctx.db, { tenantId: ctx.tenantId, agreementId: p.agreementId, pausedUntil: p.until, today: ctx.today });
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: p.until ? `Paused until ${dayLabel(p.until)}.` : 'Paused.', href: `/customers/${r.customerId}` };
  },
});

export const resumeService = defineAction({
  name: 'resume_service',
  description: 'Propose restarting a paused regular service.',
  product: 'rounds',
  status: 'Getting the restart ready',
  schema: z.object({ agreement_id: z.string().uuid() }),
  async prepare(ctx, input) {
    const found = await agreementWithName(ctx, input.agreement_id);
    if (!found) return { ok: false, error: 'No service with that agreement id.' };
    if (found.a.status !== 'paused') return { ok: false, error: `That service isn't paused (it's ${found.a.status}).` };
    return {
      ok: true,
      params: { agreementId: input.agreement_id },
      preview: {
        title: `Restart ${found.name}'s ${found.a.title.toLowerCase()}`,
        lines: [`${pounds(found.a.price)} ${oftenLabel(found.a.frequency_days).toLowerCase()}`, 'Their next visits go back on the calendar'],
        confirmLabel: 'Restart it',
        tone: 'sky',
        href: `/customers/${found.a.customer_id}`,
      },
    };
  },
  async execute(ctx, p: { agreementId: string }): Promise<Executed> {
    const r = await resumeAgreementCore(ctx.db, { tenantId: ctx.tenantId, agreementId: p.agreementId, today: ctx.today });
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: 'Restarted; their visits are back on the calendar.', href: `/customers/${r.customerId}` };
  },
});

export const changePrice = defineAction({
  name: 'change_price',
  description: 'Propose a new price for one regular service. Booked visits not yet done change too.',
  product: 'rounds',
  status: 'Getting the price change ready',
  schema: z.object({ agreement_id: z.string().uuid(), new_price: z.number().min(0).max(100000) }),
  async prepare(ctx, input) {
    const found = await agreementWithName(ctx, input.agreement_id);
    if (!found) return { ok: false, error: 'No service with that agreement id.' };
    if (found.a.status === 'ended') return { ok: false, error: 'That service has ended.' };
    const price = Math.round(input.new_price * 100) / 100;
    if (price === found.a.price) return { ok: false, error: `It's already ${pounds(price)}.` };
    const booked = await bookedVisits(ctx, input.agreement_id, null);
    return {
      ok: true,
      params: { agreementId: input.agreement_id, price },
      preview: {
        title: `${found.name}: ${found.a.title.toLowerCase()} ${pounds(found.a.price)} → ${pounds(price)}`,
        lines: [
          booked > 0 ? `${plural(booked, 'booked visit')} change to ${pounds(price)}` : 'From their next visit',
          `${price > found.a.price ? 'Up' : 'Down'} ${pounds(Math.abs(price - found.a.price))} a visit`,
        ],
        confirmLabel: 'Change it',
        tone: 'emerald',
        note: "The customer isn't told — let them know yourself.",
        href: `/customers/${found.a.customer_id}`,
      },
    };
  },
  async execute(ctx, p: { agreementId: string; price: number }): Promise<Executed> {
    const a = await loadAgreementRow(ctx.db, ctx.tenantId, p.agreementId);
    if (!a) return { ok: false, error: 'That service has gone.' };
    const r = await updateAgreementCore(ctx.db, {
      tenantId: ctx.tenantId,
      agreementId: a.id,
      applyPriceToFuture: true,
      values: {
        customer_id: a.customer_id,
        service_catalog_id: a.service_catalog_id,
        title: a.title,
        address: a.address,
        postcode: a.postcode,
        price: p.price,
        duration_minutes: a.duration_minutes,
        frequency_days: a.frequency_days,
        schedule_mode: a.schedule_mode,
        anchor_date: a.anchor_date,
        preferred_weekday: a.preferred_weekday,
        preferred_time: a.preferred_time,
        default_payment_method: a.default_payment_method,
        reminder_enabled: a.reminder_enabled,
        access_notes: a.access_notes ?? '',
        notes: a.notes ?? '',
      },
    });
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: `Price changed to ${pounds(p.price)}.`, href: `/customers/${a.customer_id}` };
  },
});

export const sendPayLink = defineAction({
  name: 'send_pay_link',
  description: 'Propose emailing a customer their pay link (what they owe and how to pay). Needs an email and money owed.',
  product: 'rounds',
  status: 'Getting the email ready',
  schema: z.object({ customer_id: z.string().uuid() }),
  async prepare(ctx, input) {
    const c = await customerName(ctx, input.customer_id);
    if (!c) return { ok: false, error: 'No customer with that id.' };
    if (!c.email) return { ok: false, error: `${c.name} has no email address on file.` };
    const balance = await getCustomerBalance(ctx.db, ctx.tenantId, input.customer_id);
    if (balance.owedAmount <= 0) return { ok: false, error: `${c.name} doesn't owe anything.` };
    return {
      ok: true,
      params: { customerId: input.customer_id },
      preview: {
        title: `Email ${c.name} their pay link`,
        lines: [
          `To ${c.email}`,
          `They owe ${pounds(balance.owedAmount)} for ${plural(balance.unpaidVisitCount, 'visit')}${balance.oldestUnpaidDate ? `, oldest ${dayLabel(balance.oldestUnpaidDate)}` : ''}`,
        ],
        confirmLabel: 'Send it',
        tone: 'rose',
        href: `/customers/${input.customer_id}`,
      },
    };
  },
  async execute(ctx, p: { customerId: string }): Promise<Executed> {
    const r = await emailPayLinkCore(ctx.db, { tenantId: ctx.tenantId, customerId: p.customerId });
    if (!r.sent) return { ok: false, error: r.error };
    return { ok: true, result: `Sent to ${r.to}.`, href: `/customers/${p.customerId}` };
  },
});

export const ROUNDS_ACTIONS = [
  moveVisits,
  skipVisits,
  moveDay,
  recordPayment,
  addExpense,
  addCustomer,
  pauseService,
  resumeService,
  changePrice,
  sendPayLink,
];
