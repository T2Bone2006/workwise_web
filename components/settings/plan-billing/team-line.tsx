import Link from 'next/link';
import { UsersRound } from 'lucide-react';
import { IconChip } from '@/components/look';
import { TEAM_HELPERS_FREE, TEAM_PRICE_LINE, TEAM_PRICE_LINE_YEARLY, TEAM_YEARLY_ACTIVE, TEAM_YEARLY_OFFER } from '@/lib/billing/rounds-team-core';
import { showTeamLine, type TeamBilling } from '@/lib/data/team-billing-core';
import { formatGbp } from '@/lib/money/pence';

/**
 * Plan & billing, Rounds: what the team adds to the plan, in words. Stripe's own "next bill" figure still includes it;
 * this row only explains it. Nothing here shows pay or day rates.
 */
export function TeamLine({ billing }: { billing: TeamBilling }) {
  if (!showTeamLine(billing)) return null;
  const year = billing.interval === 'year';
  const per = formatGbp(billing.perLeadPence / 100);
  const total = formatGbp(billing.totalPence / 100);
  const unit = year ? 'a year' : 'a month';
  return (
    <section
      aria-labelledby="team-line-heading"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:flex-row sm:items-center sm:gap-4 sm:p-5"
    >
      <IconChip icon={UsersRound} tone="rounds" />
      <div className="min-w-0 flex-1">
        <h2 id="team-line-heading" className="text-[15px] font-semibold">
          Team members
        </h2>
        {billing.leadCount > 0 ? (
          <p className="mt-0.5 text-sm tabular-nums">
            {billing.leadCount} {billing.leadCount === 1 ? 'lead' : 'leads'} × {per} = <span className="font-semibold">{total} {unit}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">No leads yet. Add one on the Team page and you&apos;ll see the price first.</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {year ? TEAM_PRICE_LINE_YEARLY : TEAM_PRICE_LINE}. {TEAM_HELPERS_FREE}
        </p>
        <p className="mt-1.5 inline-block rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {year ? TEAM_YEARLY_ACTIVE : TEAM_YEARLY_OFFER}
        </p>
      </div>
      <Link href="/team" className="shrink-0 text-sm font-medium text-primary hover:underline">
        Manage team
      </Link>
    </section>
  );
}
