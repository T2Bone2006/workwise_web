import { redirect } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { MarkRemainingDone } from '@/components/rounds/mark-remaining-done';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { getCalendarTeam } from '@/lib/data/rounds/calendar-team';
import { getVisitsForDay } from '@/lib/data/rounds/visits';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { filterByPerson, parsePersonParam } from '@/lib/rounds/lanes';
import { isRemainingVisit } from '@/lib/rounds/remaining-plan';

function NoTenantMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your administrator.
      </p>
    </div>
  );
}

export default async function MarkRemainingDonePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; person?: string }>;
}) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);
  if (!products.hasRounds) redirect('/dashboard');
  if (!tenantId) return <NoTenantMessage />;

  const raw = await searchParams;
  const today = todayInLondon();
  const date: Ymd = raw.date && isValidYmd(raw.date) ? raw.date : today;
  const dayHref = `/calendar?view=day&date=${date}${raw.person ? `&person=${encodeURIComponent(raw.person)}` : ''}`;

  const [{ visits, error }, team] = await Promise.all([
    getVisitsForDay(tenantId, date),
    getCalendarTeam(tenantId, date),
  ]);

  const person = team ? parsePersonParam(raw.person, team.people) : 'all';
  const scoped = team ? filterByPerson(visits, person, team.people) : visits;
  const rows = scoped.filter((visit) => isRemainingVisit(visit.status)).map((visit) => ({
    id: visit.id,
    customerName: visit.customer_name?.trim() || 'Customer',
    title: visit.job_description?.trim() || '',
    place: [visit.address, visit.postcode].filter(Boolean).join(', '),
    quotedAmount: visit.quoted_amount,
    sendInvoice: visit.customer_sends_invoice,
  }));

  const who =
    team && person !== 'all'
      ? team.people.find((member) => member.workerId === (person === 'mine' ? team.people.find((p) => p.isOwner)?.workerId : person))
      : null;
  const whoName = who ? (who.isOwner ? 'You' : who.name) : null;
  const headingDate = format(parseISO(date), 'EEE d MMM yyyy');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <HistoryBackButton iconOnly label="Back to the day" fallbackHref={dayHref} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mark remaining done</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {headingDate}
            {whoName ? ` · ${whoName}` : ''}
            {` · ${rows.length} still to do`}
          </p>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">Nothing left to mark</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Done and skipped visits stay as they are.
          </p>
        </div>
      ) : (
        <MarkRemainingDone key={rows.map((row) => row.id).join('|')} date={date} dayHref={dayHref} rows={rows} />
      )}
    </div>
  );
}
