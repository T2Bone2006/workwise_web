'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DayCalendarSkeleton, MonthCalendarSkeleton, WeekCalendarSkeleton } from '@/components/layout/page-skeletons';

function CalendarBody() {
  const view = useSearchParams().get('view');
  if (view === 'day') return <DayCalendarSkeleton />;
  if (view === 'month') return <MonthCalendarSkeleton />;
  return <WeekCalendarSkeleton />;
}

/** Default is the week board. Day and month follow the view in the address. */
export default function CalendarLoading() {
  return (
    <Suspense fallback={<WeekCalendarSkeleton />}>
      <CalendarBody />
    </Suspense>
  );
}
