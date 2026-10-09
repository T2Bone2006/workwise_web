import 'server-only';

import { z } from 'zod';
import type { AssistantCtx } from '@/lib/assistant/caller';
import {
  asNum,
  asText,
  asYmd,
  dayLabel,
  daysAgo,
  friendlyDay,
  oftenLabel,
  pounds,
  searchTerm,
} from '@/lib/assistant/format';
import type {
  AssistantCard,
  CardTone,
  CustomerCard,
  ListCard,
  MapCard,
  ScheduleCard,
  ScheduleStop,
} from '@/lib/assistant/shared';
import { defineTool, ok, toolError, type ToolOutcome } from '@/lib/assistant/tools/types';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@/lib/books/categories';
import { currentMonth, currentTaxYear, periodRange, type Period } from '@/lib/books/periods';
import { loadBooksSummary } from '@/lib/books/summary';
import { listExpenses } from '@/lib/data/expenses';
import { getCustomerBalance, getOwedCustomers } from '@/lib/data/payments/owed';
import { loadComingUp } from '@/lib/data/rounds/coming-up';
import { readAllPages } from '@/lib/data/read-all-pages';
import { addDays, diffDays, isValidYmd, isoWeekday, londonDayBoundsUtc, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { roomDetail, roomForWork, roomHeadline } from '@/lib/rounds/room-for-work';
import { SKIP_REASON_LABELS, type SkipReason } from '@/lib/rounds/skip-reasons';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import { visitServiceTitle } from '@/lib/rounds/visit-title';
import { normalizeUkPostcode, outcodesToLatLng, postcodesToLatLng } from '@/lib/utils/postcode';

const OPEN = new Set<string>(RESCHEDULE_STATUSES);
const HIDDEN = ['pending_send', 'declined'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const ymd = z.string().refine(isValidYmd, 'Use YYYY-MM-DD');

function stopStatus(status: string): ScheduleStop['status'] {
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'skipped';
  if (OPEN.has(status)) return 'to_do';
  return 'other';
}

type AgreementBit = {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'ended';
  address: string | null;
  postcode: string | null;
  price: number;
  frequencyDays: number;
  pausedUntil: Ymd | null;
  lat: number | null;
  lng: number | null;
};

function agreementBits(raw: unknown): AgreementBit[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: AgreementBit[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const id = asText(r.id);
    if (!id) continue;
    const status = r.status === 'paused' ? 'paused' : r.status === 'ended' ? 'ended' : 'active';
    out.push({
      id,
      title: asText(r.title) ?? 'Regular visit',
      status,
      address: asText(r.address),
      postcode: asText(r.postcode),
      price: asNum(r.price) ?? 0,
      frequencyDays: asNum(r.frequency_days) ?? 28,
      pausedUntil: asYmd(r.paused_until),
      lat: asNum(r.lat),
      lng: asNum(r.lng),
    });
  }
  return out;
}

function serviceLine(a: AgreementBit): string {
  const paused = a.status === 'paused' ? (a.pausedUntil ? ` (paused until ${dayLabel(a.pausedUntil)})` : ' (paused)') : '';
  const ended = a.status === 'ended' ? ' (ended)' : '';
  return `${a.title} ${pounds(a.price)} ${oftenLabel(a.frequencyDays).toLowerCase()}${paused}${ended}`;
}

const AGREEMENT_EMBED = 'service_agreements(id, title, status, address, postcode, price, frequency_days, paused_until, lat, lng)';

// ---------------------------------------------------------------------------

export const findCustomers = defineTool({
  name: 'find_customers',
  description: 'Find customers by name, address, postcode, phone or email, or list them by state. Gives the ids other tools need.',
  product: 'rounds',
  status: 'Looking through your customers',
  schema: z.object({
    query: z.string().max(80).optional().describe('Name, address, postcode or phone.'),
    filter: z.enum(['active', 'owes', 'paused', 'inactive', 'all']).optional(),
    show: z.union([z.boolean(), z.enum(['list', 'map'])]).optional(),
  }),
  async run(ctx, input) {
    const term = input.query ? searchTerm(input.query) : '';
    const filter = input.filter ?? 'active';
    const select = `id, name, phone, email, billing_address, is_active, ${AGREEMENT_EMBED}`;

    let byCustomer = ctx.db.from('customers').select(select).eq('tenant_id', ctx.tenantId).order('name').limit(400);
    if (filter === 'inactive') byCustomer = byCustomer.eq('is_active', false);
    else if (filter !== 'all') byCustomer = byCustomer.eq('is_active', true);
    if (term) {
      const like = `%${term}%`;
      byCustomer = byCustomer.or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like},billing_address.ilike.${like}`);
    }

    const [customersRes, owed] = await Promise.all([byCustomer, getOwedCustomers(ctx.db, ctx.tenantId)]);
    if (customersRes.error) return toolError('Could not read customers.');
    const rows = [...((customersRes.data ?? []) as Record<string, unknown>[])];

    if (term) {
      const like = `%${term}%`;
      const { data: agreementHits } = await ctx.db
        .from('service_agreements')
        .select('customer_id')
        .eq('tenant_id', ctx.tenantId)
        .or(`address.ilike.${like},postcode.ilike.${like},title.ilike.${like}`)
        .limit(200);
      const seen = new Set(rows.map((r) => r.id));
      const extraIds = [...new Set((agreementHits ?? []).map((r) => (r as { customer_id: string }).customer_id))].filter(
        (id) => !seen.has(id),
      );
      if (extraIds.length > 0) {
        let extra = ctx.db.from('customers').select(select).eq('tenant_id', ctx.tenantId).in('id', extraIds.slice(0, 200));
        if (filter === 'inactive') extra = extra.eq('is_active', false);
        else if (filter !== 'all') extra = extra.eq('is_active', true);
        const { data } = await extra;
        rows.push(...((data ?? []) as Record<string, unknown>[]));
      }
    }

    const owedById = new Map(owed.rows.map((r) => [r.customerId, r]));
    type Match = { id: string; name: string; phone: string | null; email: string | null; address: string | null; active: boolean; services: AgreementBit[]; owed: number };
    let matches: Match[] = rows.map((r) => {
      const services = agreementBits(r.service_agreements);
      const first = services.find((s) => s.status !== 'ended') ?? services[0];
      return {
        id: String(r.id),
        name: asText(r.name) ?? 'Customer',
        phone: asText(r.phone),
        email: asText(r.email),
        address: first?.address ? `${first.address}, ${first.postcode ?? ''}`.trim() : asText(r.billing_address),
        active: r.is_active !== false,
        services,
        owed: owedById.get(String(r.id))?.owedAmount ?? 0,
      };
    });
    if (filter === 'owes') matches = matches.filter((m) => m.owed > 0);
    if (filter === 'paused') matches = matches.filter((m) => m.services.some((s) => s.status === 'paused'));
    matches.sort((a, b) => a.name.localeCompare(b.name));

    // The card shows the full list or map; Claude only needs enough rows to answer and pick ids.
    const LIMIT = input.show === 'map' ? 10 : 20;
    const shown = matches.slice(0, LIMIT);
    const cards: AssistantCard[] = [];
    if (input.show === 'map' && matches.length > 0) {
      const map = await placeOnMap(
        term ? `Customers matching "${input.query}"` : 'Your customers',
        matches.slice(0, 300).map((m) => {
          const s0 = m.services.find((x) => x.status !== 'ended') ?? m.services[0];
          return {
            id: m.id,
            customer: m.name,
            address: m.address ?? '',
            postcode: s0?.postcode ?? (m.address ? (m.address.match(/[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/i)?.[0] ?? null) : null),
            lat: s0?.lat ?? null,
            lng: s0?.lng ?? null,
            status: m.owed > 0 ? ('other' as const) : ('to_do' as const),
          };
        }),
      );
      if (map) cards.push(map);
    } else if (input.show && shown.length > 0) {
      const card: ListCard = {
        type: 'list',
        title: term ? `Customers matching "${input.query}"` : 'Customers',
        people: true,
        items: shown.slice(0, 25).map((m) => ({
          id: m.id,
          title: m.name,
          subtitle: [m.address, m.services.filter((s) => s.status !== 'ended').map((s) => s.title).join(', ')].filter(Boolean).join(' · '),
          amount: m.owed > 0 ? pounds(m.owed) : undefined,
          tone: m.owed > 0 ? 'rose' : undefined,
          tag: !m.active ? 'Inactive' : m.services.some((s) => s.status === 'paused') ? 'Paused' : undefined,
          href: `/customers/${m.id}`,
        })),
        footer: matches.length > 25 ? `${matches.length - 25} more not shown` : undefined,
      };
      cards.push(card);
    }

    return ok(
      {
        count: matches.length,
        customers: shown.map((m) => ({
          id: m.id,
          name: m.name,
          address: m.address,
          phone: m.phone,
          email: m.email,
          active: m.active,
          owes: m.owed > 0 ? pounds(m.owed) : null,
          services: m.services.map((s) => ({ agreement_id: s.id, summary: serviceLine(s) })),
        })),
        ...(matches.length > LIMIT ? { not_listed: matches.length - LIMIT } : {}),
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

export const getCustomer = defineTool({
  name: 'get_customer',
  description: 'One customer: contact, regular services (agreement ids, price, how often, paused), next and recent visits (visit ids), what they owe, recent payments.',
  product: 'rounds',
  status: 'Opening their details',
  schema: z.object({
    customer_id: z.string().uuid(),
    show: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const { data: c, error } = await ctx.db
      .from('customers')
      .select(`id, name, phone, email, billing_address, is_active, access_notes, notes, payment_terms, ${AGREEMENT_EMBED}`)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', input.customer_id)
      .maybeSingle();
    if (error) return toolError('Could not read the customer.');
    if (!c) return toolError('No customer with that id.');
    const row = c as Record<string, unknown>;

    const jobCols = 'id, status, scheduled_date, scheduled_time, quoted_amount, final_amount, payment_status, skip_reason, job_description, custom_fields, service_agreement_id, completed_at';
    const [upcoming, recent, balance, payments] = await Promise.all([
      ctx.db.from('jobs').select(jobCols).eq('tenant_id', ctx.tenantId).eq('customer_id', input.customer_id)
        .in('status', [...RESCHEDULE_STATUSES]).gte('scheduled_date', ctx.today).order('scheduled_date').limit(6),
      ctx.db.from('jobs').select(jobCols).eq('tenant_id', ctx.tenantId).eq('customer_id', input.customer_id)
        .lte('scheduled_date', ctx.today).not('status', 'in', `(${[...RESCHEDULE_STATUSES, ...HIDDEN].join(',')})`)
        .order('scheduled_date', { ascending: false }).limit(8),
      getCustomerBalance(ctx.db, ctx.tenantId, input.customer_id),
      ctx.db.from('payments').select('amount, method, received_at').eq('tenant_id', ctx.tenantId).eq('customer_id', input.customer_id)
        .eq('status', 'active').order('received_at', { ascending: false }).limit(5),
    ]);

    const services = agreementBits(row.service_agreements);
    const visit = (j: Record<string, unknown>) => {
      const date = asYmd(j.scheduled_date);
      const reason = asText(j.skip_reason) as SkipReason | null;
      return {
        visit_id: String(j.id),
        date,
        day: date ? friendlyDay(date, ctx.today) : null,
        service: visitServiceTitle(j as { custom_fields?: unknown; job_description?: string | null }),
        price: pounds(asNum(j.final_amount) ?? asNum(j.quoted_amount)),
        status: stopStatus(String(j.status)),
        ...(reason ? { skipped_because: SKIP_REASON_LABELS[reason] ?? reason } : {}),
        ...(j.status === 'completed' ? { paid: j.payment_status === 'paid' } : {}),
      };
    };
    const next = ((upcoming.data ?? []) as Record<string, unknown>[]).map(visit);
    const last = ((recent.data ?? []) as Record<string, unknown>[]).map(visit);
    const lastDone = last.find((v) => v.status === 'done');
    const name = asText(row.name) ?? 'Customer';
    const firstService = services.find((s) => s.status !== 'ended');
    const address = firstService?.address ? `${firstService.address}, ${firstService.postcode ?? ''}`.trim() : asText(row.billing_address);

    const cards: AssistantCard[] = [];
    if (input.show) {
      const card: CustomerCard = {
        type: 'customer',
        id: String(row.id),
        name,
        phone: asText(row.phone),
        email: asText(row.email),
        address,
        active: row.is_active !== false,
        owed: balance.owedAmount > 0 ? pounds(balance.owedAmount) : null,
        credit: balance.creditAmount > 0 ? pounds(balance.creditAmount) : null,
        services: services.map((s) => ({
          title: s.title,
          price: pounds(s.price),
          often: oftenLabel(s.frequencyDays),
          status: s.status,
          next: next.find((v) => v.service === s.title)?.date ? dayLabel(next.find((v) => v.service === s.title)!.date!) : null,
        })),
        lastVisit: lastDone?.date ? dayLabel(lastDone.date) : null,
        nextVisit: next[0]?.date ? dayLabel(next[0].date) : null,
        href: `/customers/${String(row.id)}`,
      };
      cards.push(card);
    }

    return ok(
      {
        id: String(row.id),
        name,
        phone: asText(row.phone),
        email: asText(row.email),
        address,
        active: row.is_active !== false,
        access_notes: asText(row.access_notes),
        notes: asText(row.notes),
        sends_invoice: row.payment_terms === 'invoice',
        services: services.map((s) => ({ agreement_id: s.id, status: s.status, summary: serviceLine(s), address: s.address, postcode: s.postcode })),
        owes: pounds(balance.owedAmount),
        unpaid_visits: balance.unpaidVisitCount,
        oldest_unpaid: balance.oldestUnpaidDate,
        credit: balance.creditAmount > 0 ? pounds(balance.creditAmount) : null,
        next_visits: next,
        recent_visits: last,
        recent_payments: ((payments.data ?? []) as Record<string, unknown>[]).map((p) => ({
          amount: pounds(asNum(p.amount)),
          method: p.method,
          date: typeof p.received_at === 'string' ? todayInLondon(new Date(p.received_at)) : null,
        })),
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

type JobRow = Record<string, unknown>;

async function loadJobsInRange(ctx: AssistantCtx, from: Ymd, to: Ymd): Promise<JobRow[]> {
  return readAllPages(
    (a, z2) =>
      ctx.db
        .from('jobs')
        .select('id, status, scheduled_date, scheduled_time, quoted_amount, final_amount, address, postcode, lat, lng, route_position, skip_reason, job_description, custom_fields, customer_id, customers(name)')
        .eq('tenant_id', ctx.tenantId)
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .not('status', 'in', `(${HIDDEN.join(',')})`)
        .order('scheduled_date')
        .order('route_position', { ascending: true, nullsFirst: false })
        .order('id')
        .range(a, z2),
    'Could not read the calendar',
  );
}

function customerName(j: JobRow): string {
  const embed = j.customers as { name?: unknown } | { name?: unknown }[] | null;
  const one = Array.isArray(embed) ? embed[0] : embed;
  return asText(one?.name) ?? 'Customer';
}


type Place = { id: string; customer: string; address: string; postcode: string | null; lat: number | null; lng: number | null; status: ScheduleStop['status'] };

/**
 * Puts places on a map. Ones without a saved position are placed from their
 * postcode, then (if the postcode isn't found) from its area, spread a little
 * so pins don't sit on top of each other. So a map always draws when the
 * postcodes are anywhere near real; anything still unplaced is counted.
 */
async function placeOnMap(title: string, places: Place[], date?: Ymd): Promise<MapCard | null> {
  if (places.length === 0) return null;
  const missing = places.filter((p) => p.lat == null || p.lng == null).map((p) => p.postcode).filter((p): p is string => p != null);
  const exactHits = missing.length > 0 ? await postcodesToLatLng(missing) : new Map<string, { lat: number; lng: number }>();
  const unplaced = missing.filter((pc) => !exactHits.has(normalizeUkPostcode(pc) ?? ''));
  const areas = unplaced.length > 0 ? await outcodesToLatLng(unplaced) : new Map<string, { lat: number; lng: number }>();
  const stops: MapCard['stops'] = [];
  let approximate = 0;
  for (const p of places) {
    let lat = p.lat;
    let lng = p.lng;
    if (lat == null || lng == null) {
      const exact = p.postcode ? exactHits.get(normalizeUkPostcode(p.postcode) ?? '') : undefined;
      const area = !exact && p.postcode ? areas.get((normalizeUkPostcode(p.postcode) ?? p.postcode).split(' ')[0]!.toUpperCase()) : undefined;
      if (exact) {
        lat = exact.lat;
        lng = exact.lng;
      } else if (area) {
        const seed = [...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
        lat = area.lat + (((seed % 1000) / 1000) - 0.5) * 0.008;
        lng = area.lng + ((((seed >> 10) % 1000) / 1000) - 0.5) * 0.012;
        approximate++;
      }
    }
    if (lat == null || lng == null) continue;
    stops.push({ id: p.id, order: stops.length + 1, customer: p.customer, address: p.address, lat, lng, status: p.status });
  }
  if (stops.length === 0) return null;
  return { type: 'map', title, ...(date ? { date } : {}), stops, missing: places.length - stops.length, approximate };
}

/** A day's stops (or the first day with stops in a range) on a map, in round order. */
async function buildMapCard(ctx: AssistantCtx, day: Ymd | null, from: Ymd, byDay: Map<Ymd, JobRow[]>): Promise<MapCard | null> {
  const date = day ?? [...byDay.keys()].sort().find((d) => d >= from) ?? null;
  if (!date) return null;
  const list = byDay.get(date) ?? [];
  return placeOnMap(
    `Round ${friendlyDay(date, ctx.today)}`,
    list.map((j) => ({
      id: String(j.id),
      customer: customerName(j),
      address: [asText(j.address), asText(j.postcode)].filter(Boolean).join(', '),
      postcode: asText(j.postcode),
      lat: asNum(j.lat),
      lng: asNum(j.lng),
      status: stopStatus(String(j.status)),
    })),
    date,
  );
}

export const getSchedule = defineTool({
  name: 'get_schedule',
  description: 'Visits between two dates (up to 6 weeks), day by day in round order: visit ids, customer, address, service, price, done/skipped/to do, day totals.',
  product: 'rounds',
  status: 'Looking at your calendar',
  schema: z.object({
    from: ymd,
    to: ymd,
    show: z.enum(['list', 'map', 'none']).optional().describe('map = one day\'s stops in round order.'),
  }),
  async run(ctx, input) {
    if (input.to < input.from) return toolError('"to" is before "from".');
    if (diffDays(input.from, input.to) > 42) return toolError('Ask for 6 weeks or less at a time.');
    let jobs: JobRow[];
    try {
      jobs = await loadJobsInRange(ctx, input.from, input.to);
    } catch {
      return toolError('Could not read the calendar.');
    }

    const byDay = new Map<Ymd, JobRow[]>();
    for (const j of jobs) {
      const d = asYmd(j.scheduled_date);
      if (!d) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), j]);
    }

    let listed = 0;
    const days = [...byDay.entries()].map(([date, list]) => {
      const planned = list.filter((j) => j.status !== 'cancelled').reduce((s, j) => s + (asNum(j.quoted_amount) ?? 0), 0);
      const done = list.filter((j) => j.status === 'completed');
      const takeStops = listed < 60;
      listed += list.length;
      return {
        date,
        day: friendlyDay(date, ctx.today),
        visits: list.length,
        done: done.length,
        skipped: list.filter((j) => j.status === 'cancelled').length,
        to_do: list.filter((j) => OPEN.has(String(j.status))).length,
        planned: pounds(planned),
        done_value: pounds(done.reduce((s, j) => s + (asNum(j.final_amount) ?? asNum(j.quoted_amount) ?? 0), 0)),
        ...(takeStops
          ? {
              stops: list.map((j) => ({
                visit_id: String(j.id),
                customer: customerName(j),
                customer_id: asText(j.customer_id),
                address: [asText(j.address), asText(j.postcode)].filter(Boolean).join(', '),
                service: visitServiceTitle(j as { custom_fields?: unknown; job_description?: string | null }),
                price: pounds(asNum(j.quoted_amount)),
                status: stopStatus(String(j.status)),
                ...(asText(j.scheduled_time) ? { time: String(j.scheduled_time).slice(0, 5) } : {}),
              })),
            }
          : {}),
      };
    });

    const cards: AssistantCard[] = [];
    const show = input.show ?? 'none';
    if (show === 'list' && days.length > 0) {
      const card: ScheduleCard = {
        type: 'schedule',
        title: input.from === input.to ? `Visits ${friendlyDay(input.from, ctx.today)}` : `Visits ${dayLabel(input.from)} – ${dayLabel(input.to)}`,
        days: days.slice(0, 7).map((d) => ({
          date: d.date,
          label: dayLabel(d.date),
          total: d.planned,
          href: `/calendar?view=day&date=${d.date}`,
          stops: (byDay.get(d.date) ?? []).slice(0, 30).map((j) => ({
            id: String(j.id),
            customer: customerName(j),
            address: [asText(j.address), asText(j.postcode)].filter(Boolean).join(', '),
            service: visitServiceTitle(j as { custom_fields?: unknown; job_description?: string | null }),
            amount: asNum(j.quoted_amount) != null ? pounds(asNum(j.quoted_amount)) : null,
            status: stopStatus(String(j.status)),
            time: asText(j.scheduled_time)?.slice(0, 5) ?? null,
          })),
        })),
        footer: days.length > 7 ? `${days.length - 7} more days not shown` : undefined,
      };
      cards.push(card);
    }
    if (show === 'map') {
      const card = await buildMapCard(ctx, input.from === input.to ? input.from : null, input.from, byDay);
      if (card) cards.push(card);
    }

    return ok(
      {
        from: input.from,
        to: input.to,
        total_visits: jobs.length,
        days,
        ...(days.length === 0 ? { note: 'Nothing booked in these dates.' } : {}),
        ...(listed > 60 ? { note: 'Later days show totals only; ask for fewer days to see every stop.' } : {}),
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

export const whoOwes = defineTool({
  name: 'who_owes',
  description: 'Everyone who owes, biggest first: amount, unpaid visits, days waiting, reminders sent, Direct Debit; plus credit held.',
  product: 'rounds',
  status: 'Checking who owes you',
  schema: z.object({ show: z.boolean().optional() }),
  async run(ctx, input) {
    const owed = await getOwedCustomers(ctx.db, ctx.tenantId);
    if (owed.error) return toolError('Could not read balances.');
    const rows = owed.rows.filter((r) => r.owedAmount > 0).sort((a, b) => b.owedAmount - a.owedAmount);
    const cards: AssistantCard[] = [];
    if (input.show && rows.length > 0) {
      const card: ListCard = {
        type: 'list',
        title: 'Who owes you',
        people: true,
        items: rows.slice(0, 20).map((r) => {
          const waiting = r.oldestUnpaidDate ? daysAgo(r.oldestUnpaidDate, ctx.today) : null;
          return {
            id: r.customerId,
            title: r.name,
            subtitle: [
              `${r.unpaidVisitCount} unpaid visit${r.unpaidVisitCount === 1 ? '' : 's'}`,
              waiting != null ? `oldest ${waiting} day${waiting === 1 ? '' : 's'} ago` : null,
              r.collectingAmount > 0 ? `${pounds(r.collectingAmount)} collecting by Direct Debit` : null,
            ].filter(Boolean).join(' · '),
            amount: pounds(r.owedAmount),
            tone: 'rose' as CardTone,
            tag: waiting != null && waiting > 30 ? 'Over 30 days' : r.chaseStage > 0 ? 'Reminded' : undefined,
            href: `/customers/${r.customerId}`,
          };
        }),
        footer: rows.length > 20 ? `${rows.length - 20} more not shown` : undefined,
        total: { label: 'Owed in total', value: pounds(owed.totalOwed), tone: 'rose' },
      };
      cards.push(card);
    }
    return ok(
      {
        total_owed: pounds(owed.totalOwed),
        customers_owing: rows.length,
        total_credit_held: pounds(owed.totalCredit),
        owing: rows.slice(0, 25).map((r) => ({
          customer_id: r.customerId,
          name: r.name,
          owes: pounds(r.owedAmount),
          unpaid_visits: r.unpaidVisitCount,
          oldest_unpaid: r.oldestUnpaidDate,
          days_waiting: r.oldestUnpaidDate ? daysAgo(r.oldestUnpaidDate, ctx.today) : null,
          reminders_sent: r.chaseStage,
          has_email: Boolean(r.email),
          direct_debit: r.hasDirectDebit,
          collecting_now: r.collectingAmount > 0 ? pounds(r.collectingAmount) : null,
        })),
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

function monthKey(date: Ymd): string {
  return date.slice(0, 7);
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function lastMonths(ctx: AssistantCtx, count: number) {
  const keys: string[] = [];
  let cursor = `${ctx.today.slice(0, 7)}-01`;
  for (let i = 0; i < count; i++) {
    keys.unshift(cursor.slice(0, 7));
    const [y, m] = cursor.split('-').map(Number);
    const prev = m === 1 ? `${y! - 1}-12-01` : `${y}-${String(m! - 1).padStart(2, '0')}-01`;
    cursor = prev;
  }
  const from = `${keys[0]}-01`;
  const [payments, expenses] = await Promise.all([
    readAllPages(
      (a, z2) =>
        ctx.db.from('payments').select('id, amount, refunded_amount, received_at').eq('tenant_id', ctx.tenantId)
          .eq('status', 'active').gte('received_at', londonDayBoundsUtc(from).startIso).order('received_at').order('id').range(a, z2),
      'Could not load payments',
    ),
    readAllPages(
      (a, z2) =>
        ctx.db.from('expenses').select('id, spent_on, amount').eq('tenant_id', ctx.tenantId).eq('status', 'confirmed')
          .gte('spent_on', from).order('spent_on').order('id').range(a, z2),
      'Could not load expenses',
    ),
  ]);
  const totals = new Map(keys.map((k) => [k, { in: 0, out: 0 }]));
  for (const p of payments) {
    const k = monthKey(todayInLondon(new Date(String(p.received_at))));
    const t = totals.get(k);
    if (t) t.in += Math.max(0, (Number(p.amount) || 0) - (Number(p.refunded_amount) || 0));
  }
  for (const e of expenses) {
    const t = totals.get(monthKey(String(e.spent_on)));
    if (t) t.out += Number(e.amount) || 0;
  }
  return keys.map((k) => {
    const t = totals.get(k)!;
    const month = Number(k.slice(5, 7));
    return { key: k, label: `${MONTH_SHORT[month - 1]} ${k.slice(2, 4)}`, moneyIn: Math.round(t.in * 100) / 100, moneyOut: Math.round(t.out * 100) / 100 };
  });
}

export const moneySummary = defineTool({
  name: 'money_summary',
  description: "Money in (payments received) and out (expenses) for a period: what's left, how people paid, spending by category, month by month.",
  product: 'rounds',
  status: 'Adding up your money',
  schema: z.object({
    period: z.enum(['this_month', 'last_month', 'this_tax_year', 'last_tax_year', 'last_6_months', 'last_12_months', 'month']),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM, with period month.'),
    show: z.boolean().optional(),
    chart: z
      .enum(['in_and_out', 'spending_by_category', 'how_they_paid'])
      .optional()
      .describe('Default in_and_out. The others need a month or tax year.'),
  }),
  async run(ctx, input) {
    const cards: AssistantCard[] = [];
    try {
      if (input.period === 'last_6_months' || input.period === 'last_12_months') {
        const months = await lastMonths(ctx, input.period === 'last_6_months' ? 6 : 12);
        const totalIn = months.reduce((s, m) => s + m.moneyIn, 0);
        const totalOut = months.reduce((s, m) => s + m.moneyOut, 0);
        if (input.show) {
          cards.push({
            type: 'stats',
            items: [
              { label: 'Money in', value: pounds(totalIn), tone: 'emerald' },
              { label: 'Money out', value: pounds(totalOut), tone: 'rose' },
              { label: 'Left', value: pounds(totalIn - totalOut), tone: 'sky' },
            ],
          });
          cards.push({
            type: 'bar_chart',
            title: input.period === 'last_6_months' ? 'Last 6 months' : 'Last 12 months',
            series: [
              { key: 'in', label: 'Money in', tone: 'emerald' },
              { key: 'out', label: 'Money out', tone: 'rose' },
            ],
            points: months.map((m) => ({ label: m.label, values: { in: m.moneyIn, out: m.moneyOut } })),
          });
        }
        return ok(
          {
            period: input.period,
            money_in: pounds(totalIn),
            money_out: pounds(totalOut),
            left: pounds(totalIn - totalOut),
            months: months.map((m) => ({ month: m.label, in: pounds(m.moneyIn), out: pounds(m.moneyOut) })),
            note: 'This month is only up to today.',
          },
          { cards },
        );
      }

      let period: Period;
      if (input.period === 'month') {
        if (!input.month) return toolError('Say which month as YYYY-MM.');
        period = { kind: 'month', year: Number(input.month.slice(0, 4)), month: Number(input.month.slice(5, 7)) };
      } else if (input.period === 'this_month') period = currentMonth(ctx.today);
      else if (input.period === 'last_month') period = currentMonth(addDays(`${ctx.today.slice(0, 7)}-01`, -1));
      else if (input.period === 'this_tax_year') period = currentTaxYear(ctx.today);
      else {
        const now = currentTaxYear(ctx.today) as { kind: 'tax_year'; startYear: number };
        period = { kind: 'tax_year', startYear: now.startYear - 1 };
      }
      const s = await loadBooksSummary(ctx.db, { tenantId: ctx.tenantId, period });
      const range = periodRange(period);
      const spent = s.moneyOutByCategory.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
      if (input.show && input.chart === 'spending_by_category') {
        cards.push({
          type: 'bar_chart',
          title: `Spending by category, ${range.label}`,
          series: [{ key: 'out', label: 'Money out', tone: 'rose' }],
          points: spent.map((c) => ({ label: c.label.split(' ')[0]!.replace(/[^A-Za-z]/g, ''), values: { out: c.amount } })),
        });
      } else if (input.show && input.chart === 'how_they_paid') {
        cards.push({
          type: 'bar_chart',
          title: `How people paid, ${range.label}`,
          series: [{ key: 'in', label: 'Money in', tone: 'emerald' }],
          points: s.moneyInByMethod.map((m) => ({ label: m.method.replace(/_/g, ' '), values: { in: m.amount } })),
        });
      }
      if (input.show && (!input.chart || input.chart === 'in_and_out')) {
        cards.push({
          type: 'stats',
          title: range.label,
          items: [
            { label: 'Money in', value: pounds(s.moneyIn), tone: 'emerald', hint: `${s.paymentsCount} payments` },
            { label: 'Money out', value: pounds(s.moneyOut), tone: 'rose' },
            { label: 'Left', value: pounds(s.left), tone: 'sky' },
          ],
        });
        if (s.months && s.months.some((m) => m.moneyIn > 0 || m.moneyOut > 0)) {
          cards.push({
            type: 'bar_chart',
            title: range.label,
            series: [
              { key: 'in', label: 'Money in', tone: 'emerald' },
              { key: 'out', label: 'Money out', tone: 'rose' },
            ],
            points: s.months.map((m) => ({ label: m.label.slice(0, 3), values: { in: m.moneyIn, out: m.moneyOut } })),
          });
        }
      }
      return ok(
        {
          period: range.label,
          from: range.from,
          to: range.to,
          money_in: pounds(s.moneyIn),
          payments: s.paymentsCount,
          how_they_paid: s.moneyInByMethod.map((m) => ({ method: m.method, amount: pounds(m.amount) })),
          money_out: pounds(s.moneyOut),
          spending: spent.map((c) => ({ category: c.label, amount: pounds(c.amount), receipts: c.count })),
          left: pounds(s.left),
          ...(s.vat ? { vat: { rate: s.vat.rate, vat_in_estimate: pounds(s.vat.vatInEstimate), vat_on_expenses: pounds(s.vat.vatOut) } } : {}),
          ...(s.months ? { months: s.months.map((m) => ({ month: m.label, in: pounds(m.moneyIn), out: pounds(m.moneyOut) })) } : {}),
          ...(range.to >= ctx.today ? { note: 'This period is not over yet; figures are up to today.' } : {}),
        },
        { cards },
      );
    } catch {
      return toolError('Could not add up the money.');
    }
  },
});

// ---------------------------------------------------------------------------

export const listExpensesTool = defineTool({
  name: 'list_expenses',
  description: 'Saved expenses between two dates, optionally one category, with totals and top suppliers.',
  product: 'rounds',
  status: 'Looking at your expenses',
  schema: z.object({
    from: ymd,
    to: ymd,
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    show: z.boolean().optional(),
  }),
  async run(ctx, input) {
    let rows;
    try {
      rows = await listExpenses(ctx.db, ctx.tenantId, { from: input.from, to: input.to });
    } catch {
      return toolError('Could not read expenses.');
    }
    if (input.category) rows = rows.filter((r) => r.category === input.category);
    const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const bySupplier = new Map<string, number>();
    for (const r of rows) {
      const k = r.merchant ?? 'No supplier';
      bySupplier.set(k, (bySupplier.get(k) ?? 0) + (r.amount ?? 0));
    }
    const cards: AssistantCard[] = [];
    if (input.show && rows.length > 0) {
      cards.push({
        type: 'list',
        title: input.category ? EXPENSE_CATEGORY_LABELS[input.category] : 'Expenses',
        items: rows.slice(0, 20).map((r) => ({
          id: r.id,
          title: r.merchant ?? (r.category ? EXPENSE_CATEGORY_LABELS[r.category] : 'Expense'),
          subtitle: [r.spentOn ? dayLabel(r.spentOn) : null, r.category ? EXPENSE_CATEGORY_LABELS[r.category] : null, r.note].filter(Boolean).join(' · '),
          amount: pounds(r.amount),
          tone: 'violet' as CardTone,
          href: '/expenses',
        })),
        footer: rows.length > 20 ? `${rows.length - 20} more not shown` : undefined,
        total: { label: 'Total', value: pounds(total), tone: 'rose' },
      });
    }
    return ok(
      {
        count: rows.length,
        total: pounds(total),
        top_suppliers: [...bySupplier.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, amount]) => ({ name, amount: pounds(amount) })),
        expenses: rows.slice(0, 25).map((r) => ({
          id: r.id,
          date: r.spentOn,
          supplier: r.merchant,
          category: r.category ? EXPENSE_CATEGORY_LABELS[r.category] : null,
          amount: pounds(r.amount),
          note: r.note,
        })),
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

export const roomForWorkTool = defineTool({
  name: 'room_for_work',
  description: 'Room for new customers in the next 4 weeks: free weekdays, spare days, stops per week.',
  product: 'rounds',
  status: 'Checking your spare days',
  schema: z.object({ show: z.boolean().optional() }),
  async run(ctx, input) {
    try {
      const comingUp = await loadComingUp(ctx.db, { tenantId: ctx.tenantId, weeks: 4, today: ctx.today });
      const room = roomForWork(comingUp);
      if (room.kind === 'empty') return ok({ summary: 'Nothing is booked in the next 4 weeks yet.' });
      const cards: AssistantCard[] = [];
      if (input.show) {
        cards.push({
          type: 'list',
          title: 'Room in the next 4 weeks',
          items: comingUp.weeks.map((w) => {
            const light = w.days.filter((d) => d.plannable && d.stops > 0).sort((a, b) => a.stops - b.stops)[0];
            return {
              title: w.label,
              subtitle:
                w.spareDays.length > 0
                  ? `Free: ${w.spareDays.map((d) => WEEKDAY_NAMES[isoWeekday(d) - 1]!.slice(0, 3)).join(', ')}`
                  : light
                    ? `No free days. Lightest: ${WEEKDAY_NAMES[isoWeekday(light.date) - 1]!.slice(0, 3)} (${light.stops} ${light.stops === 1 ? 'house' : 'houses'})`
                    : 'No working days left',
              amount: `${w.stops} stops`,
              tone: (w.spareDays.length > 0 ? 'teal' : 'slate') as CardTone,
              tag: w.spareDays.length > 0 ? `${w.spareDays.length} free` : undefined,
              href: `/calendar?date=${w.weekStart}`,
            };
          }),
        });
      }
      return ok({
        headline: roomHeadline(room),
        detail: roomDetail(room),
        ...(room.kind === 'room'
          ? {
              regularly_free: room.regularWeekdays.map((d) => WEEKDAY_NAMES[d - 1]),
              spare_days_in_4_weeks: room.spareDays,
              next_free_days: room.nextDays.map((d) => `${dayLabel(d)} (${d})`),
            }
          : {}),
        weeks: comingUp.weeks.map((w) => ({
          week: w.label,
          stops: w.stops,
          worth: pounds(w.amount),
          spare_days: w.spareDays.map((d) => `${WEEKDAY_NAMES[isoWeekday(d) - 1]} ${d}`),
          // Compact: "Mon 12 Oct: 3 houses" for working days still to come.
          houses_per_day: w.days.filter((d) => d.plannable).map((d) => `${dayLabel(d.date)}: ${d.stops}`).join(', '),
        })),
      }, { cards });
    } catch {
      return toolError('Could not work out your spare days.');
    }
  },
});

// ---------------------------------------------------------------------------

export const roundOverview = defineTool({
  name: 'round_overview',
  description: 'The whole round, for growth advice: customers, worth per month, average price per service, customers per postcode area, customers below the usual price.',
  product: 'rounds',
  status: 'Looking over your whole round',
  schema: z.object({ show: z.boolean().optional() }),
  async run(ctx, input) {
    let rows: Record<string, unknown>[];
    try {
      rows = await readAllPages(
        (a, z2) =>
          ctx.db.from('service_agreements')
            .select('id, customer_id, title, status, price, frequency_days, postcode, address, created_at, customers(name)')
            .eq('tenant_id', ctx.tenantId).neq('status', 'ended').order('id').range(a, z2),
        'Could not read the round',
      );
    } catch {
      return toolError('Could not read the round.');
    }
    const active = rows.filter((r) => r.status === 'active');
    const monthly = active.reduce((s, r) => s + ((asNum(r.price) ?? 0) * 30.44) / Math.max(1, asNum(r.frequency_days) ?? 28), 0);

    const byService = new Map<string, number[]>();
    for (const r of active) {
      const t = asText(r.title) ?? 'Regular visit';
      byService.set(t, [...(byService.get(t) ?? []), asNum(r.price) ?? 0]);
    }
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
    };

    const byArea = new Map<string, { customers: Set<string>; monthly: number }>();
    for (const r of active) {
      const pc = asText(r.postcode)?.toUpperCase() ?? '';
      const area = pc.includes(' ') ? `${pc.split(' ')[0]} ${pc.split(' ')[1]?.[0] ?? ''}`.trim() : pc.slice(0, -2) || 'Unknown';
      const cur = byArea.get(area) ?? { customers: new Set<string>(), monthly: 0 };
      cur.customers.add(String(r.customer_id));
      cur.monthly += ((asNum(r.price) ?? 0) * 30.44) / Math.max(1, asNum(r.frequency_days) ?? 28);
      byArea.set(area, cur);
    }
    const areas = [...byArea.entries()].map(([area, v]) => ({ area, customers: v.customers.size, monthly: v.monthly })).sort((a, b) => b.customers - a.customers);

    const yearAgo = addDays(ctx.today, -365);
    const priceRise = active
      .filter((r) => {
        const t = asText(r.title) ?? 'Regular visit';
        const prices = byService.get(t) ?? [];
        const created = asYmd(r.created_at);
        return prices.length >= 3 && (asNum(r.price) ?? 0) < median(prices) && created != null && created <= yearAgo;
      })
      .slice(0, 10)
      .map((r) => {
        const embed = r.customers as { name?: unknown } | null;
        return {
          customer: asText(embed?.name) ?? 'Customer',
          customer_id: String(r.customer_id),
          agreement_id: String(r.id),
          service: asText(r.title),
          pays: pounds(asNum(r.price)),
          usual: pounds(median(byService.get(asText(r.title) ?? 'Regular visit') ?? [])),
          since: asYmd(r.created_at),
        };
      });

    const cards: AssistantCard[] = [];
    if (input.show) {
      cards.push({
        type: 'stats',
        items: [
          { label: 'Customers', value: String(new Set(active.map((r) => r.customer_id)).size), tone: 'sky' },
          { label: 'Round worth a month', value: pounds(Math.round(monthly)), tone: 'emerald' },
          { label: 'Paused services', value: String(rows.length - active.length), tone: 'amber' },
        ],
      });
      if (areas.length > 1) {
        cards.push({
          type: 'bar_chart',
          title: 'Customers by area',
          series: [{ key: 'customers', label: 'Customers', tone: 'sky' }],
          points: areas.slice(0, 12).map((a) => ({ label: a.area, values: { customers: a.customers } })),
        });
      }
    }

    return ok(
      {
        active_customers: new Set(active.map((r) => r.customer_id)).size,
        active_services: active.length,
        paused_services: rows.length - active.length,
        round_worth_per_month: pounds(Math.round(monthly)),
        services: [...byService.entries()].map(([title, prices]) => ({
          service: title,
          customers: prices.length,
          average_price: pounds(avg(prices)),
          lowest: pounds(Math.min(...prices)),
          highest: pounds(Math.max(...prices)),
        })),
        areas: areas.slice(0, 12).map((a) => ({ area: a.area, customers: a.customers, worth_per_month: pounds(Math.round(a.monthly)) })),
        price_rise_candidates: priceRise,
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

export const listServices = defineTool({
  name: 'list_services',
  description: 'Their price list: service ids, names, usual price, time, how often.',
  product: 'rounds',
  status: 'Reading your price list',
  schema: z.object({ show: z.boolean().optional() }),
  async run(ctx, input) {
    const { data, error } = await ctx.db
      .from('service_catalog')
      .select('id, name, default_price, default_duration_minutes, default_frequency_days, is_active')
      .eq('tenant_id', ctx.tenantId)
      .order('sort_order')
      .order('name');
    if (error) return toolError('Could not read the price list.');
    const rows = (data ?? []) as Record<string, unknown>[];
    const cards: AssistantCard[] = [];
    if (input.show && rows.length > 0) {
      cards.push({
        type: 'list',
        title: 'Your price list',
        items: rows.map((s) => ({
          id: String(s.id),
          title: asText(s.name) ?? 'Service',
          subtitle: [asNum(s.default_frequency_days) ? oftenLabel(asNum(s.default_frequency_days)!) : null, asNum(s.default_duration_minutes) ? `${asNum(s.default_duration_minutes)} min` : null]
            .filter(Boolean)
            .join(', '),
          amount: pounds(asNum(s.default_price)),
          tag: s.is_active === false ? 'Not offered' : undefined,
          href: '/services',
        })),
      });
    }
    return ok({
      services: rows.map((s) => ({
        service_id: String(s.id),
        name: asText(s.name),
        usual_price: pounds(asNum(s.default_price)),
        minutes: asNum(s.default_duration_minutes),
        how_often: asNum(s.default_frequency_days) ? oftenLabel(asNum(s.default_frequency_days)!) : null,
        in_use: s.is_active !== false,
      })),
    }, { cards });
  },
});

export const READ_ROUNDS_TOOLS = [
  findCustomers,
  getCustomer,
  getSchedule,
  whoOwes,
  moneySummary,
  listExpensesTool,
  roomForWorkTool,
  roundOverview,
  listServices,
];

export type { ToolOutcome };
