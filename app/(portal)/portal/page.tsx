import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { redirect } from 'next/navigation';

type PortalJobRow = {
  id: string;
  reference_number: string;
  address: string;
  status: string | null;
  scheduled_date: string | null;
  completed_at: string | null;
  industry_data: Record<string, unknown> | null;
};

function getJobType(industryData: Record<string, unknown> | null): string {
  const value = industryData?.job_type;
  return typeof value === 'string' && value.trim() ? value : '—';
}

function formatDateValue(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd MMM yyyy');
}

export default async function PortalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: portalUser } = await supabase
    .from('customer_portal_users')
    .select('customer_id')
    .eq('user_id', user.id)
    .maybeSingle<{ customer_id: string }>();

  if (!portalUser?.customer_id) {
    redirect('/dashboard');
  }

  const { data: jobs } = await supabase
    .from('jobs')
    .select(
      'id, reference_number, address, status, scheduled_date, completed_at, industry_data'
    )
    .eq('customer_id', portalUser.customer_id)
    .order('created_at', { ascending: false });

  const rows: PortalJobRow[] = Array.isArray(jobs) ? (jobs as PortalJobRow[]) : [];

  return (
    <Card className="glass-card overflow-hidden border-border/80 backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]">
      <CardHeader className="pb-2">
        <h1 className="text-base font-semibold text-foreground">Your jobs</h1>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs found.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <Table>
              <TableHeader>
                <TableRow className="border-border/80 hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">Job ref</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Address</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Job type</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Scheduled date</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Completion date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((job) => {
                  const statusKey = (job.status ?? 'pending') as JobStatusUi;
                  const statusUi = JOB_STATUS_DISPLAY[statusKey];
                  return (
                    <TableRow key={job.id} className="border-border/80">
                      <TableCell className="font-medium">
                        {job.reference_number || job.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">{job.address || '—'}</TableCell>
                      <TableCell>{getJobType(job.industry_data)}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                            statusUi?.badgeClass ??
                              'border-slate-400/60 bg-slate-500/10 text-slate-800 dark:text-slate-200'
                          )}
                        >
                          {statusUi?.label ?? job.status ?? 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>{formatDateValue(job.scheduled_date)}</TableCell>
                      <TableCell>{formatDateValue(job.completed_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
