'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { updateNotifications } from '@/lib/actions/settings';
import { getDefaultNotifications, type SettingsPageData, type NotificationsSettings } from '@/lib/data/settings-types';
import { cn } from '@/lib/utils';

interface SettingsNotificationsTabProps {
  data: SettingsPageData;
  onSaved: () => void;
}

export function SettingsNotificationsTab({ data, onSaved }: SettingsNotificationsTabProps) {
  const [saving, setSaving] = useState(false);
  const defaults = getDefaultNotifications();
  const current = data.tenant?.settings?.notifications ?? {};

  const [email, setEmail] = useState({
    new_job_created: current.email?.new_job_created ?? defaults.email?.new_job_created ?? true,
    job_assigned_to_worker: current.email?.job_assigned_to_worker ?? defaults.email?.job_assigned_to_worker ?? true,
    job_completed: current.email?.job_completed ?? defaults.email?.job_completed ?? true,
    weekly_summary_report: current.email?.weekly_summary_report ?? defaults.email?.weekly_summary_report ?? false,
  });
  const [push, setPush] = useState({
    job_status_changes: current.push?.job_status_changes ?? defaults.push?.job_status_changes ?? true,
    new_messages: current.push?.new_messages ?? defaults.push?.new_messages ?? true,
    worker_availability_changes: current.push?.worker_availability_changes ?? defaults.push?.worker_availability_changes ?? false,
  });
  const [worker, setWorker] = useState({
    push_when_job_assigned: current.worker?.push_when_job_assigned ?? defaults.worker?.push_when_job_assigned ?? true,
    sms_for_emergency_jobs: current.worker?.sms_for_emergency_jobs ?? defaults.worker?.sms_for_emergency_jobs ?? false,
    daily_summary_assigned_jobs: current.worker?.daily_summary_assigned_jobs ?? defaults.worker?.daily_summary_assigned_jobs ?? true,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const notifications: NotificationsSettings = {
      email: {
        ...email,
        payment_received: false,
        monthly_revenue_report: false,
      },
      push,
      worker,
    };
    const result = await updateNotifications(notifications);
    setSaving(false);
    if (result.success) {
      toast.success('Notification preferences saved');
      onSaved();
    } else {
      toast.error(result.error ?? 'Failed to save');
    }
  }

  const Checkbox = ({
    id,
    label,
    checked,
    onChange,
    help,
  }: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    help?: string;
  }) => (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 rounded border-input accent-primary"
      />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer font-medium">
          {label}
        </Label>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <CardTitle>Email notifications</CardTitle>
          <CardDescription>Choose which events trigger an email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Checkbox
            id="email-new-job"
            label="New job created"
            checked={email.new_job_created}
            onChange={(v) => setEmail((prev) => ({ ...prev, new_job_created: v }))}
          />
          <Checkbox
            id="email-assigned"
            label="Job assigned to worker"
            checked={email.job_assigned_to_worker}
            onChange={(v) => setEmail((prev) => ({ ...prev, job_assigned_to_worker: v }))}
          />
          <Checkbox
            id="email-completed"
            label="Job completed"
            checked={email.job_completed}
            onChange={(v) => setEmail((prev) => ({ ...prev, job_completed: v }))}
          />
          <Checkbox
            id="email-weekly"
            label="Weekly summary report"
            checked={email.weekly_summary_report}
            onChange={(v) => setEmail((prev) => ({ ...prev, weekly_summary_report: v }))}
          />
        </CardContent>
      </Card>

      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60 mt-6',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <CardTitle>Push notifications (mobile app)</CardTitle>
          <CardDescription>Alerts on the mobile app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Checkbox
            id="push-status"
            label="Job status changes"
            checked={push.job_status_changes}
            onChange={(v) => setPush((prev) => ({ ...prev, job_status_changes: v }))}
          />
          <Checkbox
            id="push-messages"
            label="New messages"
            checked={push.new_messages}
            onChange={(v) => setPush((prev) => ({ ...prev, new_messages: v }))}
          />
          <Checkbox
            id="push-availability"
            label="Worker availability changes"
            checked={push.worker_availability_changes}
            onChange={(v) => setPush((prev) => ({ ...prev, worker_availability_changes: v }))}
          />
        </CardContent>
      </Card>

      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60 mt-6',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <CardTitle>Worker notifications</CardTitle>
          <CardDescription>How workers are notified.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Checkbox
            id="worker-push"
            label="Send push notifications when job assigned"
            checked={worker.push_when_job_assigned}
            onChange={(v) => setWorker((prev) => ({ ...prev, push_when_job_assigned: v }))}
            help="Workers will receive push notifications via the mobile app when jobs are assigned."
          />
          <Checkbox
            id="worker-sms"
            label="Send SMS for emergency jobs (costs apply)"
            checked={worker.sms_for_emergency_jobs}
            onChange={(v) => setWorker((prev) => ({ ...prev, sms_for_emergency_jobs: v }))}
          />
          <Checkbox
            id="worker-daily"
            label="Daily summary of assigned jobs"
            checked={worker.daily_summary_assigned_jobs}
            onChange={(v) => setWorker((prev) => ({ ...prev, daily_summary_assigned_jobs: v }))}
          />
        </CardContent>
      </Card>

      <div className="mt-6">
        <Button type="submit" variant="gradient" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save notification preferences
        </Button>
      </div>
    </form>
  );
}
