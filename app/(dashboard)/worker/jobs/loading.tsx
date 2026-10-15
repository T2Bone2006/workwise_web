export default function WorkerJobsLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-40 animate-pulse rounded-lg bg-muted" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
