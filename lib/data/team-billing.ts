import 'server-only';

import { teamPricePence } from '@/lib/billing/rounds-team-core';
import { countLeads } from '@/lib/billing/rounds-team';
import { shapeTeamBilling, type TeamBilling } from '@/lib/data/team-billing-core';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPlan } from '@/lib/team/invite-lead';

export type { TeamBilling } from '@/lib/data/team-billing-core';

/**
 * What the team adds to the plan, for Plan & billing: how many leads, per lead, and in total. Stripe's own "next bill"
 * figure stays the source for the bill; this only explains the line. Throws if the lead count can't be read (the
 * caller leaves the row out and logs).
 */
export async function getTeamBilling(tenantId: string): Promise<TeamBilling> {
  const db = createAdminClient();
  const [leadCount, plan] = await Promise.all([countLeads(tenantId, db), checkPlan(db, tenantId)]);
  if (leadCount === null) throw new Error('Could not count the team.');
  const interval = plan.ok ? plan.interval : null;
  return shapeTeamBilling({ leadCount, canAddLeads: plan.ok, interval, perLeadPence: teamPricePence(interval ?? 'month') });
}
