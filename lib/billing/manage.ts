import 'server-only';

import type Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { getStripe, getAppUrl } from '@/lib/stripe/client';
import { PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import {
  choiceForPriceId,
  classifyChange,
  priceIdFor,
  priceLabel,
  type PlanChoice,
} from '@/lib/billing/plans';

export type CardSummary = { brand: string; last4: string; expMonth: number; expYear: number };
export type InvoiceRow = {
  id: string;
  date: string;
  amountPence: number;
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft';
  pdfUrl: string | null;
  hostedUrl: string | null;
};

export type PlanSummary =
  | { kind: 'managed' }
  | { kind: 'contact_us'; reason: 'multiple_subscriptions' | 'unknown_price' }
  | { kind: 'ended'; lastChoice: PlanChoice | null; endedAt: string | null }
  | {
      kind: 'stripe';
      subscriptionId: string;
      choice: PlanChoice;
      status: 'active' | 'past_due' | 'trialing' | 'incomplete';
      priceLabel: string;
      currentPeriodEnd: string;
      cancelAtPeriodEnd: boolean;
      nextBill: { date: string; amountPence: number } | null;
      discount: { label: string; endsAt: string | null } | null;
      creditPence: number;
      pendingChange: { choice: PlanChoice; effectiveDate: string } | null;
      card: CardSummary | null;
      invoices: InvoiceRow[];
    };

export type ChangePreview =
  | {
      ok: true;
      kind: 'up_now';
      target: PlanChoice;
      todayPence: number;
      thenLabel: string;
      effectiveDate: string;
      /** When the next full bill is due. After a monthly to yearly switch Stripe keeps the original
       *  anniversary, so this is the end of the time charged now, not the old monthly renewal. */
      renewsOn: string;
    }
  | { ok: true; kind: 'down_at_renewal'; target: PlanChoice; todayPence: 0; thenLabel: string; effectiveDate: string }
  | { ok: false; error: string };

export type ChangeResult =
  | { ok: true; applied: 'now' | 'at_renewal' }
  | { ok: true; needsAction: { hostedInvoiceUrl: string } }
  | { ok: false; error: string; preview?: ChangePreview };

const LIVE_STATUSES = new Set(['active', 'past_due', 'trialing', 'incomplete']);
const INVOICE_STATUSES = new Set(['paid', 'open', 'void', 'uncollectible', 'draft']);
const PRO_TIERS = new Set<string>(PRO_TIER_PRODUCTS);

const MANAGED_ERROR = 'Your plan is managed by WorkWise. Contact us to make changes.';
const CONTACT_US = 'Contact us to change your plan.';
const ENDED_ERROR = 'Your plan has ended.';
const UNDO_FIRST = 'Undo your cancellation first.';
const UPDATE_CARD = 'Update your card first, then you can change your plan.';
const NOT_OFFERED = 'That change isn’t available here. Contact us and we’ll sort it.';
const YEARLY_AFTER_OFFER = 'You can switch to yearly once your current offer has finished.';
const CANCEL_WAITING = "Cancel the change that's waiting, then you can upgrade.";
const AMOUNT_CHANGED = 'The amount has changed. Please check it and confirm again.';
const CHANGE_ERROR = "Couldn't change your plan. Nothing was charged. Please try again.";

type SubRow = { source: string | null; product: string | null };

type Account = { kind: 'managed' } | { kind: 'stripe'; customerId: string };

type Ready = {
  kind: 'ready';
  customerId: string;
  subscription: Stripe.Subscription;
  choice: PlanChoice;
  priceId: string;
  itemId: string;
  periodEnd: number;
};

type Loaded =
  | { kind: 'managed' }
  | { kind: 'contact_us'; reason: 'multiple_subscriptions' | 'unknown_price' }
  | { kind: 'ended'; lastChoice: PlanChoice | null; endedAt: string | null }
  | Ready;

function logStripe(scope: string, err: unknown) {
  const name = err instanceof Error ? err.name : 'Error';
  console.error(`[billing] ${scope}`, name);
}

function iso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

function dayMonth(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(unixSeconds * 1000)
  );
}

function periodEndUnix(subscription: Stripe.Subscription): number | null {
  const item = subscription.items?.data?.[0];
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  return item?.current_period_end ?? legacy ?? null;
}

function priceIdOf(price: string | { id?: string } | null | undefined): string | null {
  if (!price) return null;
  return typeof price === 'string' ? price : price.id ?? null;
}

function subscriptionPriceId(subscription: Stripe.Subscription): string | null {
  return priceIdOf(subscription.items?.data?.[0]?.price);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/** Admin of a self-serve business only; otherwise { kind: 'managed' }. */
export async function getPlanSummary(tenantId: string): Promise<PlanSummary> {
  if (!(await currentUserIsAdminOf(tenantId))) return { kind: 'managed' };
  const loaded = await loadBilling(tenantId);
  if (loaded.kind === 'managed') return { kind: 'managed' };
  if (loaded.kind === 'contact_us') return loaded;
  if (loaded.kind === 'ended') return loaded;
  return enrich(loaded);
}

export async function previewPlanChange(tenantId: string, target: PlanChoice): Promise<ChangePreview> {
  try {
    const loaded = await loadBilling(tenantId);
    return previewLoaded(loaded, target);
  } catch (err) {
    logStripe('previewPlanChange', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

/** `expectedTodayPence` = what the confirm dialog showed; `nonce` = a uuid made when the dialog opened. */
export async function changePlan(
  tenantId: string,
  target: PlanChoice,
  expectedTodayPence: number,
  nonce: string
): Promise<ChangeResult> {
  if (typeof nonce !== 'string' || nonce.length === 0 || !Number.isFinite(expectedTodayPence)) {
    return { ok: false, error: CHANGE_ERROR };
  }
  try {
    const loaded = await loadBilling(tenantId);
    const preview = await previewLoaded(loaded, target);
    if (!preview.ok) return { ok: false, error: preview.error };
    if (Math.abs(preview.todayPence - expectedTodayPence) > 1) {
      return { ok: false, error: AMOUNT_CHANGED, preview };
    }
    if (loaded.kind !== 'ready') return { ok: false, error: CHANGE_ERROR };
    if (preview.kind === 'up_now') return await applyUpgrade(loaded, target, nonce);
    return await applyDowngrade(loaded, target, nonce);
  } catch (err) {
    logStripe('changePlan', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

export async function cancelPendingChange(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const loaded = await loadBilling(tenantId);
    const denied = denyAccount(loaded);
    if (denied) return denied;
    if (loaded.kind !== 'ready') return { ok: false, error: CHANGE_ERROR };
    if (loaded.subscription.cancel_at_period_end) return { ok: false, error: UNDO_FIRST };
    const scheduleId = await activeScheduleId(loaded.subscription);
    if (scheduleId) await getStripe().subscriptionSchedules.release(scheduleId);
    return { ok: true };
  } catch (err) {
    logStripe('cancelPendingChange', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

export async function cancelPlan(tenantId: string): Promise<{ ok: true; endsOn: string } | { ok: false; error: string }> {
  try {
    const loaded = await loadBilling(tenantId);
    const denied = denyAccount(loaded);
    if (denied) return denied;
    if (loaded.kind !== 'ready') return { ok: false, error: CHANGE_ERROR };
    if (loaded.subscription.cancel_at_period_end) {
      return { ok: true, endsOn: new Date(loaded.periodEnd * 1000).toISOString() };
    }
    const scheduleId = await activeScheduleId(loaded.subscription);
    if (scheduleId) await getStripe().subscriptionSchedules.release(scheduleId);
    const updated = await getStripe().subscriptions.update(loaded.subscription.id, { cancel_at_period_end: true });
    const ends = periodEndUnix(updated) ?? loaded.periodEnd;
    return { ok: true, endsOn: new Date(ends * 1000).toISOString() };
  } catch (err) {
    logStripe('cancelPlan', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

export async function undoCancel(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const loaded = await loadBilling(tenantId);
    const denied = denyAccount(loaded);
    if (denied) return denied;
    if (loaded.kind !== 'ready') return { ok: false, error: CHANGE_ERROR };
    if (loaded.subscription.cancel_at_period_end) {
      await getStripe().subscriptions.update(loaded.subscription.id, { cancel_at_period_end: false });
    }
    return { ok: true };
  } catch (err) {
    logStripe('undoCancel', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

/** Billing portal session opened at the card form (STRIPE_PORTAL_CONFIGURATION_ID). */
export async function cardUpdateUrl(tenantId: string): Promise<string> {
  const account = await loadAccount(tenantId);
  if (account.kind === 'managed') throw new Error(MANAGED_ERROR);
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  const session = await getStripe().billingPortal.sessions.create({
    customer: account.customerId,
    return_url: `${getAppUrl()}/settings?tab=billing`,
    flow_data: { type: 'payment_method_update' },
    ...(configuration ? { configuration } : {}),
  });
  return session.url;
}

async function currentUserIsAdminOf(tenantId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return false;
    const { data, error } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).maybeSingle();
    if (error || data?.role !== 'admin' || data.tenant_id !== tenantId) return false;
    return true;
  } catch (err) {
    console.error('[billing] admin', err instanceof Error ? err.name : 'Error');
    return false;
  }
}

async function loadAccount(tenantId: string): Promise<Account> {
  const supabase = await createClient();
  const [{ data: tenant, error: tenantError }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
    supabase.from('subscriptions').select('source, product').eq('tenant_id', tenantId),
  ]);
  if (tenantError || rowsError) {
    console.error('[billing] account', 'read_failed');
    throw new Error('Could not read the plan.');
  }
  const customerId = tenant?.stripe_customer_id;
  const list = (rows ?? []) as SubRow[];
  const blocked = list.some((row) => row.source === 'manual' || (row.product != null && PRO_TIERS.has(row.product)));
  if (!customerId || blocked) return { kind: 'managed' };
  return { kind: 'stripe', customerId };
}

async function loadBilling(tenantId: string): Promise<Loaded> {
  const account = await loadAccount(tenantId);
  if (account.kind === 'managed') return account;
  try {
    const stripe = getStripe();
    const listed = await stripe.subscriptions.list({ customer: account.customerId, status: 'all', limit: 10 });
    const live = listed.data.filter((subscription) => LIVE_STATUSES.has(subscription.status));
    if (live.length >= 2) return { kind: 'contact_us', reason: 'multiple_subscriptions' };
    if (live.length === 0) return endedSummary(listed.data);
    let subscription = live[0];
    try {
      subscription = await stripe.subscriptions.retrieve(subscription.id, {
        expand: ['default_payment_method', 'schedule', 'discounts'],
      });
    } catch (err) {
      logStripe('subscriptions.retrieve', err);
    }
    const priceId = subscriptionPriceId(subscription);
    const choice = choiceForPriceId(priceId);
    const itemId = subscription.items?.data?.[0]?.id;
    if (!priceId || !choice || !itemId) return { kind: 'contact_us', reason: 'unknown_price' };
    const status = subscription.status;
    if (status !== 'active' && status !== 'past_due' && status !== 'trialing' && status !== 'incomplete') {
      return endedSummary([subscription]);
    }
    return {
      kind: 'ready',
      customerId: account.customerId,
      subscription,
      choice,
      priceId,
      itemId,
      periodEnd: periodEndUnix(subscription) ?? 0,
    };
  } catch (err) {
    logStripe('subscriptions.list', err);
    throw err;
  }
}

function endedSummary(subscriptions: Stripe.Subscription[]): { kind: 'ended'; lastChoice: PlanChoice | null; endedAt: string | null } {
  const latest = [...subscriptions].sort((a, b) => (b.ended_at ?? b.canceled_at ?? 0) - (a.ended_at ?? a.canceled_at ?? 0))[0];
  if (!latest) return { kind: 'ended', lastChoice: null, endedAt: null };
  return {
    kind: 'ended',
    lastChoice: choiceForPriceId(subscriptionPriceId(latest)),
    endedAt: iso(latest.ended_at ?? latest.canceled_at),
  };
}

function denyAccount(loaded: Loaded): { ok: false; error: string } | null {
  if (loaded.kind === 'managed') return { ok: false, error: MANAGED_ERROR };
  if (loaded.kind === 'contact_us') return { ok: false, error: CONTACT_US };
  if (loaded.kind === 'ended') return { ok: false, error: ENDED_ERROR };
  return null;
}

function denyChange(loaded: Loaded): { ok: false; error: string } | null {
  const account = denyAccount(loaded);
  if (account) return account;
  if (loaded.kind !== 'ready') return { ok: false, error: CHANGE_ERROR };
  if (loaded.subscription.status === 'past_due') return { ok: false, error: UPDATE_CARD };
  if (loaded.subscription.cancel_at_period_end) return { ok: false, error: UNDO_FIRST };
  if (!loaded.periodEnd) return { ok: false, error: CHANGE_ERROR };
  return null;
}

async function previewLoaded(loaded: Loaded, target: PlanChoice): Promise<ChangePreview> {
  const denied = denyChange(loaded);
  if (denied) return denied;
  if (loaded.kind !== 'ready') return { ok: false, error: CHANGE_ERROR };
  const kind = classifyChange(loaded.choice, target);
  if (kind === 'same' || kind === 'not_offered') return { ok: false, error: NOT_OFFERED };
  // Yearly is billed in full the moment they switch, so a half-price or free-month
  // offer still on the subscription would discount a whole year. Wait for it to end.
  if (loaded.choice.interval === 'month' && target.interval === 'year' && hasActiveDiscount(loaded.subscription)) {
    return { ok: false, error: YEARLY_AFTER_OFFER };
  }
  const thenLabel = priceLabel(target);
  if (kind === 'up_now' && (await activeScheduleId(loaded.subscription))) {
    return { ok: false, error: CANCEL_WAITING };
  }
  if (kind === 'down_at_renewal') {
    return {
      ok: true,
      kind: 'down_at_renewal',
      target,
      todayPence: 0,
      thenLabel,
      effectiveDate: new Date(loaded.periodEnd * 1000).toISOString(),
    };
  }
  const preview = await getStripe().invoices.createPreview({
    customer: loaded.customerId,
    subscription: loaded.subscription.id,
    subscription_details: {
      items: [{ id: loaded.itemId, price: priceIdFor(target) }],
      proration_behavior: 'always_invoice',
    },
  });
  const renewsOn = loaded.choice.interval === target.interval ? loaded.periodEnd : latestChargedPeriodEnd(preview) ?? loaded.periodEnd;
  return {
    ok: true,
    kind: 'up_now',
    target,
    todayPence: preview.amount_due,
    thenLabel,
    effectiveDate: new Date().toISOString(),
    renewsOn: new Date(renewsOn * 1000).toISOString(),
  };
}

/** End of the latest period that is being charged on this preview (the new plan's first bill covers up to it). */
function latestChargedPeriodEnd(preview: Stripe.Invoice): number | null {
  const ends = (preview.lines?.data ?? [])
    .filter((line) => (line.amount ?? 0) > 0 && line.period?.end)
    .map((line) => line.period.end);
  return ends.length > 0 ? Math.max(...ends) : null;
}

/** Any discount still on the subscription. An unexpanded id counts as active (fail closed). */
function hasActiveDiscount(subscription: Stripe.Subscription): boolean {
  const nowSeconds = Date.now() / 1000;
  return (subscription.discounts ?? []).some((entry) => {
    if (typeof entry === 'string') return true;
    return entry.end == null || entry.end > nowSeconds;
  });
}

async function applyUpgrade(loaded: Ready, target: PlanChoice, nonce: string): Promise<ChangeResult> {
  if (await activeScheduleId(loaded.subscription)) return { ok: false, error: CANCEL_WAITING };
  const updated = await getStripe().subscriptions.update(
    loaded.subscription.id,
    {
      items: [{ id: loaded.itemId, price: priceIdFor(target) }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice'],
    },
    { idempotencyKey: `plan-change-${nonce}` }
  );
  if (!updated.pending_update) return { ok: true, applied: 'now' };
  const hostedInvoiceUrl = await hostedUrl(updated.latest_invoice);
  if (hostedInvoiceUrl) return { ok: true, needsAction: { hostedInvoiceUrl } };
  return { ok: false, error: CHANGE_ERROR };
}

async function applyDowngrade(loaded: Ready, target: PlanChoice, nonce: string): Promise<ChangeResult> {
  const stripe = getStripe();
  const existing = await activeSchedule(loaded.subscription);
  const schedule = existing ?? (await stripe.subscriptionSchedules.create({ from_subscription: loaded.subscription.id }));
  const phase0 = currentPhase(schedule);
  if (!phase0) throw new Error('Schedule has no current phase');
  const newPriceId = priceIdFor(target);
  await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          items: [{ price: loaded.priceId, quantity: 1 }],
          start_date: phase0.start_date,
          end_date: loaded.periodEnd,
          discounts: phaseDiscounts(phase0, loaded.subscription),
          proration_behavior: 'none',
        },
        {
          items: [{ price: newPriceId, quantity: 1 }],
          duration: { interval: target.interval, interval_count: 1 },
          discounts: carriedDiscounts(phase0, loaded.subscription, loaded.periodEnd),
          proration_behavior: 'none',
        },
      ],
    },
    { idempotencyKey: `plan-change-${nonce}` }
  );
  return { ok: true, applied: 'at_renewal' };
}

async function hostedUrl(invoice: Stripe.Subscription['latest_invoice']): Promise<string | null> {
  if (!invoice) return null;
  if (typeof invoice !== 'string') return invoice.hosted_invoice_url ?? null;
  try {
    const full = await getStripe().invoices.retrieve(invoice);
    return full.hosted_invoice_url ?? null;
  } catch (err) {
    logStripe('invoices.retrieve', err);
    return null;
  }
}

async function activeSchedule(subscription: Stripe.Subscription): Promise<Stripe.SubscriptionSchedule | null> {
  const schedule = subscription.schedule;
  if (!schedule) return null;
  const full = typeof schedule === 'string' ? await getStripe().subscriptionSchedules.retrieve(schedule) : schedule;
  if (full.status !== 'active' && full.status !== 'not_started') return null;
  return full;
}

async function activeScheduleId(subscription: Stripe.Subscription): Promise<string | null> {
  const schedule = await activeSchedule(subscription);
  return schedule?.id ?? null;
}

function currentPhase(schedule: Stripe.SubscriptionSchedule): Stripe.SubscriptionSchedule.Phase | null {
  const start = schedule.current_phase?.start_date;
  const match = start != null ? schedule.phases.find((phase) => phase.start_date === start) : undefined;
  return match ?? schedule.phases[0] ?? null;
}

type DiscountParam = Stripe.SubscriptionScheduleUpdateParams.Phase.Discount;

function phaseDiscounts(
  phase: Stripe.SubscriptionSchedule.Phase,
  subscription: Stripe.Subscription
): DiscountParam[] | '' {
  const fromPhase = mapPhaseDiscounts(phase.discounts ?? []);
  if (fromPhase.length > 0) return fromPhase;
  const fromSub = (subscription.discounts ?? []).flatMap((discount) =>
    typeof discount === 'string' ? [] : [{ discount: discount.id }]
  );
  return fromSub.length > 0 ? fromSub : '';
}

function mapPhaseDiscounts(discounts: Stripe.SubscriptionSchedule.Phase.Discount[]): DiscountParam[] {
  const out: DiscountParam[] = [];
  for (const discount of discounts) {
    const existing = idOf(discount.discount);
    if (existing) {
      out.push({ discount: existing });
      continue;
    }
    const coupon = idOf(discount.coupon);
    if (coupon) {
      out.push({ coupon });
      continue;
    }
    const promotionCode = idOf(discount.promotion_code);
    if (promotionCode) out.push({ promotion_code: promotionCode });
  }
  return out;
}

/** Carry only a discount whose end is after this period. A null end is a one-time coupon. */
function carriedDiscounts(
  phase: Stripe.SubscriptionSchedule.Phase,
  subscription: Stripe.Subscription,
  periodEnd: number
): DiscountParam[] | '' {
  const out: DiscountParam[] = [];
  const seen = new Set<string>();
  const add = (id: string, end: number | null) => {
    if (end == null || end <= periodEnd) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ discount: id });
  };
  for (const discount of subscription.discounts ?? []) {
    if (typeof discount === 'string') continue;
    add(discount.id, discount.end);
  }
  for (const discount of phase.discounts ?? []) {
    if (!discount.discount || typeof discount.discount === 'string') continue;
    add(discount.discount.id, discount.discount.end);
  }
  return out.length > 0 ? out : '';
}

async function enrich(loaded: Ready): Promise<PlanSummary> {
  const { subscription, customerId, choice } = loaded;
  const [discount, customerBits, nextBill, invoices, schedule] = await Promise.all([
    discountSummary(subscription),
    customerBitsOf(customerId),
    nextBillOf(loaded),
    invoicesOf(customerId),
    scheduleForSummary(subscription),
  ]);
  const card = (await cardFrom(subscription.default_payment_method)) ?? customerBits.card;
  return {
    kind: 'stripe',
    subscriptionId: subscription.id,
    choice,
    status: subscription.status as 'active' | 'past_due' | 'trialing' | 'incomplete',
    priceLabel: priceLabel(choice),
    currentPeriodEnd: loaded.periodEnd ? new Date(loaded.periodEnd * 1000).toISOString() : '',
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    nextBill,
    discount,
    creditPence: customerBits.creditPence,
    pendingChange: pendingChange(schedule, loaded.priceId),
    card,
    invoices,
  };
}

async function scheduleForSummary(subscription: Stripe.Subscription): Promise<Stripe.SubscriptionSchedule | null> {
  try {
    return await activeSchedule(subscription);
  } catch (err) {
    logStripe('subscriptionSchedules.retrieve', err);
    return null;
  }
}

function pendingChange(
  schedule: Stripe.SubscriptionSchedule | null,
  currentPriceId: string
): { choice: PlanChoice; effectiveDate: string } | null {
  if (!schedule) return null;
  const boundary = schedule.current_phase?.end_date;
  if (boundary == null) return null;
  const next = schedule.phases.find((phase) => phase.start_date >= boundary);
  if (!next) return null;
  const priceId = priceIdOf(next.items[0]?.price);
  if (!priceId || priceId === currentPriceId) return null;
  const choice = choiceForPriceId(priceId);
  if (!choice) return null;
  return { choice, effectiveDate: new Date(next.start_date * 1000).toISOString() };
}

async function nextBillOf(loaded: Ready): Promise<{ date: string; amountPence: number } | null> {
  if (loaded.subscription.cancel_at_period_end) return null;
  try {
    const preview = await getStripe().invoices.createPreview({
      customer: loaded.customerId,
      subscription: loaded.subscription.id,
    });
    const when = preview.next_payment_attempt ?? preview.period_end;
    return { date: new Date(when * 1000).toISOString(), amountPence: preview.amount_due };
  } catch (err) {
    logStripe('invoices.createPreview', err);
    return null;
  }
}

async function invoicesOf(customerId: string): Promise<InvoiceRow[]> {
  try {
    const listed = await getStripe().invoices.list({ customer: customerId, limit: 12 });
    return listed.data
      .map(invoiceRow)
      .filter((row): row is InvoiceRow => row !== null)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 12);
  } catch (err) {
    logStripe('invoices.list', err);
    return [];
  }
}

function invoiceRow(invoice: Stripe.Invoice): InvoiceRow | null {
  const status = invoice.status;
  if (!status || !INVOICE_STATUSES.has(status)) return null;
  return {
    id: invoice.id ?? '',
    date: new Date((invoice.created ?? 0) * 1000).toISOString(),
    amountPence: invoice.total,
    status: status as InvoiceRow['status'],
    pdfUrl: invoice.invoice_pdf ?? null,
    hostedUrl: invoice.hosted_invoice_url ?? null,
  };
}

async function customerBitsOf(customerId: string): Promise<{ creditPence: number; card: CardSummary | null }> {
  try {
    const customer = await getStripe().customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if ('deleted' in customer && customer.deleted) return { creditPence: 0, card: null };
    const creditPence = customer.balance < 0 ? -customer.balance : 0;
    const card = await cardFrom(customer.invoice_settings?.default_payment_method);
    return { creditPence, card };
  } catch (err) {
    logStripe('customers.retrieve', err);
    return { creditPence: 0, card: null };
  }
}

async function cardFrom(paymentMethod: string | Stripe.PaymentMethod | null | undefined): Promise<CardSummary | null> {
  if (!paymentMethod) return null;
  if (typeof paymentMethod === 'string') {
    try {
      const full = await getStripe().paymentMethods.retrieve(paymentMethod);
      return cardSummary(full);
    } catch (err) {
      logStripe('paymentMethods.retrieve', err);
      return null;
    }
  }
  return cardSummary(paymentMethod);
}

function cardSummary(paymentMethod: Stripe.PaymentMethod): CardSummary | null {
  if (paymentMethod.type !== 'card' || !paymentMethod.card) return null;
  return {
    brand: paymentMethod.card.brand,
    last4: paymentMethod.card.last4,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
  };
}

async function discountSummary(subscription: Stripe.Subscription): Promise<{ label: string; endsAt: string | null } | null> {
  for (const entry of subscription.discounts ?? []) {
    if (typeof entry === 'string') continue;
    const summary = await labelDiscount(entry);
    if (summary) return summary;
  }
  return null;
}

async function labelDiscount(discount: Stripe.Discount): Promise<{ label: string; endsAt: string | null } | null> {
  const coupon = discount.source?.coupon;
  const couponId = idOf(coupon);
  const couponName = coupon && typeof coupon !== 'string' ? coupon.name : null;
  const endsAt = iso(discount.end);
  if (couponId && couponId === process.env.STRIPE_COUPON_FOUNDING) {
    const until = discount.end ? dayMonth(discount.end) : null;
    return { label: until ? `Founding offer: half price until ${until}` : 'Founding offer: half price', endsAt };
  }
  if (couponId && couponId === process.env.STRIPE_COUPON_REFERRAL_MONTH) return { label: 'First month free', endsAt };
  if (couponId && couponId === process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF) return { label: 'Second month half price', endsAt };
  if (couponId && couponId === process.env.STRIPE_COUPON_REFERRAL_YEAR_35) return { label: '£35 off your first year', endsAt };
  if (couponId && couponId === process.env.STRIPE_COUPON_REFERRAL_YEAR_59) return { label: '£59 off your first year', endsAt };
  if (couponName) return { label: couponName, endsAt };
  if (!couponId) return null;
  try {
    const retrieved = await getStripe().coupons.retrieve(couponId);
    return { label: retrieved.name ?? couponId, endsAt };
  } catch (err) {
    logStripe('coupons.retrieve', err);
    return { label: couponId, endsAt };
  }
}
