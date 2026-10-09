import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Route loading placeholders. Each one follows the page it stands in for
 * (header, tabs, tiles, table) so the screen doesn't jump when the data arrives.
 */

const card =
  'rounded-xl border border-border/70 bg-card [[data-look=new]_&]:rounded-2xl [[data-look=new]_&]:shadow-(--look-card-shadow)';

function slots(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function LoadingScreen({
  children,
  className,
  label = 'Loading',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn('animate-in fade-in space-y-6 duration-200', className)}>
      {children}
    </div>
  );
}

/** PageGradientHeader: a gradient band in the classic look, a plain title in the new look. */
export function HeaderSkeleton({
  eyebrow = false,
  title = 'w-40',
  subtitle = 'w-72',
  actions,
}: {
  eyebrow?: boolean;
  title?: string;
  subtitle?: string | false;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5',
        '[[data-look=new]_&]:rounded-none [[data-look=new]_&]:border-0 [[data-look=new]_&]:bg-transparent [[data-look=new]_&]:p-0 [[data-look=new]_&]:shadow-none [[data-look=new]_&]:sm:items-end',
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow ? <Skeleton className="h-3 w-24" /> : null}
        <Skeleton className={cn('h-8 max-w-full', title)} />
        {subtitle ? <Skeleton className={cn('h-4 max-w-full', subtitle)} /> : null}
      </div>
      {actions ? <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div> : null}
    </div>
  );
}

function DayNav() {
  return (
    <>
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="h-9 w-44 max-w-full rounded-md" />
      <Skeleton className="size-9 rounded-md" />
    </>
  );
}

export function BackRow({
  title = 'w-48',
  subtitle = 'w-64',
  action = false,
}: {
  title?: string;
  subtitle?: string | false;
  action?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="size-9 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className={cn('h-7 max-w-full', title)} />
        {subtitle ? <Skeleton className={cn('h-4 max-w-full', subtitle)} /> : null}
      </div>
      {action ? <Skeleton className="h-9 w-28 shrink-0 rounded-md" /> : null}
    </div>
  );
}

export function TabsSkeleton({ widths }: { widths: string[] }) {
  return (
    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-muted/80 p-1.5 [[data-look=new]_&]:rounded-2xl [[data-look=new]_&]:border [[data-look=new]_&]:border-border [[data-look=new]_&]:bg-card [[data-look=new]_&]:shadow-(--look-card-shadow)">
      {widths.map((width, i) => (
        <Skeleton key={i} className={cn('h-8 rounded-lg', width)} />
      ))}
    </div>
  );
}

/** Status summary: pills in one band (classic) or a row of tiles (new look). */
export function StatusTilesSkeleton({ count = 7 }: { count?: number }) {
  return (
    <>
      <div className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2.5 sm:px-3.5 sm:py-3 [[data-look=new]_&]:hidden">
        <Skeleton className="mb-2.5 h-3 w-24" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {slots(count).map((i) => (
            <Skeleton key={i} className="h-10 rounded-full" />
          ))}
        </div>
      </div>
      <div className="hidden flex-col gap-2 [[data-look=new]_&]:flex">
        <Skeleton className="h-3 w-20" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {slots(count).map((i) => (
            <div key={i} className={cn(card, 'flex min-h-[4rem] items-center gap-3 px-3.5 py-2.5')}>
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-5 w-8" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function StatRow({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {slots(count).map((i) => (
        <div key={i} className={cn(card, 'space-y-2 p-4')}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function TableCardSkeleton({
  filters = 1,
  columns = 4,
  rows = 6,
  labelled = false,
  plain = false,
}: {
  filters?: number;
  columns?: number;
  rows?: number;
  labelled?: boolean;
  /** Skip the outer card when the table already sits inside one. */
  plain?: boolean;
}) {
  return (
    <div className={cn(!plain && card, !plain && 'p-4', plain && 'px-4 pb-2')}>
      {filters > 0 ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {slots(filters).map((i) => (
            <div key={i} className="space-y-1.5">
              {labelled ? <Skeleton className="h-3 w-16" /> : null}
              <Skeleton className={cn('h-10', i === 0 ? 'w-56 max-w-full' : 'w-40')} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-1 hidden gap-4 border-b border-border/60 px-1 pb-2 sm:flex">
        {slots(columns).map((i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div>
        {slots(rows).map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/40 px-1 py-3 last:border-0">
            {slots(columns).map((col) => (
              <Skeleton key={col} className={cn('h-4 flex-1', col === columns - 1 && 'max-w-16')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ className }: { className?: string }) {
  return (
    <div className={cn(card, 'space-y-3 p-4', className)}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function JobsTableBlock({ filters = 1, labelled = false }: { filters?: number; labelled?: boolean }) {
  return (
    <div className="space-y-4">
      <StatusTilesSkeleton />
      <TableCardSkeleton filters={filters} labelled={labelled} columns={5} rows={6} />
    </div>
  );
}

export function JobsDaySkeleton() {
  return (
    <LoadingScreen label="Loading today's jobs">
      <HeaderSkeleton eyebrow title="w-40" subtitle="w-52" actions={<DayNav />} />
      <JobsTableBlock filters={1} labelled />
    </LoadingScreen>
  );
}

export function JobsListSkeleton() {
  return (
    <LoadingScreen label="Loading jobs">
      <HeaderSkeleton title="w-20" subtitle="w-64" />
      <JobsTableBlock filters={2} labelled />
    </LoadingScreen>
  );
}

export function JobDetailSkeleton() {
  return (
    <LoadingScreen label="Loading job">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Panel className="h-52" />
          <Panel className="h-40" />
          <Panel className="h-64" />
        </div>
        <div className="space-y-6">
          <Panel className="h-40" />
          <Panel className="h-48" />
          <Panel className="h-36" />
        </div>
      </div>
    </LoadingScreen>
  );
}

export function FormPageSkeleton({
  title = 'w-40',
  subtitle = 'w-72',
  fields = 6,
}: {
  title?: string;
  subtitle?: string | false;
  fields?: number;
}) {
  return (
    <LoadingScreen label="Loading form">
      <BackRow title={title} subtitle={subtitle} />
      <div className={cn(card, 'p-5')}>
        <div className="grid gap-5 lg:grid-cols-2">
          {slots(fields).map((i) => (
            <div key={i} className={cn('space-y-2', i === fields - 1 && fields % 2 === 1 && 'lg:col-span-2')}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
    </LoadingScreen>
  );
}

export function ReviewSkeleton() {
  return (
    <LoadingScreen label="Loading jobs for review">
      <BackRow title="w-44" subtitle="w-80" />
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-48" />
        <Panel className="h-36" />
        {slots(4).map((i) => (
          <div key={i} className={cn(card, 'flex items-center gap-3 p-3')}>
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function CustomersPageSkeleton() {
  return (
    <LoadingScreen label="Loading customers">
      <HeaderSkeleton title="w-36" subtitle="w-80" />
      <TabsSkeleton widths={['w-28', 'w-36', 'w-40', 'w-28']} />
      <TableCardSkeleton filters={2} columns={4} rows={7} />
    </LoadingScreen>
  );
}

export function CustomerDetailSkeleton() {
  return (
    <LoadingScreen label="Loading customer">
      <BackRow title="w-48" subtitle="w-56" action />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel className="h-40" />
          <div className={cn(card, 'p-4')}>
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-28" />
            </div>
            {slots(4).map((i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border/40 py-3 last:border-0">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="ml-auto h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <Panel className="h-28" />
          <Panel className="h-44" />
          <Panel className="h-36" />
        </div>
      </div>
    </LoadingScreen>
  );
}

export function WorkersPageSkeleton() {
  return (
    <LoadingScreen label="Loading workers">
      <HeaderSkeleton title="w-28" subtitle="w-64" />
      <TabsSkeleton widths={['w-24', 'w-28', 'w-28']} />
      <TableCardSkeleton filters={2} columns={5} rows={6} />
    </LoadingScreen>
  );
}

export function WorkerDetailSkeleton() {
  return (
    <LoadingScreen label="Loading worker" className="p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-9 w-32 shrink-0" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {slots(4).map((i) => (
          <div key={i} className={cn(card, 'space-y-2 p-4')}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="h-48" />
        <Panel className="h-48" />
      </div>
    </LoadingScreen>
  );
}

export function SettingsPageSkeleton() {
  return (
    <LoadingScreen label="Loading settings">
      <HeaderSkeleton title="w-28" subtitle="w-80" />
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        <div className={cn(card, 'flex h-auto w-full shrink-0 flex-row gap-1 overflow-x-auto p-1.5 md:sticky md:w-56 md:flex-col md:p-2')}>
          {slots(7).map((i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2.5">
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className={cn('h-4', i === 0 ? 'w-20' : 'w-24')} />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-4 md:max-w-[880px]">
          <div className={cn(card, 'space-y-5 p-5')}>
            <Skeleton className="h-5 w-40" />
            {slots(5).map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
      </div>
    </LoadingScreen>
  );
}

function PaymentsChrome({ body }: { body: ReactNode }) {
  return (
    <LoadingScreen label="Loading payments">
      <HeaderSkeleton title="w-32" subtitle="w-96" actions={<Skeleton className="h-9 w-36" />} />
      <div className={cn(card, 'h-24')} />
      <div className={cn(card, 'space-y-3 p-4')}>
        <Skeleton className="h-4 w-40" />
        {slots(3).map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
      <TabsSkeleton widths={['w-24', 'w-28', 'w-24', 'w-24']} />
      {body}
    </LoadingScreen>
  );
}

export function PaymentsOverviewSkeleton() {
  return (
    <PaymentsChrome
      body={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-72 max-w-full rounded-xl" />
          </div>
          <StatRow count={3} className="lg:grid-cols-[1.5fr_1fr_1fr]" />
          <div className={cn(card, 'h-64')} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="h-56" />
            <Panel className="h-56" />
          </div>
        </div>
      }
    />
  );
}

export function PaymentsListSkeleton() {
  return <PaymentsChrome body={<TableCardSkeleton filters={1} columns={4} rows={6} />} />;
}

export function InvoicePageSkeleton() {
  return (
    <LoadingScreen label="Loading invoice">
      <Skeleton className="h-4 w-24" />
      <HeaderSkeleton title="w-32" subtitle="w-56" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={cn(card, 'space-y-4 p-5')}>
          <div className="flex justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          {slots(4).map((i) => (
            <div key={i} className="flex justify-between gap-4 border-b border-border/40 py-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
          <Skeleton className="ml-auto h-6 w-24" />
        </div>
        <div className="space-y-4">
          <Panel className="h-36" />
          <Panel className="h-28" />
        </div>
      </div>
    </LoadingScreen>
  );
}

export function DirectDebitsSkeleton() {
  return (
    <LoadingScreen label="Loading direct debits">
      <Skeleton className="h-4 w-24" />
      <HeaderSkeleton title="w-56" subtitle="w-full max-w-xl" />
      <Skeleton className="h-10 w-64 max-w-full" />
      <div className="space-y-3">
        {slots(5).map((i) => (
          <div key={i} className={cn(card, 'space-y-2 p-3')}>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-9 w-48" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function ExpensesPageSkeleton() {
  return (
    <LoadingScreen label="Loading expenses">
      <HeaderSkeleton title="w-32" subtitle="w-72" />
      <TabsSkeleton widths={['w-28', 'w-24']} />
      <StatRow count={3} />
      <div className="flex flex-col gap-3 lg:flex-row">
        <Skeleton className="h-14 flex-1 rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-2xl lg:w-44" />
      </div>
      <div className="space-y-2">
        {slots(5).map((i) => (
          <div key={i} className={cn(card, 'flex items-center gap-3 p-3')}>
            <Skeleton className="size-10 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function InOutSkeleton() {
  return (
    <LoadingScreen label="Loading money in and out">
      <HeaderSkeleton title="w-32" subtitle="w-72" />
      <TabsSkeleton widths={['w-28', 'w-24']} />
      <Skeleton className="h-10 w-full max-w-md rounded-xl" />
      <StatRow count={3} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="h-64" />
        <Panel className="h-64" />
      </div>
    </LoadingScreen>
  );
}

export function WeekCalendarSkeleton() {
  return (
    <LoadingScreen label="Loading calendar">
      <HeaderSkeleton title="w-28" subtitle="w-80" actions={<Skeleton className="h-8 w-28" />} />
      <div className="flex gap-2 overflow-hidden">
        {slots(5).map((day) => (
          <div key={day} className={cn(card, 'flex h-[calc(100vh-14rem)] min-h-80 min-w-0 flex-1 flex-col gap-2 p-2')}>
            <Skeleton className="mx-auto h-4 w-16" />
            {slots(day % 2 === 0 ? 4 : 3).map((i) => (
              <div key={i} className="space-y-1.5 rounded-lg border border-border/50 p-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function MonthCalendarSkeleton() {
  return (
    <LoadingScreen label="Loading calendar">
      <HeaderSkeleton
        title="w-28"
        subtitle="w-72"
        actions={
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-32" />
          </>
        }
      />
      <div className={cn(card, 'overflow-hidden')}>
        <div className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
          {slots(7).map((i) => (
            <Skeleton key={i} className="mx-auto my-2 h-3 w-6" />
          ))}
        </div>
        <div className="grid grid-cols-7">
          {slots(35).map((i) => (
            <div key={i} className="h-16 border-b border-r border-border/40 p-1.5 sm:h-24">
              <Skeleton className="h-3 w-4" />
              {i % 4 === 0 ? <Skeleton className="mt-2 h-4 w-full" /> : null}
            </div>
          ))}
        </div>
      </div>
    </LoadingScreen>
  );
}

export function DayCalendarSkeleton() {
  return (
    <LoadingScreen label="Loading the day">
      <HeaderSkeleton
        title="w-28"
        subtitle="w-72"
        actions={
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-32" />
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="size-8 rounded-md" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-2">
        {slots(6).map((i) => (
          <div key={i} className={cn(card, 'flex items-center gap-3 p-3')}>
            <Skeleton className="h-10 w-1" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

function ThreadListSkeleton() {
  return (
    <div className={cn(card, 'overflow-hidden')}>
      <div className="space-y-2.5 border-b border-border p-3">
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="size-10 shrink-0" />
        </div>
        <div className="flex gap-1.5">
          {['w-12', 'w-16', 'w-16', 'w-24', 'w-20', 'w-14'].map((width, i) => (
            <Skeleton key={i} className={cn('h-7 rounded-full', width)} />
          ))}
        </div>
      </div>
      {slots(7).map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border/40 px-3 py-3 last:border-0">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <LoadingScreen label="Loading messages">
      <HeaderSkeleton title="w-32" subtitle="w-80" actions={<Skeleton className="h-9 w-36 rounded-full" />} />
      <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <ThreadListSkeleton />
        <div className="hidden lg:block">
          <EmptyPaneSkeleton />
        </div>
      </div>
    </LoadingScreen>
  );
}

export function EmptyPaneSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12">
        <Skeleton className="size-12 rounded-2xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
      <div className={cn(card, 'h-28')} />
    </div>
  );
}

export function ThreadPaneSkeleton() {
  return (
    <div role="status" aria-label="Loading conversation" className="animate-in fade-in space-y-4 duration-200">
      <div className={cn(card, 'flex items-center gap-3 p-4')}>
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-9 w-16" />
      </div>
      <div className={cn(card, 'space-y-3 p-4')}>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className={cn(card, 'space-y-3 p-4')}>
        {slots(4).map((i) => (
          <Skeleton key={i} className={cn('h-12 max-w-[75%] rounded-2xl', i % 2 === 0 ? 'ml-auto w-2/3' : 'w-1/2')} />
        ))}
      </div>
    </div>
  );
}

export function TextsBoughtSkeleton() {
  return (
    <LoadingScreen label="Loading texts">
      <HeaderSkeleton title="w-20" subtitle={false} />
      <div className={cn(card, 'mx-auto max-w-xl space-y-3 p-6 sm:p-8')}>
        <div className="flex gap-4">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </LoadingScreen>
  );
}

export function ServicesPageSkeleton() {
  return (
    <LoadingScreen label="Loading services">
      <HeaderSkeleton title="w-28" subtitle="w-full max-w-2xl" />
      <StatRow count={3} />
      <div className={cn(card, 'overflow-hidden')}>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
        <TableCardSkeleton filters={0} columns={5} rows={6} plain />
      </div>
    </LoadingScreen>
  );
}

export function MapSkeleton() {
  return (
    <div role="status" aria-label="Loading map" className="min-h-[calc(100dvh-3.5rem)] w-full">
      <Skeleton className="h-full min-h-[calc(100dvh-3.5rem)] w-full rounded-none" />
    </div>
  );
}

export function AssistantSkeleton() {
  return (
    <div role="status" aria-label="Loading Lily" className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-6">
        <Skeleton className="size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {slots(3).map((i) => (
            <Skeleton key={i} className="h-9 w-40 rounded-full" />
          ))}
        </div>
      </div>
      <div className="border-t border-border p-4">
        <Skeleton className="mx-auto h-12 w-full max-w-3xl rounded-2xl" />
      </div>
    </div>
  );
}

export function LeadsPageSkeleton() {
  return (
    <LoadingScreen label="Loading leads">
      <HeaderSkeleton title="w-20" subtitle="w-72" />
      <StatRow count={4} className="grid-cols-2 md:grid-cols-4 lg:grid-cols-4" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {slots(4).map((col) => (
          <div key={col} className={cn(card, 'space-y-2 p-3')}>
            <div className="flex items-center gap-2 px-1 py-1">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
            {slots(col === 0 ? 3 : 2).map((i) => (
              <div key={i} className="space-y-2 rounded-xl border border-border/60 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function ConversationsPageSkeleton() {
  return (
    <LoadingScreen label="Loading conversations" className="gap-8">
      <HeaderSkeleton title="w-40" subtitle="w-80" />
      <StatRow count={3} />
      <div className="flex flex-wrap gap-2">
        {['w-14', 'w-24', 'w-20', 'w-16'].map((width, i) => (
          <Skeleton key={i} className={cn('h-8 rounded-full', width)} />
        ))}
      </div>
      <div className="space-y-2.5">
        {slots(6).map((i) => (
          <div key={i} className={cn(card, 'space-y-2 p-4')}>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function ConversationDetailSkeleton() {
  return (
    <LoadingScreen label="Loading conversation">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className={cn(card, 'space-y-3 p-4')}>
        {slots(6).map((i) => (
          <Skeleton key={i} className={cn('h-14 max-w-[80%] rounded-2xl', i % 2 === 0 ? 'w-2/3' : 'ml-auto w-1/2')} />
        ))}
      </div>
    </LoadingScreen>
  );
}

export function SetupPageSkeleton() {
  return (
    <LoadingScreen label="Loading setup">
      <HeaderSkeleton title="w-64" subtitle="w-80" />
      <div className={cn(card, 'space-y-4 p-5')}>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    </LoadingScreen>
  );
}

export function WidgetPageSkeleton() {
  return (
    <LoadingScreen label="Loading widget">
      <HeaderSkeleton title="w-24" subtitle="w-96" actions={<Skeleton className="h-8 w-32" />} />
      <div className={cn(card, 'h-28')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="h-48" />
        <Panel className="h-48" />
      </div>
      <Panel className="h-40" />
    </LoadingScreen>
  );
}

export function PricingPageSkeleton() {
  return (
    <LoadingScreen label="Loading pricing">
      <Skeleton className="h-4 w-20" />
      <HeaderSkeleton title="w-40" subtitle="w-96" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="h-56" />
        <Panel className="h-56" />
      </div>
    </LoadingScreen>
  );
}

export function LeadDetailSkeleton() {
  return (
    <LoadingScreen label="Loading lead">
      <Skeleton className="h-4 w-16" />
      <div className={cn(card, 'flex items-center gap-4 p-4 sm:p-5')}>
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="h-40" />
        <Panel className="h-40" />
      </div>
    </LoadingScreen>
  );
}

export function NetworkPageSkeleton() {
  return (
    <LoadingScreen label="Loading network">
      <HeaderSkeleton title="w-28" subtitle="w-80" />
      <TabsSkeleton widths={['w-32', 'w-24']} />
      <div className={cn(card, 'space-y-4 p-5')}>
        <Skeleton className="h-5 w-36" />
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      {slots(3).map((i) => (
        <div key={i} className={cn(card, 'flex items-center gap-3 p-4')}>
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </LoadingScreen>
  );
}

export function MonitorPageSkeleton() {
  return (
    <LoadingScreen label="Loading monitor" className="space-y-4">
      <HeaderSkeleton title="w-28" subtitle="w-72" />
      <TableCardSkeleton filters={3} columns={5} rows={8} />
    </LoadingScreen>
  );
}

export function ImportPageSkeleton() {
  return (
    <LoadingScreen label="Loading import">
      <HeaderSkeleton title="w-48" subtitle="w-96" />
      <div className={cn(card, 'flex h-48 flex-col items-center justify-center gap-3 border-dashed p-8')}>
        <Skeleton className="size-12 rounded-xl" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {slots(3).map((i) => (
          <Panel key={i} className="h-28" />
        ))}
      </div>
    </LoadingScreen>
  );
}

function OfferHero({ wide = false }: { wide?: boolean }) {
  return (
    <LoadingScreen label="Loading" className="mx-auto max-w-5xl">
      <div className={cn(card, 'space-y-3 rounded-3xl p-5 sm:p-7')}>
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className={cn('h-10', wide ? 'w-80' : 'w-72', 'max-w-full')} />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-4 w-2/3 max-w-md" />
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {slots(3).map((i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-border p-3">
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className={cn(card, 'h-40')} />
    </LoadingScreen>
  );
}

export function ReferPageSkeleton() {
  return <OfferHero />;
}

export function AddLitePageSkeleton() {
  return <OfferHero wide />;
}

export function ViewAsPageSkeleton() {
  return (
    <LoadingScreen label="Loading view as">
      <HeaderSkeleton title="w-44" subtitle="w-full max-w-xl" />
      <div className={cn(card, 'p-4')}>
        <Skeleton className="mb-4 h-10 w-full max-w-sm" />
        {slots(8).map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-b border-border/40 py-3 last:border-0">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

export function AiAnalyticsSkeleton() {
  return (
    <LoadingScreen label="Loading analytics" className="p-8">
      <div className={cn(card, 'h-20')} />
      <HeaderSkeleton title="w-72" subtitle="w-96" />
      <div className={cn(card, 'space-y-2 p-5')}>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn(card, 'h-64')} />
        <div className={cn(card, 'h-64')} />
      </div>
    </LoadingScreen>
  );
}

export function PortalHomeSkeleton() {
  return (
    <LoadingScreen label="Loading your jobs">
      <HeaderSkeleton eyebrow title="w-32" subtitle="w-96" actions={<Skeleton className="h-9 w-40" />} />
      <JobsTableBlock filters={2} labelled />
    </LoadingScreen>
  );
}

export function PortalJobDetailSkeleton() {
  return (
    <LoadingScreen label="Loading job">
      <Skeleton className="h-4 w-24" />
      <HeaderSkeleton eyebrow title="w-36" subtitle="w-40" actions={<Skeleton className="h-6 w-20 rounded-full" />} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="h-48" />
        <Panel className="h-48" />
      </div>
    </LoadingScreen>
  );
}

function BooksHeader({ title = 'w-28' }: { title?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className={cn('h-6', title)} />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

export function BooksSummarySkeleton() {
  return (
    <LoadingScreen label="Loading summary" className="space-y-5">
      <BooksHeader title="w-24" />
      <Skeleton className="h-10 w-full max-w-lg rounded-xl" />
      <StatRow count={3} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="h-56" />
        <Panel className="h-56" />
      </div>
    </LoadingScreen>
  );
}

export function BooksTableSkeleton({ title = 'w-24' }: { title?: string }) {
  return (
    <LoadingScreen label="Loading" className="space-y-5">
      <BooksHeader title={title} />
      <Skeleton className="h-10 w-full max-w-lg rounded-xl" />
      <TableCardSkeleton filters={1} columns={5} rows={8} />
    </LoadingScreen>
  );
}

export function BooksDownloadsSkeleton() {
  return (
    <LoadingScreen label="Loading downloads" className="space-y-5">
      <BooksHeader title="w-32" />
      <div className={cn(card, 'space-y-4 p-5')}>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-40" />
        </div>
        {slots(4).map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </LoadingScreen>
  );
}

/** Used while a layout above the page is still resolving, before that page's own loading file takes over. */
export function skeletonForPath(pathname: string): ReactNode {
  const path = pathname.replace(/\/$/, '') || '/';

  if (path === '/dashboard' || path === '/rounds') return <JobsDaySkeleton />;
  if (path === '/portal') return <PortalHomeSkeleton />;
  if (path === '/jobs') return <JobsListSkeleton />;
  if (path === '/jobs/new') return <FormPageSkeleton title="w-28" subtitle="w-56" />;
  if (path === '/jobs/review') return <ReviewSkeleton />;
  if (/^\/jobs\/[^/]+$/.test(path)) return <JobDetailSkeleton />;

  if (path === '/customers') return <CustomersPageSkeleton />;
  if (path === '/customers/new') return <FormPageSkeleton title="w-36" subtitle="w-72" />;
  if (/^\/customers\/[^/]+$/.test(path)) return <CustomerDetailSkeleton />;
  if (/^\/customers\/[^/]+\/edit$/.test(path)) return <FormPageSkeleton title="w-40" subtitle="w-48" />;
  if (/^\/customers\/[^/]+\/agreements\/(new|[^/]+\/edit)$/.test(path)) {
    return <FormPageSkeleton title="w-44" subtitle="w-56" />;
  }

  if (path === '/workers') return <WorkersPageSkeleton />;
  if (path === '/workers/new') return <FormPageSkeleton title="w-36" subtitle="w-48" />;
  if (/^\/workers\/[^/]+$/.test(path)) return <WorkerDetailSkeleton />;
  if (/^\/workers\/[^/]+\/edit$/.test(path)) return <FormPageSkeleton title="w-36" subtitle="w-40" />;

  if (path === '/network') return <NetworkPageSkeleton />;
  if (path === '/monitor') return <MonitorPageSkeleton />;
  if (path === '/settings') return <SettingsPageSkeleton />;
  if (path === '/payments') return <PaymentsOverviewSkeleton />;
  if (path === '/payments/direct-debits') return <DirectDebitsSkeleton />;
  if (/^\/payments\/invoices\/[^/]+$/.test(path)) return <InvoicePageSkeleton />;
  if (path === '/expenses') return <ExpensesPageSkeleton />;
  if (path === '/calendar') return <WeekCalendarSkeleton />;
  if (path === '/messages' || path === '/messages/by-customer') return <InboxSkeleton />;
  if (path === '/messages/texts-bought') return <TextsBoughtSkeleton />;
  if (/^\/messages\/[^/]+$/.test(path)) return <InboxSkeleton />;
  if (path === '/services') return <ServicesPageSkeleton />;
  if (path === '/map') return <MapSkeleton />;
  if (path === '/import') return <ImportPageSkeleton />;
  if (path === '/assistant') return <AssistantSkeleton />;
  if (path === '/lite') return <LeadsPageSkeleton />;
  if (path === '/lite/conversations') return <ConversationsPageSkeleton />;
  if (/^\/lite\/conversations\/[^/]+$/.test(path)) return <ConversationDetailSkeleton />;
  if (path === '/lite/setup') return <SetupPageSkeleton />;
  if (path === '/lite/widget') return <WidgetPageSkeleton />;
  if (path === '/lite/widget/pricing') return <PricingPageSkeleton />;
  if (/^\/lite\/leads\/[^/]+$/.test(path)) return <LeadDetailSkeleton />;
  if (path === '/refer') return <ReferPageSkeleton />;
  if (path === '/add-lite') return <AddLitePageSkeleton />;
  if (path === '/admin/view-as') return <ViewAsPageSkeleton />;
  if (path === '/admin/ai-analytics') return <AiAnalyticsSkeleton />;
  if (/^\/portal\/jobs\/[^/]+$/.test(path)) return <PortalJobDetailSkeleton />;

  return <JobsListSkeleton />;
}
