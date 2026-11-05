import Link from 'next/link';
import { FUNNEL_DAYS, type SiteFunnelResult } from '@/lib/data/admin-site-funnel';
import type { Funnel, PageRow } from '@/lib/analytics/site-events';
import { cn } from '@/lib/utils';

const pct = (n: number) => `${Math.round(n * 100)}%`;

function seconds(s: number | null): string {
  if (s === null) return '–';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function pageName(page: string): string {
  return page === '/' ? 'Home' : page;
}

type Step = { label: string; count: number; note: string };

function steps(f: Funnel): Step[] {
  return [
    { label: 'Opened a page', count: f.views, note: 'Page views on joinworkwise.com' },
    { label: 'Pressed Start', count: f.clickedStart, note: 'Clicked a button that goes to sign-up' },
    { label: 'Saw the plan step', count: f.plan, note: 'Sign-up page, step 1' },
    { label: 'Reached details', count: f.details, note: 'Sign-up page, step 2' },
    { label: 'Pressed pay', count: f.submitted, note: 'Sent the form to Stripe' },
  ];
}

function FunnelBars({ funnel }: { funnel: Funnel }) {
  const rows = steps(funnel);
  const top = Math.max(rows[0].count, 1);
  return (
    <ol className="mt-3 flex flex-col gap-2.5">
      {rows.map((row, i) => {
        const prev = i === 0 ? null : rows[i - 1].count;
        const kept = prev && prev > 0 ? row.count / prev : null;
        return (
          <li key={row.label} className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 sm:grid-cols-[12rem_1fr_9rem]">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.label}</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{row.note}</p>
            </div>
            <div className="h-6 overflow-hidden rounded-md bg-muted" aria-hidden>
              <div className="h-full rounded-md bg-primary" style={{ width: `${Math.max((row.count / top) * 100, row.count > 0 ? 2 : 0)}%` }} />
            </div>
            <p className="text-right text-sm tabular-nums">
              <span className="font-semibold">{row.count}</span>
              {kept !== null ? (
                <span className={cn('ml-1.5 text-xs', kept < 0.15 ? 'text-destructive' : 'text-muted-foreground')}>
                  {pct(kept)} of last
                </span>
              ) : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function PageTable({ pages }: { pages: PageRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Page</th>
            <th className="px-3 py-1.5 text-right font-medium">Views</th>
            <th className="px-3 py-1.5 text-right font-medium">Time on page</th>
            <th className="px-3 py-1.5 text-right font-medium">Read half</th>
            <th className="px-3 py-1.5 text-right font-medium">Reached end</th>
            <th className="py-1.5 pl-3 text-right font-medium">Pressed Start</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.page} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <p className="font-medium">{pageName(p.page)}</p>
                {p.topLinks.length > 0 ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Also pressed: {p.topLinks.map((l) => `${l.label.replace(/^link /, '')} (${l.count})`).join(', ')}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{p.views}</td>
              <td className="px-3 py-2 text-right tabular-nums">{seconds(p.seconds)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(p.scrolled50)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(p.scrolled100)}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{pct(p.clickedStart)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Where visitors drop off, from the site's own cookie-free counter. Reads the last two weeks. */
export function SiteFunnel({ result, ad }: { result: SiteFunnelResult; ad: string | null }) {
  const { summary, tableMissing, error } = result;
  const chips = [
    { key: null, label: 'Everyone' },
    ...summary.ads.map((name) => ({ key: name, label: name })),
    { key: 'organic', label: 'No ad' },
  ];

  return (
    <section aria-label="Where visitors drop off" className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5">
      <h2 className="text-base font-semibold">Where visitors drop off</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        The last {FUNNEL_DAYS} days. Counted without cookies, so each step counts page visits, not people.
      </p>

      {tableMissing ? (
        <p role="status" className="mt-3 rounded-xl border border-(--tone-amber-line) bg-(--tone-amber-soft) p-3.5 text-sm">
          The visitor table isn&apos;t in the database yet. Paste <code className="font-mono text-xs">20261105120000_site_events.sql</code> in
          Supabase, then reload.
        </p>
      ) : error ? (
        <p className="mt-3 text-sm text-destructive">Couldn&apos;t load the visitor counts. Reload to try again.</p>
      ) : summary.funnel.views === 0 && !ad ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing counted yet. Visits show up here a few seconds after someone opens the site.</p>
      ) : (
        <>
          <nav aria-label="Which visitors" className="mt-3 flex flex-wrap gap-2">
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
          <FunnelBars funnel={summary.funnel} />
          {summary.pages.length > 0 ? <PageTable pages={summary.pages} /> : null}
        </>
      )}
    </section>
  );
}
