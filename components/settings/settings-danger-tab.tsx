'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  dangerDeleteAllJobs,
  dangerResetWorkerData,
  dangerDeleteTenant,
} from '@/lib/actions/settings';
import type { SettingsPageData } from '@/lib/data/settings-types';
import { cn } from '@/lib/utils';

interface SettingsDangerTabProps {
  data: SettingsPageData;
}

export function SettingsDangerTab({ data }: SettingsDangerTabProps) {
  const router = useRouter();
  const tenant = data.tenant;
  const tenantName = tenant?.name ?? '';

  const [deleteJobsOpen, setDeleteJobsOpen] = useState(false);
  const [deleteJobsPassword, setDeleteJobsPassword] = useState('');
  const [deleteJobsSaving, setDeleteJobsSaving] = useState(false);

  const [resetWorkersOpen, setResetWorkersOpen] = useState(false);
  const [resetWorkersConfirm, setResetWorkersConfirm] = useState('');
  const [resetWorkersSaving, setResetWorkersSaving] = useState(false);

  const [deleteTenantOpen, setDeleteTenantOpen] = useState(false);
  const [deleteTenantName, setDeleteTenantName] = useState('');
  const [deleteTenantPassword, setDeleteTenantPassword] = useState('');
  const [deleteTenantSaving, setDeleteTenantSaving] = useState(false);

  async function handleDeleteAllJobs() {
    setDeleteJobsSaving(true);
    const result = await dangerDeleteAllJobs(deleteJobsPassword);
    setDeleteJobsSaving(false);
    if (result.success) {
      toast.success('All jobs deleted');
      setDeleteJobsOpen(false);
      setDeleteJobsPassword('');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete jobs');
    }
  }

  async function handleResetWorkers() {
    if (resetWorkersConfirm !== 'RESET') return;
    setResetWorkersSaving(true);
    const result = await dangerResetWorkerData();
    setResetWorkersSaving(false);
    if (result.success) {
      toast.success('Worker data reset');
      setResetWorkersOpen(false);
      setResetWorkersConfirm('');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to reset');
    }
  }

  async function handleDeleteTenant() {
    if (deleteTenantName.trim() !== tenantName.trim()) {
      toast.error('Company name does not match');
      return;
    }
    setDeleteTenantSaving(true);
    const result = await dangerDeleteTenant(deleteTenantName.trim(), deleteTenantPassword);
    setDeleteTenantSaving(false);
    if (result.success) {
      toast.success('Account deleted');
      setDeleteTenantOpen(false);
      router.push('/login');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete account');
    }
  }

  return (
    <div className="space-y-6">
      <Card
        className={cn(
          'rounded-xl border-2 border-destructive/50',
          'bg-destructive/10 dark:bg-destructive/15'
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            Danger zone
          </CardTitle>
          <CardDescription>
            These actions are irreversible. Confirm carefully.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Delete all jobs */}
          <div className="rounded-lg border border-destructive/30 bg-background/50 p-4">
            <h4 className="font-medium text-foreground">Delete all jobs</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Permanently delete every job for this tenant. This cannot be undone.
            </p>
            <Button
              type="button"
              variant="destructive"
              className="mt-3"
              onClick={() => setDeleteJobsOpen(true)}
            >
              Delete all jobs
            </Button>
          </div>

          {/* Reset worker data */}
          <div className="rounded-lg border border-destructive/30 bg-background/50 p-4">
            <h4 className="font-medium text-foreground">Reset worker data</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Remove worker–tenant links and related data. Workers themselves are not deleted.
            </p>
            <Button
              type="button"
              variant="destructive"
              className="mt-3"
              onClick={() => setResetWorkersOpen(true)}
            >
              Reset worker data
            </Button>
          </div>

          {/* Delete tenant */}
          <div className="rounded-lg border border-destructive/30 bg-background/50 p-4">
            <h4 className="font-medium text-foreground">Delete tenant account</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Permanently delete this company account and all associated data. You will need to sign in again.
            </p>
            <Button
              type="button"
              variant="destructive"
              className="mt-3"
              onClick={() => setDeleteTenantOpen(true)}
            >
              Delete tenant account
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete all jobs dialog */}
      <Dialog open={deleteJobsOpen} onOpenChange={setDeleteJobsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all jobs</DialogTitle>
            <DialogDescription>
              This will permanently delete every job. Enter your password to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="delete-jobs-password">Your password</Label>
            <Input
              id="delete-jobs-password"
              type="password"
              value={deleteJobsPassword}
              onChange={(e) => setDeleteJobsPassword(e.target.value)}
              placeholder="Password"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteJobsOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAllJobs} disabled={!deleteJobsPassword || deleteJobsSaving}>
              {deleteJobsSaving && <Loader2 className="size-4 animate-spin" />}
              Delete all jobs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset workers dialog */}
      <Dialog open={resetWorkersOpen} onOpenChange={setResetWorkersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset worker data</DialogTitle>
            <DialogDescription>
              Type RESET below to confirm. This will remove worker–tenant associations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="reset-confirm">Type RESET to confirm</Label>
            <Input
              id="reset-confirm"
              value={resetWorkersConfirm}
              onChange={(e) => setResetWorkersConfirm(e.target.value)}
              placeholder="RESET"
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetWorkersOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetWorkers}
              disabled={resetWorkersConfirm !== 'RESET' || resetWorkersSaving}
            >
              {resetWorkersSaving && <Loader2 className="size-4 animate-spin" />}
              Reset worker data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete tenant dialog */}
      <Dialog open={deleteTenantOpen} onOpenChange={setDeleteTenantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tenant account</DialogTitle>
            <DialogDescription>
              This permanently deletes the company and all data. Type the company name and your password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="delete-tenant-name">Company name</Label>
              <Input
                id="delete-tenant-name"
                value={deleteTenantName}
                onChange={(e) => setDeleteTenantName(e.target.value)}
                placeholder={tenantName || 'Company name'}
              />
              <p className="text-xs text-muted-foreground">Type exactly: {tenantName}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-tenant-password">Your password</Label>
              <Input
                id="delete-tenant-password"
                type="password"
                value={deleteTenantPassword}
                onChange={(e) => setDeleteTenantPassword(e.target.value)}
                placeholder="Password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTenantOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTenant}
              disabled={
                deleteTenantName.trim() !== tenantName.trim() ||
                !deleteTenantPassword ||
                deleteTenantSaving
              }
            >
              {deleteTenantSaving && <Loader2 className="size-4 animate-spin" />}
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
