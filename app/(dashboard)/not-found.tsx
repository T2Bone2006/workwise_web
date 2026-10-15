import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** A customer, lead, invoice or page that isn't there (deleted, or a wrong link). */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center shadow-(--look-card-shadow) sm:p-8">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden="true">
          <SearchX className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">We couldn&apos;t find that</h1>
          <p className="text-sm text-muted-foreground">
            It may have been deleted, or the link is wrong. Head back and look for it in the list.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
