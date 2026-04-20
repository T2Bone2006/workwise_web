export default function DashboardLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 animate-in fade-in duration-300">
      <div className="shrink-0">
        <div className="h-7 w-40 rounded-lg bg-muted animate-pulse sm:h-8 sm:w-48" />
        <div className="mt-2 h-4 w-56 rounded bg-muted/70 animate-pulse sm:h-5 sm:w-72" />
      </div>

      <div className="grid shrink-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 dark:border-white/[0.06]"
          >
            <div className="flex justify-between">
              <div className="space-y-2">
                <div className="h-4 w-28 rounded bg-muted animate-pulse" />
                <div className="h-9 w-16 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 dark:border-white/[0.06]">
        <div className="mb-3 flex justify-between">
          <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex gap-2 rounded-lg border border-transparent p-2">
              <div className="h-8 flex-1 rounded bg-muted animate-pulse" />
              <div className="h-8 flex-1 rounded bg-muted animate-pulse" />
              <div className="h-8 w-20 rounded bg-muted animate-pulse" />
              <div className="h-8 w-16 rounded bg-muted animate-pulse" />
              <div className="h-8 w-20 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
