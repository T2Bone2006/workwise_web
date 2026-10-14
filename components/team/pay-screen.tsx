'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, CheckCircle2, UsersRound, Wallet } from 'lucide-react';
import { EmptyState, StatTile, floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { removeDayAction, voidPaymentAction } from '@/lib/actions/team-pay';
import { PAY_PERIODS, type TeamPayPageData, type TeamPayRow } from '@/lib/data/team-pay-page-core';
import { formatGbp } from '@/lib/money/pence';
import type { DayRow, PaymentRow } from '@/lib/team/pay';
import { cn } from '@/lib/utils';
import { AddDayDialog } from './add-day-dialog';
import { ConfirmDialog } from './confirm-dialog';
import { EditDayDialog } from './edit-day-dialog';
import { formatDayShort } from './format-range';
import { PayList } from './pay-summary-row';
import { PersonStatementSheet } from './person-statement-sheet';
import { RecordTeamPaymentDialog } from './record-team-payment-dialog';
import { TeamHeader } from './team-header';

type Dialog =
  | { kind: 'pay'; row: TeamPayRow }
  | { kind: 'addDay'; row: TeamPayRow }
  | { kind: 'editDay'; day: DayRow }
  | { kind: 'removeDay'; day: DayRow }
  | { kind: 'void'; payment: PaymentRow }
  | null;

function href(period: string, person?: string | null): string {
  return `/team/pay?period=${period}${person ? `&person=${person}` : ''}`;
}

/** The Pay page: what each person earned, what you've paid and what's left, for the period you pick. */
export function PayScreen({ data }: { data: TeamPayPageData }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const { totals, statement } = data;
  const selectedId = statement?.person.personId ?? null;
  const allPaid = totals.owedPence === 0;

  const openPerson = (row: TeamPayRow) => router.push(href(data.periodKey, row.personId), { scroll: false });
  const closePerson = () => router.replace(href(data.periodKey), { scroll: false });

  const periodControl = (
    <nav aria-label="Period" className="inline-flex rounded-xl bg-look-segment p-1 text-sm">
      {PAY_PERIODS.map((p) => (
        <Link
          key={p.key}
          href={href(p.key, selectedId)}
          aria-current={p.key === data.periodKey ? 'page' : undefined}
          scroll={false}
          className={cn(
            'rounded-lg px-3 py-1 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            p.key === data.periodKey && 'bg-card text-foreground shadow-(--look-card-shadow)',
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="space-y-6">
      <TeamHeader tab="pay" subtitle="What each person has earned from the days they worked, what you've paid, and what's left." />

      {data.rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Nobody to pay yet"
          body="Add a lead or a helper on the Team page. Their days and what you pay them show up here."
          action={
            <Button asChild>
              <Link href="/team">Go to Team</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{data.label}</span>. Earlier days are in All time.
            </p>
            <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{periodControl}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Earned" value={formatGbp(totals.earnedPence / 100)} tone="slate" icon={CalendarDays} sub={data.label} />
            <StatTile label="Paid" value={formatGbp(totals.paidPence / 100)} tone="emerald" icon={CheckCircle2} sub="Recorded by you" />
            <StatTile
              label="Still owed"
              value={allPaid ? 'All paid' : formatGbp(totals.owedPence / 100)}
              tone={allPaid ? 'emerald' : 'rose'}
              icon={Wallet}
              sub={totals.aheadPence > 0 ? `${formatGbp(totals.aheadPence / 100)} paid ahead` : allPaid ? 'Nothing outstanding' : 'To pay'}
            />
          </div>

          <PayList rows={data.rows} selectedId={selectedId} onPay={(r) => setDialog({ kind: 'pay', row: r })} onOpen={openPerson} />
        </div>
      )}

      {statement ? (
        <PersonStatementSheet
          statement={statement}
          label={data.label}
          onClose={closePerson}
          onPay={() => setDialog({ kind: 'pay', row: statement.person })}
          onAddDay={() => setDialog({ kind: 'addDay', row: statement.person })}
          onEditDay={(day) => setDialog({ kind: 'editDay', day })}
          onRemoveDay={(day) => setDialog({ kind: 'removeDay', day })}
          onVoid={(payment) => setDialog({ kind: 'void', payment })}
        />
      ) : null}

      {dialog?.kind === 'pay' ? (
        <RecordTeamPaymentDialog
          personId={dialog.row.personId}
          name={dialog.row.name}
          owedPence={dialog.row.owedPence}
          today={data.today}
          open
          onOpenChange={(open) => !open && close()}
        />
      ) : null}
      {dialog?.kind === 'addDay' ? (
        <AddDayDialog
          personId={dialog.row.personId}
          name={dialog.row.name}
          dayRatePence={dialog.row.dayRatePence}
          today={data.today}
          open
          onOpenChange={(open) => !open && close()}
        />
      ) : null}
      {dialog?.kind === 'editDay' && statement ? (
        <EditDayDialog day={dialog.day} name={statement.person.name} open onOpenChange={(open) => !open && close()} />
      ) : null}
      {dialog?.kind === 'removeDay' && statement ? (
        <ConfirmDialog
          title={`Remove ${formatDayShort(dialog.day.date)} for ${statement.person.name}?`}
          description={`Their earned total goes down by ${formatGbp(dialog.day.ratePence / 100)}.`}
          confirmLabel="Remove day"
          keepLabel="Keep day"
          onClose={close}
          onConfirm={async () => {
            const result = await removeDayAction(dialog.day.id);
            if (!result.ok) return result.error;
            floatingMessage({ title: 'Day removed', tone: 'success' });
            router.refresh();
            return null;
          }}
        />
      ) : null}
      {dialog?.kind === 'void' && statement ? (
        <ConfirmDialog
          title={`Void ${formatGbp(dialog.payment.amountPence / 100)} paid to ${statement.person.name}?`}
          description="This also removes the wages line from Expenses. The payment stays in the list, marked as voided."
          confirmLabel="Void payment"
          keepLabel="Keep payment"
          onClose={close}
          onConfirm={async () => {
            const result = await voidPaymentAction(dialog.payment.id);
            if (!result.ok) return result.error;
            floatingMessage({ title: 'Payment voided', tone: 'success' });
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}
