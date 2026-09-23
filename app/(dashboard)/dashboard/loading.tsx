export default function DashboardLoading() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          <div className="h-7 w-40 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-48 rounded bg-muted/70 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="size-9 rounded-md bg-muted animate-pulse" />
          <div className="h-9 w-44 rounded-md bg-muted animate-pulse" />
          <div className="size-9 rounded-md bg-muted animate-pulse" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border/70 px-3 py-2.5">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-7 w-28 rounded-full bg-muted animate-pulse" />
        ))}
      </div>

      <div className="rounded-xl border border-border/70 p-4">
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="h-10 w-56 rounded-md bg-muted animate-pulse" />
          <div className="h-10 w-40 rounded-md bg-muted animate-pulse" />
          <div className="h-10 w-40 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex gap-2 p-2">
              <div className="h-8 flex-1 rounded bg-muted animate-pulse" />
              <div className="h-8 flex-1 rounded bg-muted animate-pulse" />
              <div className="h-8 w-20 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
