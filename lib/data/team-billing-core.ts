export type TeamBilling = {
  leadCount: number;
  /** The plan's billing period; null when the plan can't add leads. */
  interval: 'month' | 'year' | null;
  perLeadPence: number;
  /** leadCount × perLeadPence: per month on a monthly plan, per year on a yearly one. */
  totalPence: number;
  canAddLeads: boolean;
};

/** Pure. The total is leads × the per-lead price in the plan's own period (never ×12 on a yearly plan). */
export function shapeTeamBilling(input: { leadCount: number; canAddLeads: boolean; interval: 'month' | 'year' | null; perLeadPence: number }): TeamBilling {
  const leadCount = Math.max(0, Math.floor(input.leadCount));
  return {
    leadCount,
    interval: input.interval,
    perLeadPence: input.perLeadPence,
    totalPence: leadCount * input.perLeadPence,
    canAddLeads: input.canAddLeads,
  };
}

/** The row only appears when there are leads, or the plan could take them. */
export function showTeamLine(b: TeamBilling): boolean {
  return b.leadCount > 0 || b.canAddLeads;
}
