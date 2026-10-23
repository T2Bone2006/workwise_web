import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Globe, Hammer, Sparkles, UserPlus } from 'lucide-react';
import { isAdmin } from '@/lib/utils/admin';
import { listSignups, type SignupRow } from '@/lib/data/admin-website';
import { WEBSITE_STATUS_LABEL, type WebsiteStatus } from '@/lib/website-offer';
import { WebsiteRowForm } from '@/components/admin/website-row-form';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { StatTile, Tag, type Tone } from '@/components/look';
import { cn } from '@/lib/utils';

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'needs', label: 'Needs a website' },
  { key: 'building', label: 'Building' },
  { key: 'live', label: 'Live' },
  { key: 'unasked', label: 'Not answered yet' },
  { key: 'takedown', label: 'Take down' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const STATUS_TONE: Record<WebsiteStatus, Tone> = {
  needs: 'amber',
  building: 'sky',
  done: 'emerald',
  has_one: 'slate',
  taken_down: 'rose',
};

function formatDay(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

function matches(row: SignupRow, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'takedown') return row.takeDown;
  if (!row.lite) return false;
  if (filter === 'unasked') return row.website === null && row.lite.state !== 'ended';
  if (filter === 'needs') return row.website?.status === 'needs';
  if (filter === 'building') return row.website?.status === 'building';
  return row.website?.status === 'done';
}

function liteLine(row: SignupRow, now: number): string | null {
  const lite = row.lite;
  if (!lite) return null;
  if (lite.state === 'ended') return `Lite ended${lite.endsAt ? ` ${formatDay(lite.endsAt)}` : ''}`;
  if (lite.state === 'ending') return `Lite ends ${formatDay(lite.endsAt)}`;
  return new Date(lite.keepFrom).getTime() <= now
    ? '12 months done: the site is theirs to keep'
    : `Keeps the site from ${formatDay(lite.keepFrom)}`;
}

function SignupCard({ row, now }: { row: SignupRow; now: number }) {
  const line = liteLine(row, now);
  return (
    <li className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,16rem)] lg:gap-6">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{row.business}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[row.contactName, row.email].filter(Boolean).join(' · ') || 'No contact on file'}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Tag tone="slate">
              {row.plan}
              {row.interval ? `, ${row.interval === 'year' ? 'yearly' : 'monthly'}` : ''}
            </Tag>
            {row.closed ? <Tag tone="rose">Closed</Tag> : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Signed up {formatDay(row.signedUpAt)}</p>
        </div>

        <div className="min-w-0">
          {row.lite ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {row.website ? (
                  <Tag tone={STATUS_TONE[row.website.status]}>{WEBSITE_STATUS_LABEL[row.website.status]}</Tag>
                ) : (
                  <Tag tone="slate">Not answered yet</Tag>
                )}
                {row.takeDown ? <Tag tone="rose">Left before 12 months: take the site down</Tag> : null}
              </div>
              {line ? <p className="mt-2 text-sm text-muted-foreground">{line}</p> : null}
              {row.website?.answeredAt ? (
                <p className="mt-1 text-xs text-muted-foreground">Answered {formatDay(row.website.answeredAt)}</p>
              ) : null}
              {row.website?.liveUrl ? (
                <a
                  href={row.website.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-sm font-medium text-(--tone-lite-text) underline-offset-4 hover:underline"
                >
                  {row.website.liveUrl}
                </a>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No Lite, so no free website.</p>
          )}
        </div>

        <div className="min-w-0">
          {row.lite ? (
            <WebsiteRowForm
              tenantId={row.tenantId}
              status={row.website?.status ?? null}
              liveUrl={row.website?.liveUrl ?? null}
              notes={row.website?.notes ?? null}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default async function WebsiteTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect('/dashboard');

  const { show } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === show) ? (show as FilterKey) : 'all';
  const { rows, error, tableMissing, now } = await listSignups();

  const lite = rows.filter((r) => r.lite);
  const count = (status: WebsiteStatus) => lite.filter((r) => r.website?.status === status).length;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const newThisMonth = rows.filter((r) => new Date(r.signedUpAt).getTime() >= monthAgo).length;
  const shown = rows.filter((r) => matches(r, filter));
  const chipCount = (key: FilterKey) => rows.filter((r) => matches(r, key)).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageGradientHeader
        title="Website tracker"
        subtitle="New sign-ups, and where each Lite customer is on their free one-page website."
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {tableMissing ? (
        <p role="status" className="rounded-xl border border-(--tone-amber-line) bg-(--tone-amber-soft) p-3.5 text-sm">
          The website table isn&apos;t in the database yet, so statuses can&apos;t be saved. Paste{' '}
          <code className="font-mono text-xs">20261023120000_website_requests.sql</code> in Supabase, then reload.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="New in 30 days" value={String(newThisMonth)} sub="Sign-ups on any plan" tone="rounds" icon={UserPlus} />
        <StatTile label="Need a website" value={String(count('needs'))} sub="Said yes, not started" tone="amber" icon={Globe} />
        <StatTile label="Building" value={String(count('building'))} sub="In progress" tone="sky" icon={Hammer} />
        <StatTile label="Live" value={String(count('done'))} sub="Free websites delivered" tone="emerald" icon={Sparkles} />
      </div>

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/admin/website' : `/admin/website?show=${f.key}`}
            aria-current={filter === f.key ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              filter === f.key
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">{chipCount(f.key)}</span>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? 'No sign-ups yet.' : 'Nobody here right now.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((row) => (
            <SignupCard key={row.tenantId} row={row} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
