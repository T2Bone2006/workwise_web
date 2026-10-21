import { format, isValid, parseISO } from 'date-fns';
import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { getTenantSkills } from '@/lib/actions/skills';
import { countTeamWorkers, getWorkersForTenant } from '@/lib/data/workers';
import {
  getJobsForTenant,
  getJobsStatusSummary,
  getPendingSendJobsForTenant,
  getFieldFilterValuesForTenant,
  getJobsListColumnsForTenant,
  type JobsFilters,
  type JobStatus,
  type JobPriority,
} from '@/lib/data/jobs';
import {
  SYSTEM_FILTER_FIELDS,
  parseFieldFiltersFromSearchParams,
  type FieldFilterValueOption,
} from '@/lib/jobs/field-filter';
import { JobsTable } from '@/components/jobs/jobs-table';
import { getFieldGroupsForTenant } from '@/lib/data/field-groups';
import { PendingSendJobsBanner } from '@/components/jobs/pending-send-jobs-banner';
import { DeclinedJobsBanner } from '@/components/jobs/declined-jobs-banner';
import { DashboardDayNav } from '@/components/dashboard/dashboard-day-nav';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { getTenantLook } from '@/lib/data/tenant-look';
import { getDeclinedJobs } from '@/lib/data/dashboard';
import { getProHomeData } from '@/lib/data/pro-home';
import { namesLine, summariseDay, teamForDay } from '@/lib/jobs/pro-day';
import { LilyWelcome } from '@/components/assistant/lily-welcome';
import { GetStartedPanel } from '@/components/jobs/overview/get-started-panel';
import { getGetStartedState } from '@/lib/data/get-started';
import { ProKpiTiles } from '@/components/jobs/overview/pro-kpi-tiles';
import { ProNeedsCard } from '@/components/jobs/overview/pro-needs-card';
import { TeamTodayCard } from '@/components/jobs/overview/team-today-card';
import { loadBooksSummary } from '@/lib/books/summary';
import { currentMonth } from '@/lib/books/periods';
import { getRoundsHomeData } from '@/lib/data/rounds/home';
import { getTeamToday } from '@/lib/data/rounds/team-today';
import { loadComingUp } from '@/lib/data/rounds/coming-up';
import { loadNeedsYou } from '@/lib/data/rounds/needs-you';
import { loadWeather } from '@/lib/data/weather';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { loadLatestPayments, loadMoneyTrend, loadRoundValue, loadWeekGlance } from '@/lib/data/rounds/overview';
import { todayInLondon } from '@/lib/rounds/dates';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { createClient } from '@/lib/supabase/server';
import { RoundsHome } from '@/components/rounds/rounds-home';
import { NoProducts } from '@/components/dashboard/no-products';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { dashboardShouldGoToWorker } from '@/lib/auth/worker-link-core';
import { WORKER_HOME } from '@/lib/auth/worker-web-access';
import { PlanEnded } from '@/components/dashboard/plan-ended';
import { ProPlanEnded } from '@/components/dashboard/pro-plan-ended';
import { proRestartChoice } from '@/lib/billing/pro-restart';
import { parsePlanChoice, type PlanChoice } from '@/lib/billing/plans';
import { hasPendingSignup, UNPAID_SIGNUP_PATH } from '@/lib/billing/pending-signup';

interface DashboardPageProps {
  searchParams: Promise<{
    restarted?: string;
    date?: string;
    search?: string;
    status?: string;
    priority?: string;
    customer_id?: string;
    page?: string;
    sort?: string;
    sort_dir?: string;
    group?: string;
    field?: string;
    value?: string;
    f0?: string;
    v0?: string;
    f1?: string;
    v1?: string;
    f2?: string;
    v2?: string;
    f3?: string;
    v3?: string;
    f4?: string;
    v4?: string;
  }>;
}

const VALID_STATUS: JobStatus[] = [
  'pending',
  'pending_send',
  'assigned',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
  'incomplete',
  'declined',
];
const VALID_PRIORITY: JobPriority[] = ['low', 'normal', 'high', 'emergency'];

/** Last self-serve plan, or null when this login should keep the old "no subscription" box (no rows, Pro, or managed). */
async function restartChoice(tenantId: string): Promise<PlanChoice | null> {
  try {
    const supabase = await createClient();
    const [{ data, error }, { data: tenant, error: tenantError }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('plan, billing_interval, source, product, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
      supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
    ]);
    if (error || tenantError || !data || data.length === 0 || !tenant?.stripe_customer_id) return null;
    const pro = new Set<string>(PRO_TIER_PRODUCTS);
    if (data.some((row) => row.source === 'manual' || (row.product != null && pro.has(row.product)))) return null;
    const latest = data[0];
    return parsePlanChoice({ plan: latest?.plan, interval: latest?.billing_interval });
  } catch (err) {
    console.error('[dashboard] restart', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

function firstNameOf(fullName: unknown): string | null {
  if (typeof fullName !== 'string') return null;
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first.length > 0 ? first : null;
}

function todayParam(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function parseDayParam(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return todayParam();
  const parsed = parseISO(value);
  if (!isValid(parsed) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return todayParam();
  return value;
}

function parseSearchParams(
  raw: Awaited<DashboardPageProps['searchParams']>,
  day: string
): JobsFilters & { page?: number; view: 'list' } {
  const statusRaw = raw.status?.trim();
  const status: JobStatus | JobStatus[] | undefined = statusRaw
    ? statusRaw.includes(',')
      ? (statusRaw.split(',').filter((s) => VALID_STATUS.includes(s as JobStatus)) as JobStatus[])
      : VALID_STATUS.includes(statusRaw as JobStatus)
        ? (statusRaw as JobStatus)
        : undefined
    : undefined;
  const priority =
    raw.priority && VALID_PRIORITY.includes(raw.priority as JobPriority)
      ? (raw.priority as JobPriority)
      : undefined;
  const page = raw.page ? Math.max(1, parseInt(raw.page, 10) || 1) : undefined;
  const sort =
    raw.sort === 'reference_number' ||
    raw.sort === 'status' ||
    raw.sort === 'priority' ||
    raw.sort === 'scheduled_date' ||
    raw.sort === 'customer_name' ||
    raw.sort === 'created_at'
      ? raw.sort
      : 'scheduled_date';
  const sort_dir =
    raw.sort_dir === 'asc' || raw.sort_dir === 'desc'
      ? raw.sort_dir
      : raw.sort
        ? undefined
        : 'asc';
  const field_filters = parseFieldFiltersFromSearchParams(raw);
  return {
    search: raw.search?.trim() || undefined,
    status,
    priority,
    customer_id: raw.customer_id?.trim() || undefined,
    job_group_id: raw.group?.trim() || undefined,
    date_from: day,
    date_to: day,
    field_filters: field_filters.length > 0 ? field_filters : undefined,
    sort,
    sort_dir: sort_dir ?? 'asc',
    page,
    view: 'list',
  };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [tenantId, tenantName, products, rawParams] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantNameForCurrentUser(),
    getTenantProducts(),
    searchParams,
  ]);

  if (!tenantId) {
    const { user } = await getAuthUser();
    if (user && (await hasPendingSignup(user.id))) redirect(UNPAID_SIGNUP_PATH);
    redirect('/login');
  }

  // A self-employed worker with no plan of their own (or only Lite) lands on their worker area.
  if (products.primary === null || products.primary === 'lite') {
    const workerLink = await getWorkerLink();
    if (dashboardShouldGoToWorker({ primary: products.primary, hasWorkerLink: workerLink !== null })) {
      redirect(WORKER_HOME);
    }
  }

  // Non-Pro tenants get their product's home here; /dashboard stays the one
  // URL every login lands on.
  if (products.primary === 'rounds') {
    const supabase = await createClient();
    const { user } = await getAuthUser();
    const today = todayInLondon();
    // The overview is always today; other days live in the calendar. Each card's
    // read fails on its own (that card says so) and never breaks the page.
    const settings = await getRoundsSettings(supabase, tenantId);
    const dataPromise = getRoundsHomeData(tenantId);
    const [data, needs, books, comingUp, week, trend, latestPayments, roundValue, nameRow, teamToday, weather] = await Promise.all([
      dataPromise,
      loadNeedsYou(supabase, { tenantId, today }),
      loadBooksSummary(supabase, { tenantId, period: currentMonth(today) }).catch(() => null),
      loadComingUp(supabase, { tenantId, weeks: 4 }).catch(() => null),
      loadWeekGlance({ tenantId, today, settings }).catch(() => null),
      loadMoneyTrend(supabase, { tenantId, today }),
      loadLatestPayments(supabase, tenantId).catch(() => null),
      loadRoundValue(supabase, tenantId).catch(() => null),
      user?.id
        ? supabase
            .from('users')
            .select('full_name')
            .eq('id', user.id)
            .maybeSingle()
            .then(
              (row) => row,
              () => ({ data: null }),
            )
        : Promise.resolve({ data: null }),
      // Only the owner's Dashboard has this card; a read problem leaves the card out and nothing else.
      getTeamToday(tenantId, today).catch(() => null),
      // Starts with everything else; it only waits for today's visits when there is no start postcode.
      loadWeather(supabase, {
        tenantId,
        startPostcode: settings.start_postcode,
        visitPoints: dataPromise.then((d) => d.todayVisits),
      }),
    ]);
    const firstName = firstNameOf(nameRow.data?.full_name) ?? firstNameOf(user?.user_metadata?.full_name);
    return (
      <RoundsHome
        tenantName={tenantName}
        firstName={firstName}
        data={data}
        needs={needs}
        books={books}
        trend={trend?.months ?? null}
        lastMonthToDate={trend?.lastMonthToDate ?? null}
        latestPayments={latestPayments}
        week={week}
        comingUp={comingUp}
        workingDays={settings.working_days}
        roundValue={roundValue}
        weather={weather}
        teamToday={teamToday}
      />
    );
  }
  if (products.primary === 'lite') {
    redirect(rawParams.restarted === '1' ? '/lite?restarted=1' : '/lite');
  }
  if (products.primary === null) {
    const choice = await restartChoice(tenantId);
    if (choice) return <PlanEnded defaultChoice={choice} />;
    const proChoice = await proRestartChoice(tenantId);
    if (proChoice) {
      const team = await countTeamWorkers(tenantId, { includePending: true });
      return <ProPlanEnded defaultChoice={proChoice} teamSize={team ?? 0} />;
    }
    return <NoProducts tenantName={tenantName} />;
  }

  const day = parseDayParam(rawParams.date);
  const filters = parseSearchParams(rawParams, day);

  const newLook = (await getTenantLook(products)) === 'new';

  const [
    statusSummary,
    { jobs: pendingSendJobs },
    tenantSkills,
    visibleColumns,
    { workers },
    { jobs, totalCount, error },
    proHome,
    declinedJobs,
    getStarted,
    fieldGroups,
  ] = await Promise.all([
    getJobsStatusSummary(tenantId, { date_from: day, date_to: day }),
    getPendingSendJobsForTenant(tenantId),
    getTenantSkills(tenantId),
    getJobsListColumnsForTenant(tenantId),
    getWorkersForTenant(tenantId),
    getJobsForTenant(tenantId, filters),
    newLook ? getProHomeData(tenantId, day) : Promise.resolve(null),
    newLook ? getDeclinedJobs(tenantId) : Promise.resolve([]),
    newLook ? getGetStartedState(tenantId) : Promise.resolve(null),
    getFieldGroupsForTenant(tenantId),
  ]);

  const fieldFilterOptions = SYSTEM_FILTER_FIELDS.map((f) => ({
    value: f.key,
    label: f.label,
    group: 'System',
  }));

  let fieldFilterValuesByField: Record<string, FieldFilterValueOption[]> = {};
  const fieldsNeedingValues = [...new Set((filters.field_filters ?? []).map((f) => f.field))];
  if (fieldsNeedingValues.length > 0) {
    const entries = await Promise.all(
      fieldsNeedingValues.map(async (field) => {
        const valuesResult = await getFieldFilterValuesForTenant(tenantId, field);
        return [field, valuesResult.values] as const;
      })
    );
    fieldFilterValuesByField = Object.fromEntries(entries);
  }

  const dayLabel = format(parseISO(day), 'EEEE d MMMM yyyy');
  const isToday = day === format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="space-y-5">
      <PageGradientHeader
        eyebrow={tenantName ?? 'Schedule'}
        title={isToday ? "Today's jobs" : 'Day schedule'}
        subtitle={dayLabel}
        actions={<DashboardDayNav selectedDate={day} />}
      />

      {newLook && proHome ? (
        <>
          {getStarted ? <GetStartedPanel state={getStarted} /> : null}
          <LilyWelcome pro />
          <ProKpiTiles
            day={day}
            isToday={isToday}
            counts={summariseDay(proHome.dayJobs)}
            onJobNames={namesLine(
              teamForDay(
                workers.map((w) => ({ id: w.id, name: w.full_name })),
                proHome.dayJobs,
              )
                .filter((m) => m.onJob)
                .map((m) => m.name),
            )}
            declined={declinedJobs.length}
            unassigned={proHome.needs.unassigned.count}
            notCompleted={proHome.needs.notCompleted.count}
          />
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <ProNeedsCard
                fill
                declined={declinedJobs}
                pendingSend={pendingSendJobs}
                needs={proHome.needs}
                tenantSkills={tenantSkills}
              />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <TeamTodayCard
                team={teamForDay(
                  workers.map((w) => ({ id: w.id, name: w.full_name })),
                  proHome.dayJobs,
                )}
                isToday={isToday}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <DeclinedJobsBanner variant="red" />
          <PendingSendJobsBanner jobs={pendingSendJobs} tenantSkills={tenantSkills} />
        </>
      )}

      <JobsTable
        initialJobs={Array.isArray(jobs) ? jobs : []}
        totalCount={typeof totalCount === 'number' ? totalCount : 0}
        initialFilters={filters}
        fetchError={error}
        statusSummary={statusSummary}
        batches={[]}
        activeBatchId={null}
        fieldFilterOptions={fieldFilterOptions}
        fieldFilterValuesByField={fieldFilterValuesByField}
        initialVisibleColumns={visibleColumns}
        fieldGroups={fieldGroups}
        workers={workers.map((w) => ({ id: w.id, full_name: w.full_name }))}
        basePath="/dashboard"
        variant="day"
      />
    </div>
  );
}
