import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getCustomersForTenant } from '@/lib/data/customers';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import {
  getVisitCountsForMonth,
  getVisitsForDay,
} from '@/lib/data/rounds/visits';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { RoundsMonthGrid } from '@/components/rounds/rounds-month-grid';
import { RoundsDayPlan } from '@/components/rounds/rounds-day-plan';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface CalendarPageProps {
  searchParams: Promise<{
    view?: string;
    date?: string;
  }>;
}

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

function resolveDate(raw: string | undefined, today: Ymd): Ymd {
  if (raw && isValidYmd(raw)) return raw;
  return today;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!products.hasRounds) {
    redirect('/dashboard');
  }
  if (!tenantId) {
    return <NoTenantMessage />;
  }

  const raw = await searchParams;
  const today = todayInLondon();
  const date = resolveDate(raw.date, today);
  const view = raw.view === 'day' ? 'day' : 'month';

  const supabase = await createClient();
  const settings = await getRoundsSettings(supabase, tenantId);

  if (view === 'day') {
    const [{ visits, error }, { customers }] = await Promise.all([
      getVisitsForDay(tenantId, date),
      getCustomersForTenant(tenantId),
    ]);

    return (
      <div className="space-y-6">
        <PageGradientHeader
          title="Day plan"
          subtitle="Reorder, optimise, done / skip / reschedule, or move remaining."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/calendar?view=month&date=${date}`}>Month view</Link>
            </Button>
          }
        />
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : null}
        <RoundsDayPlan
          key={visits.map((v) => `${v.id}:${v.status}:${v.route_position ?? ''}`).join('|')}
          date={date}
          visits={visits}
          customers={customers}
          today={today}
        />
      </div>
    );
  }

  const { counts, error } = await getVisitCountsForMonth(tenantId, date);

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Calendar"
        subtitle="Month workload and £ — tap a day for the plan."
        actions={
          <Button size="sm" asChild>
            <Link href={`/calendar?view=day&date=${today}`}>Open today</Link>
          </Button>
        }
      />
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : null}
      <RoundsMonthGrid
        monthYmd={date}
        counts={counts}
        settings={settings}
        today={today}
      />
    </div>
  );
}
