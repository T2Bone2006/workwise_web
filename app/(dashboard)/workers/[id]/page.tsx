import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Edit,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Briefcase,
  CheckCircle,
  Clock,
} from 'lucide-react';
import Link from 'next/link';

interface WorkerDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkerDetailPage({ params }: WorkerDetailPageProps) {
  const { id } = await params;
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) redirect('/login');

  const supabase = await createClient();

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select(
      `
      id,
      full_name,
      phone,
      email,
      home_postcode,
      home_lat,
      home_lng,
      worker_type,
      status,
      skills,
      created_at,
      updated_at
    `
    )
    .eq('id', id)
    .eq('primary_tenant_id', tenantId)
    .single();

  if (workerError || !worker) {
    notFound();
  }

  const { data: jobStats } = await supabase
    .from('jobs')
    .select('status')
    .eq('assigned_worker_id', id);

  const totalJobs = jobStats?.length ?? 0;
  const completedJobs =
    jobStats?.filter((j) => j.status === 'completed').length ?? 0;
  const inProgressJobs =
    jobStats?.filter((j) => j.status === 'in_progress').length ?? 0;
  const assignedJobs =
    jobStats?.filter((j) => j.status === 'assigned').length ?? 0;
  const cancelledJobs =
    jobStats?.filter((j) => j.status === 'cancelled').length ?? 0;

  const completionRate =
    totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;

  const { data: recentJobs } = await supabase
    .from('jobs')
    .select(
      `
      id,
      reference_number,
      address,
      postcode,
      status,
      priority,
      scheduled_date,
      completed_at,
      customer:customers(name)
    `
    )
    .eq('assigned_worker_id', id)
    .order('created_at', { ascending: false })
    .limit(10);

  const statusConfig: Record<string, { color: string; label: string }> = {
    available: {
      color:
        'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      label: 'Available',
    },
    busy: {
      color:
        'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
      label: 'Busy',
    },
    unavailable: {
      color:
        'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      label: 'Unavailable',
    },
    off_duty: {
      color:
        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      label: 'Off Duty',
    },
  };

  const workerTypeConfig: Record<
    string,
    { label: string; color: string }
  > = {
    company_subcontractor: {
      label: 'Company Subcontractor',
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    },
    platform_solo: {
      label: 'Platform Solo',
      color:
        'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    },
    both: {
      label: 'Both',
      color:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    },
  };

  const jobStatusConfig: Record<string, { color: string; label: string }> = {
    pending: { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
    assigned: { color: 'bg-blue-100 text-blue-800', label: 'Assigned' },
    in_progress: {
      color: 'bg-purple-100 text-purple-800',
      label: 'In Progress',
    },
    completed: { color: 'bg-green-100 text-green-800', label: 'Completed' },
    cancelled: { color: 'bg-red-100 text-red-800', label: 'Cancelled' },
  };

  const workerStatus =
    statusConfig[worker.status as string] ?? statusConfig.off_duty;
  const workerType =
    workerTypeConfig[worker.worker_type as string] ?? workerTypeConfig.both;
  const workerStatusClass = workerStatus.color;
  const workerTypeClass = workerType.color;
  const workerTypeLabel = workerType.label;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-3xl font-bold">{worker.full_name}</h1>
            <Badge className={workerStatusClass}>{workerStatus.label}</Badge>
            <Badge className={workerTypeClass}>{workerTypeLabel}</Badge>
          </div>
          <p className="text-muted-foreground">
            Member since{' '}
            {new Date(worker.created_at).toLocaleDateString('en-GB', {
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <Link href={`/workers/${id}/edit`}>
          <Button>
            <Edit className="mr-2 h-4 w-4" />
            Edit Worker
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalJobs}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {completedJobs}
            </div>
            <p className="text-xs text-muted-foreground">
              {completionRate.toFixed(0)}% completion rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {inProgressJobs}
            </div>
            <p className="text-xs text-muted-foreground">Active right now</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Assigned</CardTitle>
            <Calendar className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {assignedJobs}
            </div>
            <p className="text-xs text-muted-foreground">Pending start</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {worker.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${worker.phone}`} className="hover:underline">
                    {worker.phone}
                  </a>
                </div>
              )}
              {worker.email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`mailto:${worker.email}`}
                    className="hover:underline"
                  >
                    {worker.email}
                  </a>
                </div>
              )}
              {worker.home_postcode && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{worker.home_postcode}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {worker.skills != null && worker.skills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Skills & Specializations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(worker.skills as string[]).map((skill: string) => (
                    <Badge
                      key={skill}
                      variant="secondary"
                      className="capitalize"
                    >
                      {skill.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent Jobs</CardTitle>
                  <CardDescription>
                    Last 10 jobs assigned to this worker
                  </CardDescription>
                </div>
                <Link href={`/jobs?worker_id=${id}`}>
                  <Button variant="outline" size="sm">
                    View All
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {recentJobs != null && recentJobs.length > 0 ? (
                <div className="space-y-3">
                  {recentJobs.map((job) => {
                    const customer = Array.isArray(job.customer)
                      ? job.customer[0]
                      : job.customer;
                    const custName =
                      customer != null && typeof customer === 'object' && 'name' in customer
                        ? (customer as { name: string }).name
                        : null;
                    const status =
                      jobStatusConfig[job.status as string] ??
                      jobStatusConfig.pending;
                    return (
                      <Link key={job.id} href={`/jobs/${job.id}`}>
                        <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50">
                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <p className="text-sm font-medium">
                                {job.reference_number}
                              </p>
                              <Badge
                                className={`text-xs ${status.color}`}
                              >
                                {status.label}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {job.address}, {job.postcode}
                            </p>
                            {custName != null && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {custName}
                              </p>
                            )}
                          </div>
                          <div className="text-right text-sm text-muted-foreground">
                            {job.completed_at != null ? (
                              <span>
                                Completed{' '}
                                {new Date(
                                  job.completed_at
                                ).toLocaleDateString()}
                              </span>
                            ) : job.scheduled_date != null ? (
                              <span>
                                Scheduled{' '}
                                {new Date(
                                  job.scheduled_date
                                ).toLocaleDateString()}
                              </span>
                            ) : (
                              <span>Unscheduled</span>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <Briefcase className="mx-auto mb-3 h-12 w-12 opacity-50" />
                  <p>No jobs assigned yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Performance</CardTitle>
              <CardDescription>Job completion metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 flex justify-between">
                  <span className="text-sm font-medium">Completion Rate</span>
                  <span className="text-sm font-medium">
                    {completionRate.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-2 rounded-full bg-green-600 transition-all"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-medium">{completedJobs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">In Progress</span>
                  <span className="font-medium">{inProgressJobs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assigned</span>
                  <span className="font-medium">{assignedJobs}</span>
                </div>
                {cancelledJobs > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cancelled</span>
                    <span className="font-medium text-red-600">
                      {cancelledJobs}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href={`/jobs/new?worker=${id}`} className="block">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                >
                  <Briefcase className="mr-2 h-4 w-4" />
                  Assign New Job
                </Button>
              </Link>
              <Link
                href={`/jobs?worker_id=${id}&status=in_progress`}
                className="block"
              >
                <Button
                  variant="outline"
                  className="w-full justify-start"
                >
                  <Clock className="mr-2 h-4 w-4" />
                  View Active Jobs
                </Button>
              </Link>
              <Link href={`/workers/${id}/edit`} className="block">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
