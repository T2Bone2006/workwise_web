import { addDays, compareYmd, startOfMonth } from '@/lib/rounds/dates';
import { planDay, type DayPlan } from '@/lib/worker/day-plan';
import type { WorkerJob } from '@/lib/worker/types';

/** "Good morning" until noon, "Good afternoon" until six, then "Good evening" (Europe/London). */
export function greetingFor(hourInLondon: number, firstName: string | null): string {
  const hello = hourInLondon < 12 ? 'Good morning' : hourInLondon < 18 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${hello}, ${firstName}` : hello;
}

export function londonHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(now),
  );
}

/** Monday of the week containing the day (the week the dashboard shows). */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((weekday + 6) % 7));
}

/** How far back and forward the dashboard looks, in one read. */
export function dashboardWindow(today: string): { from: string; to: string } {
  const earliest = [startOfMonth(today), addDays(today, -14), weekStart(today)].sort(compareYmd)[0];
  const latest = [addDays(today, 30), addDays(weekStart(today), 6)].sort(compareYmd).reverse()[0];
  return { from: earliest, to: latest };
}

export type WeekDay = { date: string; plan: DayPlan; isToday: boolean; isPast: boolean };

export type DashboardNumbers = {
  doneThisMonth: number;
  comingUp: number;
  notCompletedRecently: number;
  nextJobDate: string | null;
};

export type DashboardData = {
  today: DayPlan;
  week: WeekDay[];
  numbers: DashboardNumbers;
};

/** Everything the Dashboard shows, worked out from one list of jobs. Pure. */
export function buildDashboard(jobs: readonly WorkerJob[], today: string): DashboardData {
  const monday = weekStart(today);
  const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, plan: planDay(jobs, date), isToday: date === today, isPast: compareYmd(date, today) < 0 };
  });

  const month = startOfMonth(today);
  const fortnightAgo = addDays(today, -14);
  const future = jobs
    .filter(
      (j) =>
        j.scheduledDate != null &&
        compareYmd(j.scheduledDate, today) > 0 &&
        j.status !== 'declined' &&
        j.status !== 'cancelled' &&
        j.status !== 'pending' &&
        j.status !== 'pending_send' &&
        j.status !== 'completed' &&
        j.status !== 'incomplete',
    )
    .sort((a, b) => compareYmd(a.scheduledDate as string, b.scheduledDate as string));

  return {
    today: planDay(jobs, today),
    week,
    numbers: {
      doneThisMonth: jobs.filter(
        (j) => j.status === 'completed' && j.scheduledDate != null && compareYmd(j.scheduledDate, month) >= 0 && compareYmd(j.scheduledDate, today) <= 0,
      ).length,
      comingUp: future.length,
      notCompletedRecently: jobs.filter(
        (j) => j.status === 'incomplete' && j.scheduledDate != null && compareYmd(j.scheduledDate, fortnightAgo) >= 0,
      ).length,
      nextJobDate: future[0]?.scheduledDate ?? null,
    },
  };
}
