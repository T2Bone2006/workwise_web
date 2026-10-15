import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validAssignees } from '@/lib/team/assign';
import { readAllPages } from '@/lib/data/read-all-pages';
import { getOwedCustomers } from '@/lib/data/payments/owed';
import { getVisitsForRange } from '@/lib/data/rounds/visits';
import { addDays, endOfMonth, isoWeekday, startOfMonth, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import type { MapPlace } from '@/lib/rounds/map-areas';
import { getRoundMembership } from '@/lib/data/rounds/round-membership';
import { buildMapPlaces, type MapAgreementRow } from '@/lib/rounds/map-build';
import type { RoundRow } from '@/lib/rounds/rounds';

export type RoundsMapData = {
  places: MapPlace[];
  /** The business's named rounds. */
  rounds: RoundRow[];
  /** Who usually does each round (workers.id), null = the owner. Only filled when the business has a lead. */
  usualLeads: Record<string, string | null>;
  /** The owner and each active lead, for the round editor's "Usually done by" choice. Empty when there is no team. */
  leadOptions: Array<{ workerId: string; name: string; isOwner: boolean }>;
  /** Customers whose address could not be placed on the map. */
  unmappedCustomers: number;
  /** Plain-English lines for parts that failed to load; the map still shows. */
  notes: string[];
  /** Null when the places themselves could not be read. */
  error: string | null;
};

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function customerEmbed(value: unknown): { name: string; phone: string | null } {
  const row = (Array.isArray(value) ? value[0] : value) as { name?: unknown; phone?: unknown } | null | undefined;
  const name = typeof row?.name === 'string' && row.name.trim() !== '' ? row.name : 'Customer';
  const phone = typeof row?.phone === 'string' && row.phone.trim() !== '' ? row.phone : null;
  return { name, phone };
}

/** Usual lead per round and the people a round can be given to. Never throws: no team (or an error) gives nothing. */
async function loadUsualLeads(
  tenantId: string,
): Promise<{ usualLeads: Record<string, string | null>; leadOptions: RoundsMapData['leadOptions'] }> {
  const none = { usualLeads: {}, leadOptions: [] };
  try {
    const admin = createAdminClient();
    const [assignees, rounds] = await Promise.all([
      validAssignees(admin, tenantId),
      admin.from('rounds').select('id, usual_lead_worker_id').eq('tenant_id', tenantId),
    ]);
    if (!assignees.some((a) => !a.isOwner)) return none;
    const usualLeads: Record<string, string | null> = {};
    for (const row of (rounds.data ?? []) as Array<{ id: string; usual_lead_worker_id: string | null }>) {
      usualLeads[row.id] = row.usual_lead_worker_id;
    }
    return { usualLeads, leadOptions: assignees };
  } catch (err) {
    console.error('[getRoundsMapData] usual leads', err instanceof Error ? err.message : 'failed');
    return none;
  }
}

/** The earliest visit still to do for each agreement, from today on. Null if it couldn't be read. */
async function loadNextVisits(db: SupabaseClient, tenantId: string, today: Ymd): Promise<Map<string, Ymd> | null> {
  try {
    const rows = await readAllPages(
      (a, z) =>
        db
          .from('jobs')
          .select('id, service_agreement_id, scheduled_date')
          .eq('tenant_id', tenantId)
          .not('service_agreement_id', 'is', null)
          .gte('scheduled_date', today)
          .not('status', 'in', '(completed,cancelled)')
          .order('scheduled_date', { ascending: true })
          .order('id', { ascending: true })
          .range(a, z),
      'Could not load next visits',
    );
    const next = new Map<string, Ymd>();
    for (const r of rows) {
      const id = typeof r.service_agreement_id === 'string' ? r.service_agreement_id : null;
      const date = typeof r.scheduled_date === 'string' ? r.scheduled_date.slice(0, 10) : null;
      if (id && date && !next.has(id)) next.set(id, date);
    }
    return next;
  } catch (err) {
    console.error('[getRoundsMapData] next visits', err instanceof Error ? err.message : 'failed');
    return null;
  }
}

/** Every active place with a position, with what it's worth, what's booked and who owes. */
export async function getRoundsMapData(tenantId: string): Promise<RoundsMapData> {
  const db = await createClient();
  const today = todayInLondon();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const weekStart = addDays(today, 1 - isoWeekday(today));
  const weekEnd = addDays(weekStart, 6);
  const notes: string[] = [];

  let agreements: MapAgreementRow[];
  try {
    const rows = await readAllPages(
      (a, z) =>
        db
          .from('service_agreements')
          .select('id, customer_id, title, address, postcode, lat, lng, price, frequency_days, customers ( name, phone )')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .order('id', { ascending: true })
          .range(a, z),
      'Could not load your customers',
    );
    agreements = rows.map((r) => ({
      id: String(r.id),
      customer_id: String(r.customer_id),
      customer_name: customerEmbed(r.customers).name,
      customer_phone: customerEmbed(r.customers).phone,
      title: typeof r.title === 'string' ? r.title : '',
      address: typeof r.address === 'string' ? r.address : '',
      postcode: typeof r.postcode === 'string' ? r.postcode : '',
      lat: num(r.lat),
      lng: num(r.lng),
      price: num(r.price) ?? 0,
      frequency_days: num(r.frequency_days) ?? 0,
    }));
  } catch (err) {
    console.error('[getRoundsMapData] agreements', err instanceof Error ? err.message : 'failed');
    return { places: [], rounds: [], usualLeads: {}, leadOptions: [], unmappedCustomers: 0, notes, error: 'Could not load your customers.' };
  }

  const from = monthStart < weekStart ? monthStart : weekStart;
  const to = monthEnd > weekEnd ? monthEnd : weekEnd;
  const [visitsResult, owedResult, nextVisits, roundData] = await Promise.all([
    getVisitsForRange(tenantId, from, to),
    getOwedCustomers(db, tenantId),
    loadNextVisits(db, tenantId, today),
    getRoundMembership(db, tenantId),
  ]);
  if (!roundData) notes.push('Your rounds couldn’t load, so they’re left out for now.');
  if (visitsResult.error) notes.push('Visits this month and due this week couldn’t load, so they show as zero.');
  if (!nextVisits) notes.push('Next visit dates couldn’t load, so the customer cards leave them out.');
  if (owedResult.error) notes.push('Who owes money couldn’t load, so nobody shows as owing.');

  const owedByCustomer = new Map<string, number>();
  for (const row of owedResult.rows) {
    if (row.owedAmount > 0) owedByCustomer.set(row.customerId, row.owedAmount);
  }

  const { places, unmappedCustomers } = buildMapPlaces({
    agreements,
    visits: visitsResult.visits,
    owedByCustomer,
    nextVisitByAgreement: nextVisits ?? new Map(),
    roundByAgreement: roundData?.roundIdByAgreement,
    monthStart,
    monthEnd,
    weekStart,
    weekEnd,
  });
  const { usualLeads, leadOptions } = await loadUsualLeads(tenantId);
  return { places, rounds: roundData?.rounds ?? [], usualLeads, leadOptions, unmappedCustomers, notes, error: null };
}
