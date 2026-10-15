'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, ChevronRight, Footprints, Lock, Plus, UserPlus, UsersRound } from 'lucide-react';
import { EmptyState, Notice, StatTile, floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { resendLeadInviteAction } from '@/lib/actions/team';
import { TEAM_HELPERS_FREE, TEAM_PRICE_LINE, TEAM_PRICE_LINE_YEARLY, TEAM_YEARLY_ACTIVE, TEAM_YEARLY_OFFER } from '@/lib/billing/rounds-team-core';
import type { TeamPageData, TeamPagePerson } from '@/lib/data/team-page-core';
import { formatGbp } from '@/lib/money/pence';
import { AddHelperDialog } from './add-helper-dialog';
import { AssignRoundsDialog } from './assign-rounds-dialog';
import { DaysOffDialog } from './days-off-dialog';
import { EditPersonDialog } from './edit-person-dialog';
import { InviteLeadDialog } from './invite-lead-dialog';
import { PersonList, type PersonRowActions } from './person-row';
import { RemoveLeadDialog } from './remove-lead-dialog';
import { TeamHeader } from './team-header';
import { perLeadLabel } from './team-ui';

type Dialog =
  | { kind: 'invite' }
  | { kind: 'helper' }
  | { kind: 'edit'; person: TeamPagePerson }
  | { kind: 'daysoff'; person: TeamPagePerson }
  | { kind: 'rounds'; person: TeamPagePerson }
  | { kind: 'remove'; person: TeamPagePerson }
  | null;

/** The Team page: who is on the team, are they out today, what they cost and what they hold. */
export function TeamScreen({ data, today }: { data: TeamPageData; today: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  const active = data.people.filter((p) => !p.endedAt);
  const former = data.people.filter((p) => p.endedAt);
  const leads = active.filter((p) => p.kind === 'lead');
  const helpers = active.filter((p) => p.kind === 'helper');
  const working = active.filter((p) => p.today === 'working').length;
  const expected = active.filter((p) => p.today === 'working' || p.today === 'not_started').length;
  const { billing } = data;

  const actions: PersonRowActions = {
    onEdit: (person) => setDialog({ kind: 'edit', person }),
    onDaysOff: (person) => setDialog({ kind: 'daysoff', person }),
    onRounds: (person) => setDialog({ kind: 'rounds', person }),
    onRemove: (person) => setDialog({ kind: 'remove', person }),
    onResend: async (person) => {
      const result = await resendLeadInviteAction(person.id);
      floatingMessage(
        result.ok
          ? { title: `Invite sent again to ${person.email ?? person.name}`, tone: 'success' }
          : { title: result.error, tone: 'error' },
      );
      if (result.ok) router.refresh();
    },
  };

  const priceLine = billing.interval === 'year' ? TEAM_PRICE_LINE_YEARLY : TEAM_PRICE_LINE;
  const subtitle =
    billing.leadCount > 0
      ? `${billing.leadCount} ${billing.leadCount === 1 ? 'lead' : 'leads'}: ${perLeadLabel(billing.perLeadPence * billing.leadCount, billing.interval)}. ${TEAM_HELPERS_FREE}`
      : `${priceLine}. ${TEAM_HELPERS_FREE}`;
  const offerLine = billing.interval === 'year' ? TEAM_YEARLY_ACTIVE : TEAM_YEARLY_OFFER;

  const isEmpty = active.length === 0 && former.length === 0;

  const buttons = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => setDialog({ kind: 'invite' })} disabled={!billing.canAddLeads} className="flex-1 sm:flex-none">
        <UserPlus className="mr-1.5 size-4" />
        Add a lead
      </Button>
      <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'helper' })} className="flex-1 sm:flex-none">
        <Plus className="mr-1.5 size-4" />
        Add a helper
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <TeamHeader tab="people" subtitle={`${subtitle} ${offerLine}`} actions={isEmpty ? undefined : buttons} />

      {!billing.canAddLeads && billing.reason ? (
        <Notice tone="amber" icon={Lock} title="You can't add a lead right now">
          {billing.reason}
        </Notice>
      ) : null}

      {isEmpty ? (
        <EmptyState
          icon={UsersRound}
          title="Add your first team member"
          body="A lead logs in on their phone and runs a round. A helper is just a name you pay by the day."
          action={buttons}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              label="On your team"
              value={String(active.length)}
              tone="rounds"
              icon={UsersRound}
              sub={`${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}, ${helpers.length} ${helpers.length === 1 ? 'helper' : 'helpers'}`}
            />
            <StatTile
              label="Out today"
              value={expected > 0 ? `${working} of ${expected}` : String(working)}
              tone="sky"
              icon={Footprints}
              sub={expected > 0 ? 'started their day' : 'No one has stops today'}
            />
            <div className="col-span-2 sm:col-span-1">
              <StatTile
                label="Cash to hand in"
                value={formatGbp(data.heldTotalPence / 100)}
                tone={data.heldTotalPence > 0 ? 'rose' : 'slate'}
                icon={Banknote}
                href="/team/cash"
                sub={data.heldTotalPence > 0 ? 'Held by your team' : 'Nothing held'}
              />
            </div>
          </div>

          {active.length > 0 ? (
            <PersonList people={active} actions={actions} />
          ) : (
            <EmptyState
              icon={UsersRound}
              title="No one on the team right now"
              body="Add a lead or a helper. Former team members are listed below."
              action={buttons}
            />
          )}

          {former.length > 0 ? (
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
                Former team members ({former.length})
              </summary>
              <div className="mt-3">
                <PersonList people={former} actions={actions} />
              </div>
            </details>
          ) : null}

          {billing.leadCount > 0 ? <p className="text-xs text-muted-foreground">{priceLine}.</p> : null}
        </>
      )}

      <InviteLeadDialog open={dialog?.kind === 'invite'} onOpenChange={(open) => !open && close()} canAdd={billing.canAddLeads} reason={billing.reason} />
      <AddHelperDialog open={dialog?.kind === 'helper'} onOpenChange={(open) => !open && close()} />
      {dialog?.kind === 'edit' ? (
        <EditPersonDialog key={dialog.person.id} person={dialog.person} open onOpenChange={(open) => !open && close()} />
      ) : null}
      {dialog?.kind === 'daysoff' ? (
        <DaysOffDialog
          key={dialog.person.id}
          people={data.assignees}
          existing={data.daysOffAll}
          today={today}
          initialWorkerId={dialog.person.workerId ?? undefined}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'rounds' ? (
        <AssignRoundsDialog
          key={dialog.person.id}
          person={dialog.person}
          rounds={data.rounds}
          leadNames={Object.fromEntries(data.assignees.map((a) => [a.workerId, a.isOwner ? 'you' : (a.name.trim().split(/\s+/)[0] ?? a.name)]))}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <RemoveLeadDialog
          key={dialog.person.id}
          person={dialog.person}
          perLeadPence={billing.perLeadPence}
          interval={billing.interval}
          open
          onOpenChange={(open) => !open && close()}
        />
      ) : null}
    </div>
  );
}
