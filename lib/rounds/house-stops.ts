export type HouseFields = {
  id: string;
  customer_id: string | null;
  address: string;
  postcode: string;
};

/** Same customer at the same address (case and spacing ignored). */
export function houseKey(visit: HouseFields): string {
  const address = visit.address.trim().toLowerCase().replace(/\s+/g, ' ');
  const postcode = visit.postcode.trim().toLowerCase().replace(/\s+/g, '');
  if (!visit.customer_id) return `job:${visit.id}`;
  return `${visit.customer_id}|${address}|${postcode}`;
}

/** Keep route order. Same customer and address on this day share one stop. */
export function groupHouseStops<T extends HouseFields>(visits: T[]): T[][] {
  const groups: T[][] = [];
  const indexByKey = new Map<string, number>();
  for (const visit of visits) {
    const key = houseKey(visit);
    const existing = indexByKey.get(key);
    if (existing == null) {
      indexByKey.set(key, groups.length);
      groups.push([visit]);
    } else {
      groups[existing]!.push(visit);
    }
  }
  return groups;
}
