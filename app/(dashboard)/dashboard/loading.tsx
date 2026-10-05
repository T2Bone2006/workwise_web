import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5 animate-in fade-in duration-200">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-7 w-40 rounded-lg" />
          <Skeleton className="h-4 w-48 rounded" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-9 w-44 rounded-md" />
          <Skeleton className="size-9 rounded-md" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border/70 px-3 py-2.5">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
      </div>

      <div className="rounded-xl border border-border/70 p-4">
        <div className="mb-4 flex flex-wrap gap-3">
          <Skeleton className="h-10 w-56 rounded-md" />
          <Skeleton className="h-10 w-40 rounded-md" />
          <Skeleton className="h-10 w-40 rounded-md" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex gap-2 p-2">
              <Skeleton className="h-8 flex-1 rounded" />
              <Skeleton className="h-8 flex-1 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
