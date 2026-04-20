'use client';

import Link from 'next/link';
import {
  Mail,
  Phone,
  FileText,
  Building2,
  User,
  Pencil,
  Trash2,
  Briefcase,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CustomerDetailRow, CustomerJobStats } from '@/lib/data/customers';
import type { RecentJobRow } from '@/lib/data/jobs';
import { deleteCustomer } from '@/lib/actions/customers';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const statusBadgeClass: Record<string, string> = {
  pending: 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  assigned: 'border-blue-400/60 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  in_progress: 'border-violet-400/60 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  completed: 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  cancelled: 'border-red-300/50 bg-red-500/5 text-red-600 dark:text-red-400/90',
};

interface CustomerDetailViewProps {
  customer: CustomerDetailRow;
  stats: CustomerJobStats;
  recentJobs: RecentJobRow[];
  statsError: Error | null;
  jobsError: Error | null;
}

export function CustomerDetailView({
  customer,
  stats,
  recentJobs,
  statsError,
  jobsError,
}: CustomerDetailViewProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isBulk = customer.type === 'bulk_client';

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteCustomer(customer.id);
    setIsDeleting(false);
    setDeleteOpen(false);
    if (result.success) {
      toast.success('Customer deleted');
      router.push('/customers');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete customer');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Left column ~60% */}
      <div className="space-y-6">
        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg',
                  isBulk ? 'bg-violet-500/20 text-violet-600 dark:text-violet-400' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                )}
              >
                {isBulk ? <Building2 className="size-5" /> : <User className="size-5" />}
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">{customer.name}</h2>
                <span
                  className={cn(
                    'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                    isBulk
                      ? 'border-violet-400/60 bg-violet-500/10 text-violet-700 dark:text-violet-400'
                      : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  )}
                >
                  {isBulk ? 'Bulk Client' : 'Individual'}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <a href={`mailto:${customer.email}`} className="text-primary hover:underline">
                  {customer.email}
                </a>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                <a href={`tel:${customer.phone}`} className="text-primary hover:underline">
                  {customer.phone}
                </a>
              </div>
            )}
            {customer.notes && (
              <div className="flex items-start gap-2 text-sm pt-1 border-t border-border/80">
                <FileText className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                <p className="text-muted-foreground whitespace-pre-wrap">{customer.notes}</p>
              </div>
            )}
            {!customer.email && !customer.phone && !customer.notes && (
              <p className="text-sm text-muted-foreground">No contact or address details</p>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <h2 className="text-base font-semibold text-foreground">Recent jobs</h2>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/jobs?customer_id=${customer.id}`}>View All Jobs</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {jobsError ? (
              <p className="text-sm text-destructive">Failed to load jobs</p>
            ) : recentJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet</p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/80 hover:bg-transparent">
                      <TableHead className="text-muted-foreground font-medium">Ref #</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Address</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentJobs.map((job) => (
                      <TableRow key={job.id} className="border-border/80">
                        <TableCell>
                          <Link
                            href={`/jobs/${job.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {job.reference_number || job.id.slice(0, 8)}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">
                          {job.address || '—'}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                              statusBadgeClass[job.status ?? 'pending'] ?? 'bg-muted'
                            )}
                          >
                            {STATUS_LABELS[job.status ?? ''] ?? job.status ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {format(new Date(job.created_at), 'dd MMM yyyy')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right column ~40% */}
      <div className="space-y-6">
        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardHeader>
            <h2 className="text-base font-semibold text-foreground">Job stats</h2>
          </CardHeader>
          <CardContent>
            {statsError ? (
              <p className="text-sm text-destructive">Failed to load stats</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Total jobs</p>
                </div>
                <div className="rounded-lg border border-border/80 bg-amber-500/10 p-3">
                  <p className="text-2xl font-bold text-foreground">{stats.pending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
                <div className="rounded-lg border border-border/80 bg-blue-500/10 p-3">
                  <p className="text-2xl font-bold text-foreground">{stats.assigned}</p>
                  <p className="text-xs text-muted-foreground">Assigned</p>
                </div>
                <div className="rounded-lg border border-border/80 bg-violet-500/10 p-3">
                  <p className="text-2xl font-bold text-foreground">{stats.in_progress}</p>
                  <p className="text-xs text-muted-foreground">In progress</p>
                </div>
                <div className="rounded-lg border border-border/80 bg-emerald-500/10 p-3">
                  <p className="text-2xl font-bold text-foreground">{stats.completed}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
                <div className="rounded-lg border border-border/80 bg-red-500/10 p-3">
                  <p className="text-2xl font-bold text-foreground">{stats.cancelled}</p>
                  <p className="text-xs text-muted-foreground">Cancelled</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardHeader>
            <h2 className="text-base font-semibold text-foreground">Quick actions</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button variant="outline" className="w-full justify-start gap-2" asChild>
              <Link href={`/customers/${customer.id}/edit`}>
                <Pencil className="size-4" />
                Edit customer
              </Link>
            </Button>
            <Button variant="gradient" className="w-full justify-start gap-2 shadow-[var(--shadow-btn-glow-value)]" asChild>
              <Link href={`/jobs/new?customer_id=${customer.id}`}>
                <Briefcase className="size-4" />
                Create job for this customer
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              Delete customer
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete customer?</DialogTitle>
            <DialogDescription>
              {customer.job_count > 0
                ? `This customer has ${customer.job_count} job(s). Customers with existing jobs cannot be deleted.`
                : 'This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || customer.job_count > 0}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
