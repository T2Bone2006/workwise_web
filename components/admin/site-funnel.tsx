import Link from 'next/link';
import { Activity, Hourglass, MousePointerClick, ScrollText } from 'lucide-react';
import { FUNNEL_DAYS, type SiteFunnelResult } from '@/lib/data/admin-site-funnel';
import {
  MIN_PAGE_VISITS,
  MIN_VISITS,
  biggestLeak,
  funnelSteps,
  verdict,
  type PageRow,
} from '@/lib/analytics/site-events';
import { Tag, toneClasses } from '@/components/look';
import { cn } from '@/lib/utils';

const outOf100 = (share: number) => Math.round(share * 100);

function stay(s: number | null): string {
  if (s === null) return 'not known yet';
  if (s < 60) return `about ${s} seconds`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest < 5 ? `about ${m} minute${m === 1 ? '' : 's'}` : `about ${m} min ${rest} sec`;
}

function pageName(page: string): string {
  return page === '/' ? 'Home page' : page;
}

/** One honest hint per page, only when there are enough visits to mean anything. */
function hint(p: PageRow): string | null {
  if (p.views < MIN_PAGE_VISITS) return null;
  if (p.seconds !== null && p.seconds < 10) return 'Half of the people who open this page leave within 10 seconds.';
  if (p.scrolled50 < 0.25) return 'Fewer than 1 in 4 scroll halfway down this page.';
  return null;
}

function Measure({ icon: Icon, label, value }: { icon: typeof Hourglass; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </p>
      <p className="text-right text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function PageCard({ page }: { page: PageRow }) {
  const note = hint(page);
  const tooFew = page.views < MIN_PAGE_VISITS;
  return (
    <li className="rounded-2xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold">{pageName(page.page)}</p>
        <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {page.views} visit{page.views === 1 ? '' : 's'}
        </p>
      </div>

      {tooFew ? (
        <p className="mt-3 text-sm text-muted-foreground">Too few visits to read anything into yet.</p>
      ) : (
        <div className="mt-2 divide-y divide-border">
          <Measure icon={Hourglass} label="People stay for" value={stay(page.seconds)} />
          <Measure icon={ScrollText} label="Scroll halfway down" value={`${outOf100(page.scrolled50)} in every 100`} />
          <Measure icon={MousePointerClick} label="Press Start" value={`${outOf100(page.clickedStart)} in every 100`} />
        </div>
      )}

      {note ? <p className={cn('mt-3 rounded-lg px-3 py-2 text-sm', toneClasses('amber').chip)}>{note}</p> : null}

      {page.topLinks.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Also pressed: {page.topLinks.map((l) => `${l.label.replace(/^link /, '')} (${l.count})`).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

/** Where visitors drop off, from the site's own cookie-free counter. Reads the last two weeks. */
export function SiteFunnel({ result, ad }: { result: SiteFunnelResult; ad: string | null }) {
  const { summary, tableMissing, error } = result;
  const chips: { key: string | null; label: string }[] = [
    { key: null, label: 'Everyone' },
    ...summary.ads.map((name) => ({ key: name, label: `From the "${name}" ad` })),
    { key: 'organic', label: 'Not from an ad' },
  ];

  const steps = funnelSteps(summary.funnel);
  const leak = biggestLeak(steps);
  const said = verdict(summary.funnel);
  const first = steps[0].count;
  // With only a handful of visits, "in every 100" would make 2 visits look like 17%, so show plain counts instead.
  const early = summary.funnel.views < MIN_VISITS;

  return (
    <section aria-label="Is the website working" className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5">
      <h2 className="text-lg font-semibold tracking-tight">Is the website working?</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">What visitors did on joinworkwise.com in the last {FUNNEL_DAYS} days.</p>

      {tableMissing ? (
        <p role="status" className="mt-4 rounded-xl border border-(--tone-amber-line) bg-(--tone-amber-soft) p-3.5 text-sm">
          The visitor table isn&apos;t in the database yet. Paste <code className="font-mono text-xs">20261105120000_site_events.sql</code> in
          Supabase, then reload.
        </p>
      ) : error ? (
        <p className="mt-4 text-sm text-destructive">Couldn&apos;t load the visitor counts. Reload to try again.</p>
      ) : summary.funnel.views === 0 && !ad ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nobody has been counted yet. Visits show up here a few seconds after someone opens the site.
        </p>
      ) : (
        <>
          <nav aria-label="Which visitors" className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Show:</span>
            {chips.map((chip) => {
              const active = (ad ?? null) === chip.key;
              return (
                <Link
                  key={chip.key ?? 'all'}
                  href={chip.key ? `/admin/website?ad=${encodeURIComponent(chip.key)}` : '/admin/website'}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {chip.label}
                </Link>
              );
            })}
          </nav>

          <div className={cn('mt-4 flex items-start gap-3 rounded-xl border p-4', toneClasses(said.tone).soft, toneClasses(said.tone).border)}>
            <Activity className={cn('mt-0.5 size-5 shrink-0', toneClasses(said.tone).text)} aria-hidden />
            <p className="text-[15px] leading-relaxed">{said.text}</p>
          </div>

          <h3 className="mt-6 text-sm font-semibold">The journey, step by step</h3>
          <p className="text-sm text-muted-foreground">
            {early ? 'How many page visits got this far.' : 'Of every 100 page visits, how many get this far.'}
          </p>
          <ol className="mt-3 flex flex-col gap-3">
            {steps.map((step, i) => {
              const isLeak = leak?.label === step.label;
              return (
                <li key={step.label} className="grid grid-cols-[1.75rem_1fr] gap-x-3">
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                      isLeak ? toneClasses('rose').chip : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-sm font-medium">
                        {step.label}
                        {isLeak ? <Tag tone="rose" className="ml-2 align-middle">Most people stop here</Tag> : null}
                      </p>
                      <p className="text-sm tabular-nums">
                        {early ? (
                          <>
                            <span className="text-base font-semibold">{step.count}</span>
                            <span className="text-muted-foreground"> visit{step.count === 1 ? '' : 's'}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-base font-semibold">{step.per100 ?? 0}</span>
                            <span className="text-muted-foreground"> in every 100</span>
                            <span className="ml-2 text-xs text-muted-foreground">({step.count} visit{step.count === 1 ? '' : 's'})</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className={cn('h-full rounded-full', isLeak ? toneClasses('rose').solid : 'bg-primary')}
                        style={{ width: `${first > 0 ? Math.max(Math.min((step.count / first) * 100, 100), step.count > 0 ? 1.5 : 0) : 0}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {summary.pages.length > 0 ? (
            <>
              <h3 className="mt-7 text-sm font-semibold">Page by page</h3>
              <p className="text-sm text-muted-foreground">Busiest first. This is where to look for pages that lose people.</p>
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {summary.pages.map((p) => (
                  <PageCard key={p.page} page={p} />
                ))}
              </ul>
            </>
          ) : null}

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Counted without cookies, so we can&apos;t tell one person from another. Someone who opens three pages counts as three visits.
          </p>
        </>
      )}
    </section>
  );
}
