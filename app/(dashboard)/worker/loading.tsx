export default function WorkerLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
