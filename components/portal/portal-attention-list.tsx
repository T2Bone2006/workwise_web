import Link from 'next/link';
import { ChevronLeft, ChevronRight, CircleCheck, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LookPage, Notice } from '@/components/look';
import { AttentionRow, attentionHref } from '@/components/portal/portal-overview';
import { ATTENTION_PAGE_SIZE, type AttentionKindFilter, type PortalAttentionPage } from '@/lib/data/portal';

const TABS: Array<{ kind: AttentionKindFilter; label: string }> = [
  { kind: 'all', label: 'All' },
  { kind: 'not_completed', label: 'Not completed' },
  { kind: 'overdue', label: 'Overdue' },
];

function params(kind: AttentionKindFilter, search: string, page?: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (kind !== 'all') out.kind = kind;
  if (search) out.search = search;
  if (page && page > 1) out.page = String(page);
  return out;
}

/**
 * Every job that failed or ran late, one page at a time. Search is a plain form and the tabs
 * and paging are links, so the page works without any script and can be bookmarked.
 */
export function PortalAttentionList({
  tenantName,
  kind,
  search,
  result,
  tenant,
  actions,
}: {
  tenantName: string;
  kind: AttentionKindFilter;
  search: string;
  result: PortalAttentionPage;
  tenant?: string;
  actions?: React.ReactNode;
}) {
  const { items, counts, total, page } = result;
  const pages = Math.max(1, Math.ceil(total / ATTENTION_PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * ATTENTION_PAGE_SIZE + 1;
  const last = Math.min(page * ATTENTION_PAGE_SIZE, total);

  return (
    <LookPage
      title="Needs attention"
      subtitle={
        counts.all === 0
          ? `Nothing has failed or run late with ${tenantName}.`
          : `${counts.all} ${counts.all === 1 ? 'job' : 'jobs'} with ${tenantName} failed or ran late.`
      }
      actions={actions}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2" aria-label="Filter by problem">
          {TABS.map((tab) => {
            const active = tab.kind === kind;
            return (
              <Link
                key={tab.kind}
                href={attentionHref(params(tab.kind, search), tenant)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  active ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
                )}
              >
                {tab.label}
                <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}>{counts[tab.kind]}</span>
              </Link>
            );
          })}
        </nav>

        <form method="get" action="/portal/attention" role="search" className="relative w-full sm:w-72">
          {kind !== 'all' ? <input type="hidden" name="kind" value={kind} /> : null}
          {tenant ? <input type="hidden" name="tenant" value={tenant} /> : null}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search reference or address"
            aria-label="Search reference or address"
            className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </form>
      </div>

      {items.length === 0 ? (
        <Notice tone="emerald" icon={CircleCheck} title={search ? 'No jobs match that search' : 'Nothing here'}>
          {search
            ? 'Try a different reference or part of the address.'
            : counts.all === 0
              ? 'Jobs that fail or run late will show up here.'
              : 'There are no jobs of this kind.'}
        </Notice>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <AttentionRow key={item.id} item={item} tenant={tenant} />
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>
              Showing {first} to {last} of {total}
            </p>
            {pages > 1 ? (
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={attentionHref(params(kind, search, page - 1), tenant)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-foreground hover:bg-muted"
                  >
                    <ChevronLeft className="size-4" aria-hidden /> Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link
                    href={attentionHref(params(kind, search, page + 1), tenant)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-foreground hover:bg-muted"
                  >
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </LookPage>
  );
}
