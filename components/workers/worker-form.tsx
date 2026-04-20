'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ArrowLeft, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { workerSchema, type WorkerFormInput } from '@/lib/validations/worker';
import { createWorker, updateWorker } from '@/lib/actions/workers';
import { SKILL_LABELS, SKILL_KEYS } from '@/lib/constants/skills';
import { validatePostcode } from '@/lib/utils/postcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkerRow } from '@/lib/types/worker';

const WORKER_TYPE_OPTIONS = [
  {
    value: 'company_subcontractor',
    label: 'Company Subcontractor',
    description: 'Works only for this company',
  },
  {
    value: 'platform_solo',
    label: 'Platform Solo',
    description: 'Independent, takes B2C jobs',
  },
  {
    value: 'both',
    label: 'Both',
    description: 'Works for company + takes B2C jobs',
  },
] as const;

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available', color: 'bg-emerald-500' },
  { value: 'busy', label: 'Busy', color: 'bg-amber-500' },
  { value: 'unavailable', label: 'Unavailable', color: 'bg-red-500' },
  { value: 'off_duty', label: 'Off Duty', color: 'bg-slate-500' },
] as const;

const MAX_SKILLS = 10;

interface WorkerFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  worker?: WorkerRow | null;
}

export function WorkerForm({ mode, tenantId, worker }: WorkerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postcodeValidation, setPostcodeValidation] = useState<{
    status: 'idle' | 'loading' | 'valid' | 'invalid';
    message?: string;
  }>({ status: 'idle' });
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');

  const form = useForm<WorkerFormInput>({
    resolver: zodResolver(workerSchema),
    defaultValues: {
      full_name: worker?.full_name ?? '',
      phone: worker?.phone ?? '',
      email: worker?.email ?? '',
      home_postcode: worker?.home_postcode ?? '',
      worker_type: (worker?.worker_type as WorkerFormInput['worker_type']) ?? 'company_subcontractor',
      status: (worker?.status as WorkerFormInput['status']) ?? 'available',
      skills: Array.isArray(worker?.skills) ? worker.skills : [],
    },
  });

  const skills = form.watch('skills') ?? [];
  const postcode = form.watch('home_postcode');

  const onPostcodeBlur = useCallback(async () => {
    const raw = postcode?.trim().replace(/\s/g, '').toUpperCase();
    if (!raw || raw.length < 5) {
      setPostcodeValidation({ status: 'idle' });
      return;
    }
    setPostcodeValidation({ status: 'loading' });
    const result = await validatePostcode(raw);
    if (result.valid) {
      setPostcodeValidation({
        status: 'valid',
        message: `✓ Valid postcode – ${result.location}`,
      });
    } else {
      setPostcodeValidation({
        status: 'invalid',
        message: '✗ Invalid postcode',
      });
    }
  }, [postcode]);

  const filteredSkills = SKILL_KEYS.filter((key) => {
    const label = (SKILL_LABELS[key] ?? key).toLowerCase();
    return label.includes(skillSearch.toLowerCase());
  });

  const addSkill = (key: string) => {
    const current = form.getValues('skills') ?? [];
    if (current.length >= MAX_SKILLS || current.includes(key)) return;
    form.setValue('skills', [...current, key]);
    setSkillSearch('');
  };

  const removeSkill = (key: string) => {
    const current = form.getValues('skills') ?? [];
    form.setValue('skills', current.filter((s) => s !== key));
  };

  async function onSubmit(values: WorkerFormInput) {
    const raw = values.home_postcode?.trim().replace(/\s/g, '').toUpperCase();
    if (raw && raw.length >= 5) {
      const result = await validatePostcode(raw);
      if (!result.valid) {
        setPostcodeValidation({ status: 'invalid', message: '✗ Invalid postcode' });
        toast.error('Please enter a valid UK postcode');
        return;
      }
      setPostcodeValidation({
        status: 'valid',
        message: `✓ Valid postcode – ${result.location}`,
      });
    }
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.set('full_name', values.full_name);
      formData.set('phone', values.phone);
      formData.set('email', values.email ?? '');
      formData.set('home_postcode', values.home_postcode);
      formData.set('worker_type', values.worker_type);
      formData.set('status', values.status);
      formData.set('skills', JSON.stringify(values.skills ?? []));

      const result =
        mode === 'create'
          ? await createWorker(formData)
          : await updateWorker(worker!.id, formData);

      if (!result.success) {
        toast.error(result.error ?? (mode === 'create' ? 'Failed to create worker' : 'Failed to update worker'));
        return;
      }
      toast.success(mode === 'create' ? 'Worker created' : 'Worker updated');
      router.push('/workers');
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">
          {mode === 'create' ? 'New worker' : 'Edit worker'}
        </h2>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John Smith"
                      {...field}
                      disabled={isSubmitting}
                      className="focus-visible:ring-brand-primary/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="07700 900 000"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="john@example.com"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="home_postcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Home postcode</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="SW1A 1AA"
                      {...field}
                      onBlur={() => {
                        field.onBlur();
                        onPostcodeBlur();
                      }}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  {postcodeValidation.status === 'loading' && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" />
                      Checking postcode…
                    </p>
                  )}
                  {postcodeValidation.status === 'valid' && postcodeValidation.message && (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                      {postcodeValidation.message}
                    </p>
                  )}
                  {postcodeValidation.status === 'invalid' && postcodeValidation.message && (
                    <p className="text-sm text-destructive">
                      {postcodeValidation.message}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="worker_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Worker type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {WORKER_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          <div>
                            <span className="font-medium">{o.label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {o.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                'size-2.5 rounded-full',
                                o.color
                              )}
                            />
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="skills"
              render={() => (
                <FormItem>
                  <FormLabel>Skills (optional, max {MAX_SKILLS})</FormLabel>
                  <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between font-normal"
                          disabled={isSubmitting || skills.length >= MAX_SKILLS}
                        >
                          <span className="text-muted-foreground">
                            {skills.length >= MAX_SKILLS
                              ? 'Maximum skills selected'
                              : 'Add skills…'}
                          </span>
                          <ChevronDown className="size-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-full min-w-[var(--radix-popover-trigger-width)] p-2" align="start">
                      <Input
                        placeholder="Search skills..."
                        value={skillSearch}
                        onChange={(e) => setSkillSearch(e.target.value)}
                        className="mb-2 h-8"
                      />
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {filteredSkills.map((key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => addSkill(key)}
                            disabled={skills.includes(key)}
                            className={cn(
                              'flex w-full items-center rounded-md px-2 py-1.5 text-sm text-left',
                              skills.includes(key)
                                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                : 'hover:bg-muted'
                            )}
                          >
                            {SKILL_LABELS[key] ?? key}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {skills.map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/50 pl-2 pr-1 py-0.5 text-xs"
                      >
                        {SKILL_LABELS[key] ?? key}
                        <button
                          type="button"
                          onClick={() => removeSkill(key)}
                          className="rounded p-0.5 hover:bg-muted"
                          aria-label={`Remove ${SKILL_LABELS[key] ?? key}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="button" variant="ghost" asChild disabled={isSubmitting}>
                <Link href="/workers">
                  <ArrowLeft className="size-4" />
                  Cancel
                </Link>
              </Button>
              <Button
                type="submit"
                variant="gradient"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {mode === 'create' ? 'Save worker' : 'Update worker'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
