'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ArrowLeft, CalendarIcon, Brain, X } from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import { createJobSchema, type CreateJobInput } from '@/lib/validations/job';
import { createJob, autoAllocateJob, type OverrideSkillsPayload } from '@/lib/actions/jobs';
import type { CustomerRow } from '@/lib/data/customers';
import type { WorkerRow } from '@/lib/data/workers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

const priorityBadgeClass: Record<string, string> = {
  low: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-400',
  normal: 'border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  high: 'border-orange-400/50 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  urgent: 'border-rose-400/60 bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

const SKILL_OPTIONS: { value: string; label: string }[] = [
  { value: 'residential_locks', label: 'Residential locks' },
  { value: 'commercial_locks', label: 'Commercial locks' },
  { value: 'safe_installation', label: 'Safe installation' },
  { value: 'high_security_locks', label: 'High security locks' },
  { value: 'emergency_callout', label: 'Emergency callout' },
  { value: 'lock_fitting', label: 'Lock fitting' },
  { value: 'key_cutting', label: 'Key cutting' },
  { value: 'master_key_systems', label: 'Master key systems' },
  { value: 'automotive_locks', label: 'Automotive locks' },
  { value: 'access_control', label: 'Access control' },
];

interface JobFormProps {
  customers: CustomerRow[];
  workers: WorkerRow[];
  defaultCustomerId?: string;
}

export function JobForm({ customers, workers, defaultCustomerId }: JobFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [aiDetectedSkills, setAiDetectedSkills] = useState<string[]>([]);
  const [aiInteractionId, setAiInteractionId] = useState<string>('');
  const [isDetectingSkills, setIsDetectingSkills] = useState(false);

  const form = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: {
      reference_number: '',
      customer_id: defaultCustomerId ?? '',
      address: '',
      postcode: '',
      description: '',
      priority: 'normal',
      scheduled_date: '',
      assigned_worker_id: '',
    },
  });

  async function handleDetectSkills() {
    const description = form.getValues('description')?.trim();
    if (!description || description.length < 10) {
      toast.error('Add a job description (min 10 characters) to detect skills.');
      return;
    }
    setIsDetectingSkills(true);
    try {
      const res = await fetch('/api/detect-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          address: form.getValues('address') ?? '',
          priority: form.getValues('priority') ?? 'normal',
        }),
      });
      if (!res.ok) throw new Error('Detect skills failed');
      const { skills, interactionId } = await res.json();
      const list = Array.isArray(skills) ? skills : [];
      setAiDetectedSkills(list);
      setSelectedSkills(list);
      setAiInteractionId(interactionId ?? '');
      if (list.length > 0) toast.success(`Detected ${list.length} skill(s). You can edit below.`);
      else toast.info('No specific skills detected. You can add any below.');
    } catch {
      toast.error('Failed to detect skills. Try again.');
    } finally {
      setIsDetectingSkills(false);
    }
  }

  async function onSubmit(values: CreateJobInput) {
    setIsSubmitting(true);
    const useAutoAssign = !values.assigned_worker_id || values.assigned_worker_id.length === 0;
    const overrideSkills: OverrideSkillsPayload | undefined =
      aiInteractionId && (selectedSkills.length > 0 || aiDetectedSkills.length > 0)
        ? {
            skills: selectedSkills,
            interactionId: aiInteractionId,
            originalSkills: aiDetectedSkills,
          }
        : undefined;
    try {
      const result = await createJob({
        reference_number: values.reference_number || undefined,
        customer_id: values.customer_id,
        address: values.address,
        postcode: values.postcode,
        description: values.description,
        priority: values.priority,
        scheduled_date: values.scheduled_date || undefined,
        assigned_worker_id: useAutoAssign
          ? undefined
          : values.assigned_worker_id,
        overrideSkills,
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to create job');
        return;
      }

      if (useAutoAssign && result.jobId) {
        const allocResult = await autoAllocateJob(result.jobId);
        if (allocResult.success) {
          toast.success(
            `Job created and allocated to ${allocResult.workerName} (${allocResult.distance}km away). Send from Jobs when ready.`
          );
        } else {
          toast.success('Job created successfully');
          toast.error(allocResult.error ?? 'Auto-assign failed');
        }
      } else {
        toast.success('Job created successfully');
      }

      router.push('/jobs');
      router.refresh();
    } catch {
      toast.error('Unable to create job. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'dark:border-white/[0.06]',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="space-y-1 border-b border-border/60 px-6 py-5">
        <h2 className="text-lg font-semibold text-foreground">New Job</h2>
        <p className="text-sm text-muted-foreground">
          Fill in the details below. Reference number can be left blank to auto-generate.
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="reference_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference Number (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. JOB-001 (auto-generated if empty)"
                        className={cn(
                          'bg-white/80 dark:bg-white/5 dark:border-white/10',
                          'focus-visible:border-brand-primary focus-visible:shadow-[var(--shadow-input-focus-value)] transition-all duration-300'
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-destructive text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customer_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="after:content-['*'] after:ml-0.5 after:text-destructive">
                      Customer
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger
                          className={cn(
                            'w-full bg-white/80 dark:bg-white/5 dark:border-white/10',
                            'focus-visible:border-brand-primary focus-visible:ring-brand-primary/20 transition-all duration-300'
                          )}
                        >
                          <SelectValue placeholder="Select customer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <span className="flex items-center gap-2">
                              {c.name}
                              {c.type === 'bulk_client' && (
                                <Badge variant="secondary" className="text-xs">
                                  Bulk
                                </Badge>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-destructive text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="after:content-['*'] after:ml-0.5 after:text-destructive">
                    Address
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Full address"
                      className={cn(
                        'bg-white/80 dark:bg-white/5 dark:border-white/10',
                        'focus-visible:border-brand-primary focus-visible:shadow-[var(--shadow-input-focus-value)] transition-all duration-300'
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )}
            />

            <div className="grid gap-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="postcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="after:content-['*'] after:ml-0.5 after:text-destructive">
                      Postcode
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="UK postcode (e.g. SW1A 1AA)"
                        className={cn(
                          'bg-white/80 dark:bg-white/5 dark:border-white/10 uppercase',
                          'focus-visible:border-brand-primary focus-visible:shadow-[var(--shadow-input-focus-value)] transition-all duration-300'
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-destructive text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="after:content-['*'] after:ml-0.5 after:text-destructive">
                      Priority
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger
                          className={cn(
                            'w-full bg-white/80 dark:bg-white/5 dark:border-white/10',
                            'focus-visible:border-brand-primary focus-visible:ring-brand-primary/20 transition-all duration-300'
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            <span
                              className={cn(
                                'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                                priorityBadgeClass[o.value]
                              )}
                            >
                              {o.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-destructive text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="after:content-['*'] after:ml-0.5 after:text-destructive">
                    Description
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Job description (min 10 characters)"
                      rows={4}
                      className={cn(
                        'resize-y min-h-[100px] bg-white/80 dark:bg-white/5 dark:border-white/10',
                        'focus-visible:border-brand-primary focus-visible:shadow-[var(--shadow-input-focus-value)] transition-all duration-300 rounded-lg'
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Required skills (optional)</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDetectSkills}
                  disabled={isDetectingSkills || (form.watch('description')?.trim()?.length ?? 0) < 10}
                  className="gap-1.5"
                >
                  {isDetectingSkills ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Brain className="size-3.5" />
                  )}
                  Detect skills
                </Button>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value && !selectedSkills.includes(value)) {
                      setSelectedSkills((prev) => [...prev, value]);
                    }
                  }}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs bg-white/80 dark:bg-white/5">
                    <SelectValue placeholder="Add skill" />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_OPTIONS.filter((o) => !selectedSkills.includes(o.value)).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                    {SKILL_OPTIONS.every((o) => selectedSkills.includes(o.value)) && (
                      <SelectItem value="_none" disabled>
                        All added
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {selectedSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedSkills.map((skill) => (
                    <Badge
                      key={skill}
                      variant="secondary"
                      className="pl-2 pr-1 py-0.5 text-xs font-normal gap-1"
                    >
                      {SKILL_OPTIONS.find((o) => o.value === skill)?.label ?? skill}
                      <button
                        type="button"
                        onClick={() => setSelectedSkills((prev) => prev.filter((s) => s !== skill))}
                        className="rounded-full hover:bg-muted p-0.5"
                        aria-label={`Remove ${skill}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="scheduled_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date (optional)</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full justify-start text-left font-normal h-10',
                              'bg-white/80 dark:bg-white/5 dark:border-white/10',
                              'border-input hover:bg-white/90 dark:hover:bg-white/10',
                              'focus-visible:border-brand-primary focus-visible:ring-brand-primary/20 focus-visible:shadow-[var(--shadow-input-focus-value)] transition-all duration-300',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            <CalendarIcon className="mr-2 size-4 shrink-0" />
                            {field.value ? (
                              format(new Date(field.value + 'T00:00:00'), 'PPP')
                            ) : (
                              <span>Pick a date</span>
                            )}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto p-0 border-border/80 backdrop-blur-[var(--blur-glass)] bg-popover/95 dark:bg-popover/95 shadow-[var(--shadow-glass-value)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/20 focus-visible:ring-offset-0"
                        align="start"
                      >
                        <Calendar
                          mode="single"
                          selected={
                            field.value
                              ? new Date(field.value + 'T00:00:00')
                              : undefined
                          }
                          onSelect={(date) =>
                            field.onChange(
                              date ? format(date, 'yyyy-MM-dd') : undefined
                            )
                          }
                          initialFocus
                          className={cn(
                            'rounded-lg border-0 bg-transparent',
                            '[--cell-size:2.25rem]',
                            '[&_[data-slot=calendar]]:rounded-lg',
                            '[&_.rdp-day_button]:rounded-md [&_.rdp-day_button]:transition-all [&_.rdp-day_button]:duration-200',
                            '[&_.rdp-day_button:hover]:bg-primary/15 [&_.rdp-day_button:hover]:text-foreground',
                            '[&_.rdp-day_button[data-selected-single=true]]:bg-primary [&_.rdp-day_button[data-selected-single=true]]:text-primary-foreground [&_.rdp-day_button[data-selected-single=true]]:shadow-[0_0_12px_-2px_var(--glow-primary)]',
                            '[&_.rdp-day_button[data-selected-single=true]:hover]:bg-primary/90'
                          )}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage className="text-destructive text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assigned_worker_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned Worker (optional)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === 'auto' ? '' : v)}
                      value={field.value && field.value.length > 0 ? field.value : 'auto'}
                    >
                      <FormControl>
                        <SelectTrigger
                          className={cn(
                            'w-full bg-white/80 dark:bg-white/5 dark:border-white/10',
                            'focus-visible:border-brand-primary focus-visible:ring-brand-primary/20 transition-all duration-300'
                          )}
                        >
                          <SelectValue placeholder="Auto-assign" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">Auto-assign</SelectItem>
                        {workers.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.full_name}
                          </SelectItem>
                        ))}
                        {workers.length === 0 && (
                          <SelectItem value="unassigned" disabled>
                            Unassigned (no workers)
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-destructive text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border/60 pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                className="order-2 sm:order-1"
                asChild
              >
                <Link href="/jobs">
                  <ArrowLeft className="size-4" />
                  Cancel
                </Link>
              </Button>
              <Button
                type="submit"
                variant="gradient"
                className="shadow-[var(--shadow-btn-glow-value)] order-1 sm:order-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create Job'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
