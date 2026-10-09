import type { MapPlace } from '@/lib/rounds/map-areas';
import { compareYmd, type Ymd } from '@/lib/rounds/dates';
import { frequencyLabel } from '@/lib/rounds/parse-frequency';

export type MapAgreementRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  title: string;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  price: number;
  frequency_days: number;
};

export type MapVisitRow = {
  service_agreement_id: string | null;
  scheduled_date: Ymd | null;
  status: string;
};

const DAYS_PER_YEAR = 365;

/**
 * Turns active agreements into pins. Places with no position are counted, not
 * dropped quietly, so the page can say how many customers are missing.
 */
export function buildMapPlaces(p: {
  agreements: MapAgreementRow[];
  visits: MapVisitRow[];
  owedByCustomer: Map<string, number>;
  /** Earliest booked visit still to do, per agreement. */
  nextVisitByAgreement: Map<string, Ymd>;
  /** The named round each agreement is in. Missing = not in a round. */
  roundByAgreement?: Map<string, string>;
  monthStart: Ymd;
  monthEnd: Ymd;
  weekStart: Ymd;
  weekEnd: Ymd;
}): { places: MapPlace[]; unmappedCustomers: number } {
  const monthVisits = new Map<string, number>();
  const dueThisWeek = new Set<string>();
  for (const visit of p.visits) {
    const id = visit.service_agreement_id;
    const date = visit.scheduled_date?.slice(0, 10);
    if (!id || !date || visit.status === 'cancelled') continue;
    if (compareYmd(date, p.monthStart) >= 0 && compareYmd(date, p.monthEnd) <= 0) {
      monthVisits.set(id, (monthVisits.get(id) ?? 0) + 1);
    }
    if (visit.status !== 'completed' && compareYmd(date, p.weekStart) >= 0 && compareYmd(date, p.weekEnd) <= 0) {
      dueThisWeek.add(id);
    }
  }

  const places: MapPlace[] = [];
  const owedPlaced = new Set<string>();
  const unmapped = new Set<string>();
  const mappedCustomers = new Set<string>();
  for (const a of p.agreements) {
    if (a.lat == null || a.lng == null || !Number.isFinite(a.lat) || !Number.isFinite(a.lng)) {
      unmapped.add(a.customer_id);
      continue;
    }
    mappedCustomers.add(a.customer_id);
    const owed = p.owedByCustomer.get(a.customer_id) ?? 0;
    const firstPlace = owed > 0 && !owedPlaced.has(a.customer_id);
    if (firstPlace) owedPlaced.add(a.customer_id);
    places.push({
      id: a.id,
      customerId: a.customer_id,
      customerName: a.customer_name,
      title: a.title,
      address: a.address,
      postcode: a.postcode,
      lat: a.lat,
      lng: a.lng,
      yearly: a.frequency_days > 0 ? (a.price * DAYS_PER_YEAR) / a.frequency_days : 0,
      visitsThisMonth: monthVisits.get(a.id) ?? 0,
      dueThisWeek: dueThisWeek.has(a.id),
      owes: owed > 0,
      owed: firstPlace ? owed : 0,
      price: a.price,
      frequencyLabel: a.frequency_days > 0 ? frequencyLabel(a.frequency_days) : '',
      nextVisit: p.nextVisitByAgreement.get(a.id) ?? null,
      phone: a.customer_phone,
      roundId: p.roundByAgreement?.get(a.id) ?? null,
    });
  }
  // A customer with one place on the map and one off it is on the map.
  const unmappedCustomers = [...unmapped].filter((id) => !mappedCustomers.has(id)).length;
  return { places, unmappedCustomers };
}
