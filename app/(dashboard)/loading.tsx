import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown the instant a dashboard link is clicked, while the next page's data loads.
 * Pages inside (dashboard) inherit it; /dashboard keeps its own, more specific one.
 */
export default function DashboardGroupLoading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5 animate-in fade-in duration-200">
      {/* Page title */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>

      {/* Main list */}
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="mb-4 flex flex-wrap gap-3">
          <Skeleton className="h-10 w-56 max-w-full" />
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
