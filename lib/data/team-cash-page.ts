import 'server-only';

import { nudgeDays } from '@/lib/team/cash-nudge';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import { listHeldCash, recentHandIns, type HeldGroup } from '@/lib/team/hand-in';

export type CashPageData = {
  groups: HeldGroup[];
  recent: Array<{ paymentId: string; collectorName: string; customerName: string; amount: number; handedOverAt: string }>;
  /** Days held before the owner is nudged; the amber tag shows from here. */
  nudgeDays: number;
  today: string;
};

/** The Cash to hand in page: what each person holds, and the last ten hand-ins. Throws if the cash can't be read. */
export async function getCashPage(tenantId: string): Promise<CashPageData> {
  const db = createAdminClient();
  const today = todayInLondon();
  const [groups, recent] = await Promise.all([listHeldCash(db, tenantId, today), recentHandIns(db, tenantId, 10)]);
  return { groups, recent, nudgeDays: nudgeDays(), today };
}
