import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DeclinedJobsBannerProps {
  className?: string;
}

export async function DeclinedJobsBanner({ className }: DeclinedJobsBannerProps) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return null;

  const supabase = await createClient();
  const { count } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'declined');

  const declinedCount = count ?? 0;
  if (declinedCount <= 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 shadow-[0_0_20px_-6px_rgba(239,68,68,0.25)]',
        'dark:border-red-400/30 dark:bg-red-500/5',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-red-500/20 dark:bg-red-500/10">
          <AlertTriangle className="size-5 text-red-700 dark:text-red-400" />
        </div>
        <div>
          <p className="font-medium text-red-900 dark:text-red-100">
            {declinedCount} declined job{declinedCount === 1 ? '' : 's'} need attention
          </p>
          <p className="text-sm text-red-800/90 dark:text-red-200/80">
            Review declined jobs and reassign them from the jobs list.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="default"
        className="shrink-0 border-red-400/50 bg-red-500/10 hover:bg-red-500/20 dark:border-red-400/30 dark:bg-red-500/10 dark:hover:bg-red-500/20"
        asChild
      >
        <Link href="/jobs?status=declined">
          <AlertTriangle className="size-4" />
          View declined jobs
        </Link>
      </Button>
    </div>
  );
}
