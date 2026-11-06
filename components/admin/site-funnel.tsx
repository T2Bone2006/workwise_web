import Link from 'next/link';
import { Activity, ArrowRight, ExternalLink, Hourglass, MousePointerClick, ScrollText, Users } from 'lucide-react';
import { FUNNEL_DAYS, type SiteFunnelResult } from '@/lib/data/admin-site-funnel';
import {
  MIN_PAGE_VISITS,
  MIN_VISITS,
  biggestLeak,
  funnelSteps,
  verdict,
  type PageRow,
} from '@/lib/analytics/site-events';
import type { PeopleSummary } from '@/lib/analytics/site-people';
import { StatTile, Tag, toneClasses } from '@/components/look';
import { RefreshButton } from '@/components/admin/refresh-button';
import { IgnoreMeToggle } from '@/components/admin/ignore-me-toggle';
import { AD_PAGES, adPageUrl } from '@/lib/analytics/ad-pages';
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

const MIN_PEOPLE = 10;

function People({ people, personMissing }: { people: PeopleSummary; personMissing: boolean }) {
  return (
    <div className="mt-8 border-t border-border pt-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="size-4" aria-hidden /> Following individual people
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        People who pressed Accept on the cookie banner get a random code, so we can see the pages one person goes through. Everyone else is only in
        the figures above.
      </p>

      {personMissing ? (
        <p role="status" className="mt-3 rounded-xl border border-(--tone-amber-line) bg-(--tone-amber-soft) p-3.5 text-sm">
          One more thing to paste into Supabase before this part works:{' '}
          <code className="font-mono text-xs">20261105180000_site_events_person.sql</code>. Then reload.
        </p>
      ) : people.people === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nobody who pressed Accept has been followed yet. They appear here after their first visit.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="People followed"
              value={String(people.people)}
              sub={people.returning > 0 ? `${people.returning} came back on another day` : 'None have come back yet'}
              tone="sky"
              icon={Users}
            />
            <StatTile label="Pressed Start" value={String(people.funnel.pressedStart)} sub="of those people" tone="rounds" />
            <StatTile label="Reached sign-up" value={String(people.funnel.details)} sub="got as far as the details form" tone="amber" />
            <StatTile label="Pressed pay" value={String(people.funnel.submitted)} sub="sent the form to Stripe" tone="emerald" />
          </div>
          {people.people < MIN_PEOPLE ? (
            <p className="mt-2 text-xs text-muted-foreground">Only {people.people} people so far, so treat these as examples, not patterns.</p>
          ) : null}

          {people.next.length > 0 ? (
            <>
              <h4 className="mt-6 text-sm font-semibold">Where people go next</h4>
              <p className="text-sm text-muted-foreground">After each page, where the people who were there went straight afterwards.</p>
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {people.next.map((row) => (
                  <li key={row.page} className="rounded-2xl border border-border p-4">
                    <p className="text-sm font-semibold">
                      After {row.page} <span className="font-normal text-muted-foreground">({row.people} {row.people === 1 ? 'person' : 'people'})</span>
                    </p>
                    <ul className="mt-2 divide-y divide-border">
                      {row.to.map((t) => (
                        <li key={t.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                          <span className={cn('flex items-center gap-2', t.label === 'Left the site' && toneClasses('rose').text)}>
                            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            {t.label}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{t.count}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {people.lastStops.length > 0 ? (
            <>
              <h4 className="mt-6 text-sm font-semibold">Where people stopped</h4>
              <p className="text-sm text-muted-foreground">The last thing each person did before we stopped seeing them.</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {people.lastStops.map((stop) => (
                  <li key={stop.label}>
                    <Tag tone="slate">
                      {stop.label} <span className="font-semibold tabular-nums">{stop.count}</span>
                    </Tag>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {people.journeys.length > 0 ? (
            <>
              <h4 className="mt-6 text-sm font-semibold">Recent visitors, one by one</h4>
              <p className="text-sm text-muted-foreground">Each line is one person, in the order they did things. The number in brackets is how long they stayed.</p>
              <ul className="mt-3 flex flex-col gap-2">
                {people.journeys.map((j, i) => (
                  <li key={i} className="rounded-xl border border-border p-3">
                    <p className="text-xs text-muted-foreground">
                      {j.ad ? `From the "${j.ad}" ad` : 'Not from an ad'}
                      {j.days > 1 ? ` · seen on ${j.days} different days` : ''}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                      {j.steps.map((step, k) => (
                        <span key={k} className="flex items-center gap-1.5">
                          {k > 0 ? <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                          <span className={cn(step === 'Pressed Start' || step === 'Pressed pay' ? 'font-semibold' : '')}>{step}</span>
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function AdPages() {
  return (
    <div className="mt-8 border-t border-border pt-6">
      <h3 className="text-sm font-semibold">See what an ad visitor sees</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        These open the real pages exactly as someone coming from each ad gets them, including the ad&apos;s headline. They don&apos;t count as visits
        here and don&apos;t tell Facebook, so look as often as you like.
      </p>
      <ul className="mt-3 grid gap-3 lg:grid-cols-3">
        {AD_PAGES.map((page) => (
          <li key={page.ad} className="flex flex-col rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold">{page.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">&ldquo;{page.headline}&rdquo;</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Sends people to <span className="font-medium text-foreground">joinworkwise.com{page.path}</span>
            </p>
            <a
              href={adPageUrl(page)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Open the page <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where visitors drop off, from the site's own counter. Reads the last two weeks. */
export function SiteFunnel({ result, ad }: { result: SiteFunnelResult; ad: string | null }) {
  const { summary, people, personMissing, tableMissing, error } = result;
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Is the website working?</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">What visitors did on joinworkwise.com in the last {FUNNEL_DAYS} days.</p>
        </div>
        <RefreshButton updatedAt={result.loadedAt} />
      </div>

      <IgnoreMeToggle />

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
            The figures above are counted without cookies, so we can&apos;t tell one person from another: someone who opens three pages counts as
            three visits.
          </p>

          <People people={people} personMissing={personMissing} />
          <AdPages />
        </>
      )}
    </section>
  );
}
