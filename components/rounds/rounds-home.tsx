'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import {
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PoundSterling,
  Route,
  SkipForward,
  Users,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { optimiseDay } from '@/lib/actions/rounds/visits';
import type { RoundsHomeData } from '@/lib/data/rounds/home';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { DashboardDayNav } from '@/components/dashboard/dashboard-day-nav';
import { Button } from '@/components/ui/button';
import {
  SummaryStrip,
  type SummaryStripItem,
} from '@/components/jobs/status-summary-strip';
import { MoveRemainingDialog } from '@/components/rounds/visit-actions';
import { VisitStopCard } from '@/components/rounds/visit-stop-card';

const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

type HomeFilter = 'remaining' | 'done' | 'skipped';

function isLeftover(status: string): boolean {
  return !['completed', 'cancelled', 'declined', 'incomplete'].includes(status);
}

export function RoundsHome({
  tenantName,
  data,
}: {
  tenantName: string;
  data: RoundsHomeData;
}) {
  const router = useRouter();
  const [optimising, setOptimising] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [listFilter, setListFilter] = useState<HomeFilter | null>(null);

  const leftovers = data.todayVisits.filter((v) => isLeftover(v.status));
  const skippedCount = data.todayVisits.filter((v) => v.status === 'cancelled').length;
  const dayLabelLong = format(parseISO(data.today), 'EEEE d MMMM yyyy');
  const dayLabelShort = format(parseISO(data.today), 'EEE d MMM');

  const summaryItems: SummaryStripItem[] = [
    {
      key: 'remaining',
      title: 'Remaining',
      icon: CircleDashed,
      glow: 'rgb(100 116 139)',
      count: leftovers.length,
    },
    {
      key: 'done',
      title: 'Done',
      icon: CheckCircle2,
      glow: 'rgb(16 185 129)',
      count: data.todayDone,
    },
    {
      key: 'skipped',
      title: 'Skipped',
      icon: SkipForward,
      glow: 'rgb(249 115 22)',
      count: skippedCount,
    },
    {
      key: 'planned_amount',
      title: 'Planned £',
      icon: PoundSterling,
      glow: 'rgb(245 158 11)',
      count: priceFormat.format(data.todayPlannedAmount),
    },
    {
      key: 'week',
      title: 'This week',
      icon: CalendarDays,
      glow: 'rgb(59 130 246)',
      count: data.weekVisitCount,
    },
    {
      key: 'customers',
      title: 'Customers',
      icon: Users,
      glow: 'rgb(6 182 212)',
      count: data.activeCustomers,
    },
  ];

  const visibleVisits =
    listFilter === 'remaining'
      ? data.todayVisits.filter((v) => isLeftover(v.status))
      : listFilter === 'done'
        ? data.todayVisits.filter((v) => v.status === 'completed')
        : listFilter === 'skipped'
          ? data.todayVisits.filter((v) => v.status === 'cancelled')
          : data.todayVisits;

  const onSummarySelect = (key: string) => {
    if (key === 'week') {
      router.push('/calendar');
      return;
    }
    if (key === 'customers') {
      router.push('/customers');
      return;
    }
    if (key === 'planned_amount') {
      setListFilter(null);
      return;
    }
    if (key === 'remaining' || key === 'done' || key === 'skipped') {
      setListFilter((prev) => (prev === key ? null : key));
    }
  };

  const runOptimise = async () => {
    setOptimising(true);
    const result = await optimiseDay(data.today);
    setOptimising(false);
    if (result.success) {
      toast.success(
        `Route optimised · ${result.stops} stops · ${result.distanceKm.toFixed(1)} km`,
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageGradientHeader
        eyebrow={tenantName}
        title={data.isToday ? 'Today' : 'Day schedule'}
        subtitle={
          <>
            <span className="sm:hidden">{dayLabelShort}</span>
            <span className="hidden sm:inline">{dayLabelLong}</span>
          </>
        }
        actions={
          <div className="flex w-full min-w-0 flex-col gap-2">
            <DashboardDayNav selectedDate={data.today} />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button variant="outline" size="sm" className="min-w-0" asChild>
                <Link href={`/calendar?view=day&date=${data.today}`}>
                  <span className="sm:hidden">Day plan</span>
                  <span className="hidden sm:inline">Open day plan</span>
                </Link>
              </Button>
              {leftovers.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0"
                  onClick={() => setMoveOpen(true)}
                >
                  <span className="sm:hidden">Move ({leftovers.length})</span>
                  <span className="hidden sm:inline">
                    Move remaining ({leftovers.length})
                  </span>
                </Button>
              ) : null}
              {data.unorderedToday ? (
                <Button
                  size="sm"
                  className="col-span-2 min-w-0 sm:col-span-1"
                  onClick={() => void runOptimise()}
                  disabled={optimising || leftovers.length < 2}
                >
                  {optimising ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Route className="mr-1.5 size-4" />
                  )}
                  Optimise
                </Button>
              ) : null}
            </div>
          </div>
        }
      />

      {data.catalogEmpty ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Add your services first</p>
          <p className="mt-0.5 text-muted-foreground">
            Defaults for price and how often — each customer gets their own copy.
          </p>
          <Button className="mt-3" size="sm" asChild>
            <Link href="/services">
              <Wrench className="mr-1.5 size-4" />
              Open services
            </Link>
          </Button>
        </div>
      ) : null}

      {data.activeCustomers === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-6 py-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-muted bg-muted/30">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">No customers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first customer to start planning the round.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/customers/new">Add customer</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <SummaryStrip
        label="This day"
        hint="· click to filter this day's list"
        activeKey={listFilter}
        onSelect={onSummarySelect}
        items={summaryItems}
        gridClassName="grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6"
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <h2 className="text-sm font-semibold text-foreground">
            {data.isToday ? "Today's stops" : 'Stops'}
          </h2>
          <Button variant="ghost" size="sm" className="shrink-0 px-2 sm:px-3" asChild>
            <Link href={`/calendar?view=day&date=${data.today}`}>
              <span className="sm:hidden">Calendar</span>
              <span className="hidden sm:inline">Full day plan</span>
            </Link>
          </Button>
        </div>
        {data.todayVisits.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing planned for today. Open the calendar to check another day.
          </div>
        ) : visibleVisits.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
            No stops match this filter.
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleVisits.map((visit, index) => (
              <VisitStopCard
                key={visit.id}
                visit={visit}
                orderIndex={visit.route_position ?? index + 1}
              />
            ))}
          </ul>
        )}
      </section>

      <MoveRemainingDialog
        fromDate={data.today}
        leftoverCount={leftovers.length}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
    </div>
  );
}
