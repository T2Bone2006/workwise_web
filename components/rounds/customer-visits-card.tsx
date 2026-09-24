'use client';

import { format, parseISO } from 'date-fns';
import type { VisitRow } from '@/lib/data/rounds/visits';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

function formatVisitWhen(visit: VisitRow): string {
  if (!visit.scheduled_date) return '—';
  try {
    const day = format(parseISO(visit.scheduled_date), 'EEE d MMM yyyy');
    const time = visit.scheduled_time?.slice(0, 5);
    return time ? `${day} · ${time}` : day;
  } catch {
    return visit.scheduled_date;
  }
}

function visitStatusBadge(status: string) {
  if (status === 'completed') {
    return <Badge variant="secondary">Done</Badge>;
  }
  if (status === 'cancelled') {
    return <Badge variant="outline">Skipped</Badge>;
  }
  if (status === 'forecast') {
    return <Badge variant="outline">Not booked yet</Badge>;
  }
  return <Badge variant="outline">Planned</Badge>;
}

export type ForecastVisitRow = {
  id: string;
  job_description: string;
  scheduled_date: string;
  scheduled_time: string | null;
  quoted_amount: number | null;
};

function VisitList({
  visits,
  emptyLabel,
}: {
  visits: VisitRow[];
  emptyLabel: string;
}) {
  if (visits.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {visits.map((visit) => {
        const amount = visit.final_amount ?? visit.quoted_amount;
        return (
          <li
            key={visit.id}
            className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">
                  {visit.job_description}
                </p>
                {visitStatusBadge(visit.status)}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatVisitWhen(visit)}
                {visit.reference_number
                  ? ` · ${visit.reference_number}`
                  : null}
              </p>
              {visit.status === 'cancelled' && visit.skip_reason ? (
                <p className="text-xs text-muted-foreground">
                  Reason: {visit.skip_reason.replace(/_/g, ' ')}
                </p>
              ) : null}
            </div>
            <p className="shrink-0 tabular-nums text-sm text-muted-foreground">
              {amount != null ? priceFormat.format(amount) : '—'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function CustomerVisitsCard({
  upcoming,
  forecast = [],
  recent,
  upcomingError = null,
  recentError = null,
}: {
  upcoming: VisitRow[];
  forecast?: ForecastVisitRow[];
  recent: VisitRow[];
  upcomingError?: string | null;
  recentError?: string | null;
}) {
  const upcomingRows: VisitRow[] = [
    ...upcoming,
    ...forecast.map((visit) => ({
      id: visit.id,
      reference_number: '',
      customer_id: null,
      customer_name: null,
      service_agreement_id: null,
      agreement_occurrence_date: visit.scheduled_date,
      address: '',
      postcode: '',
      lat: null,
      lng: null,
      job_description: visit.job_description,
      status: 'forecast',
      scheduled_date: visit.scheduled_date,
      scheduled_time: visit.scheduled_time,
      estimated_duration_minutes: null,
      quoted_amount: visit.quoted_amount,
      final_amount: null,
      payment_status: null,
      skip_reason: null,
      route_position: null,
      completed_at: null,
    })),
  ].sort((a, b) => {
    const da = a.scheduled_date ?? '';
    const db = b.scheduled_date ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? '');
  });
  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-3">
        <h2 className="text-lg font-semibold">Visits</h2>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upcoming" className="space-y-3">
          <TabsList>
            <TabsTrigger value="upcoming">
              Upcoming ({upcomingRows.length})
            </TabsTrigger>
            <TabsTrigger value="recent">Recent ({recent.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-0">
            {upcomingError ? (
              <p className="text-sm text-destructive">{upcomingError}</p>
            ) : (
              <VisitList
                visits={upcomingRows}
                emptyLabel="No upcoming visits planned."
              />
            )}
          </TabsContent>
          <TabsContent value="recent" className="mt-0">
            {recentError ? (
              <p className="text-sm text-destructive">{recentError}</p>
            ) : (
              <VisitList
                visits={recent}
                emptyLabel="No completed or skipped visits yet."
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
