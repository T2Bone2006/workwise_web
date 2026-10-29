import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalHome } from '@/components/portal/portal-overview';
import { PortalJobPage } from '@/components/portal/portal-job-view';
import { PortalJobReport } from '@/components/portal/portal-job-report';
import type { PortalJobView } from '@/lib/portal/job';
import { addDays, londonToday } from '@/lib/portal/dates';
import { buildOverview, NOT_STARTED_STATUSES, type PortalJobRow } from '@/lib/portal/overview';
import { buildTimeline } from '@/lib/portal/timeline';

/**
 * Design preview for the customer portal, with made-up SSE-style jobs. It needs no
 * sign-in and does not exist in production. Open /design-preview, then
 * ?view=job&state=incomplete | completed | booked.
 */

const TENANT = 'RS Locksmiths';

const PHOTOS = [
  { id: 'p1', url: '/design-preview/shutter.svg', name: 'Shutter, front' },
  { id: 'p2', url: '/design-preview/doorway.svg', name: 'Side entrance' },
  { id: 'p3', url: '/design-preview/cylinder.svg', name: 'Lock fitted' },
];

function row(over: Partial<PortalJobRow> & { id: string }): PortalJobRow {
  return {
    reference_number: over.id,
    address: null,
    status: 'assigned',
    scheduled_date: null,
    scheduled_time: null,
    completed_at: null,
    arrived_at: null,
    updated_at: null,
    industry_data: null,
    ...over,
  };
}

function homeData(today: string) {
  const d = (n: number) => addDays(today, n);
  const stamp = (n: number, time: string) => `${d(n)}T${time}Z`;
  const incomplete = [
    row({
      id: 'SSE-48213',
      address: 'Unit 4, Brindley Court, Wolverhampton WV10 0AB',
      status: 'incomplete',
      scheduled_date: d(-1),
      scheduled_time: '13:30:00',
      updated_at: stamp(-1, '14:32:00'),
      industry_data: {
        incomplete_reason: 'No access. Roller shutter was locked and nobody was on site. Rang the site contact twice with no answer.',
      },
    }),
    row({
      id: 'SSE-48190',
      address: 'Flat 12, Orchard House, Leeds LS6 2QB',
      status: 'incomplete',
      scheduled_date: d(-2),
      scheduled_time: '10:00:00',
      updated_at: stamp(-2, '11:05:00'),
      industry_data: { incomplete_reason: 'Needs a part we did not have: the cylinder is a non-standard 70mm.' },
    }),
  ];
  const rows = [
    ...incomplete,
    row({ id: 'SSE-48166', address: '88 Canal Street, Stoke-on-Trent ST1 5AA', status: 'assigned', scheduled_date: d(-3), scheduled_time: '09:00:00' }),
    row({ id: 'SSE-48201', address: '2 Kingsway Retail Park, Derby DE22 3AF', status: 'completed', scheduled_date: d(-2), scheduled_time: '14:00:00' }),
    row({ id: 'SSE-48202', address: 'The Old Dairy, Ludlow SY8 1AB', status: 'completed', scheduled_date: d(-1), scheduled_time: '09:30:00' }),
    row({ id: 'SSE-48209', address: '17 Mill Lane, Reading RG1 2AQ', status: 'completed', scheduled_date: today, scheduled_time: '09:00:00' }),
    row({ id: 'SSE-48214', address: 'Unit 9, Harbour Point, Cardiff CF10 4PA', status: 'in_progress', scheduled_date: today, scheduled_time: '11:30:00' }),
    row({ id: 'SSE-48217', address: '5 Chapel Row, Bath BA1 1HU', status: 'assigned', scheduled_date: today, scheduled_time: '14:00:00' }),
    row({ id: 'SSE-48221', address: '41 Priory Road, Bristol BS8 1TZ', status: 'assigned', scheduled_date: d(1), scheduled_time: '09:00:00' }),
    row({ id: 'SSE-48224', address: 'Beacon House, Swindon SN1 1AA', status: 'assigned', scheduled_date: d(1), scheduled_time: '13:00:00' }),
    row({ id: 'SSE-48230', address: '12 Quay Street, Exeter EX4 3LS', status: 'assigned', scheduled_date: d(2) }),
    row({ id: 'SSE-48236', address: 'Greenfield Works, Oxford OX4 2JY', status: 'pending', scheduled_date: d(4), scheduled_time: '10:30:00' }),
    // Last 30 days, for the completion rate: 21 completed and 2 not completed.
    ...Array.from({ length: 19 }, (_, i) => row({ id: `OLD-${i}`, status: 'completed', scheduled_date: d(-4 - i) })),
  ];
  const overdue = rows.filter(
    (r) => (NOT_STARTED_STATUSES as readonly string[]).includes(r.status) && r.scheduled_date != null && r.scheduled_date < today,
  );
  const data = buildOverview(
    { rows, incomplete, overdue, incompleteTotal: incomplete.length, overdueTotal: overdue.length },
    today,
  );
  return {
    ...data,
    attention: data.attention.map((a) =>
      a.id === 'SSE-48213'
        ? { ...a, photoUrl: PHOTOS[0].url, photoCount: 3 }
        : a.id === 'SSE-48190'
          ? { ...a, photoUrl: PHOTOS[2].url, photoCount: 1 }
          : a,
    ),
  };
}

function jobData(state: string, today: string): { job: PortalJobView; timeline: ReturnType<typeof buildTimeline>; photos: typeof PHOTOS } {
  const at = (n: number, time: string) => `${addDays(today, n)}T${time}Z`;
  if (state === 'completed') {
    return {
      job: {
        id: 'SSE-48209',
        reference: 'SSE-48209',
        address: '17 Mill Lane, Reading RG1 2AQ',
        status: 'completed',
        scheduledDate: today,
        scheduledTime: '09:00:00',
        description: 'Gain entry and fit a new euro cylinder on the rear plant-room door. Leave two keys with the site manager.',
        completionNotes: 'Cylinder replaced like for like. Two keys handed to the site manager, who signed for them.',
        reason: null,
        arrivedAt: at(0, '08:52:00'),
        completedAt: at(0, '09:37:00'),
        engineerFirstName: 'Sam',
      },
      timeline: buildTimeline({
        createdAt: at(-3, '15:10:00'),
        arrivedAt: at(0, '08:52:00'),
        history: [
          { id: 'a', from_status: 'pending', to_status: 'assigned', created_at: at(-2, '09:00:00') },
          { id: 'b', from_status: 'assigned', to_status: 'in_progress', created_at: at(0, '08:54:00') },
          { id: 'c', from_status: 'in_progress', to_status: 'completed', created_at: at(0, '09:37:00') },
        ],
      }),
      photos: PHOTOS.slice(1),
    };
  }
  if (state === 'booked') {
    return {
      job: {
        id: 'SSE-48221',
        reference: 'SSE-48221',
        address: '41 Priory Road, Bristol BS8 1TZ',
        status: 'assigned',
        scheduledDate: addDays(today, 1),
        scheduledTime: '09:00:00',
        description: 'Lock out. Customer has lost the keys to the meter cupboard.',
        completionNotes: null,
        reason: null,
        arrivedAt: null,
        completedAt: null,
        engineerFirstName: 'Priya',
      },
      timeline: buildTimeline({
        createdAt: at(-1, '16:20:00'),
        arrivedAt: null,
        history: [{ id: 'a', from_status: 'pending', to_status: 'assigned', created_at: at(-1, '16:45:00') }],
      }),
      photos: [],
    };
  }
  return {
    job: {
      id: 'SSE-48213',
      reference: 'SSE-48213',
      address: 'Unit 4, Brindley Court, Wolverhampton WV10 0AB',
      status: 'incomplete',
      scheduledDate: addDays(today, -1),
      scheduledTime: '13:30:00',
      description: 'Gain entry to the meter room behind the roller shutter and leave the premises secure.',
      completionNotes: 'Left a card through the side door. Site contact did not pick up.',
      reason: 'No access. Roller shutter was locked and nobody was on site. Rang the site contact twice with no answer.',
      arrivedAt: at(-1, '14:05:00'),
      completedAt: null,
      engineerFirstName: 'Sam',
    },
    timeline: buildTimeline({
      createdAt: at(-4, '10:15:00'),
      arrivedAt: at(-1, '14:05:00'),
      history: [
        { id: 'a', from_status: 'pending', to_status: 'assigned', created_at: at(-3, '09:00:00') },
        { id: 'b', from_status: 'assigned', to_status: 'in_progress', created_at: at(-1, '14:06:00') },
        { id: 'c', from_status: 'in_progress', to_status: 'incomplete', created_at: at(-1, '14:32:00') },
      ],
    }),
    photos: PHOTOS,
  };
}

export default async function DesignPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; state?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  const { view, state } = await searchParams;
  const today = londonToday();
  const link = 'rounded-lg px-2.5 py-1 text-xs font-medium hover:bg-muted';

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-dashed border-border bg-card p-1.5 text-muted-foreground">
        <span className="px-2 text-xs">Design preview, made-up data</span>
        <Link href="/design-preview" className={link}>Home</Link>
        <Link href="/design-preview?view=job&state=incomplete" className={link}>Job: not completed</Link>
        <Link href="/design-preview?view=job&state=completed" className={link}>Job: completed</Link>
        <Link href="/design-preview?view=job&state=booked" className={link}>Job: booked</Link>
        <Link href="/design-preview?view=report&state=incomplete" className={link}>Report: not completed</Link>
        <Link href="/design-preview?view=report&state=completed" className={link}>Report: completed</Link>
      </nav>

      {view === 'report' ? (
        (() => {
          const { job, timeline, photos } = jobData(state ?? 'incomplete', today);
          return <PortalJobReport job={job} tenantName={TENANT} timeline={timeline} photos={photos} />;
        })()
      ) : view === 'job' ? (
        (() => {
          const { job, timeline, photos } = jobData(state ?? 'incomplete', today);
          return (
            <PortalJobPage
              job={job}
              tenantName={TENANT}
              timeline={timeline}
              photos={photos}
              documents={[]}
              back={
                <Link href="/design-preview" className="-ml-2 text-sm text-muted-foreground hover:text-foreground">
                  Back to all jobs
                </Link>
              }
            />
          );
        })()
      ) : (
        <PortalHome tenantName={TENANT} data={homeData(today)} />
      )}
    </div>
  );
}
