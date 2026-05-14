'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, UserPlus, X, ChevronDown } from 'lucide-react';
import { inviteWorker } from '@/lib/actions/workers';
import {
  inviteWorkerPayloadSchema,
  type InviteWorkerFormInput,
} from '@/lib/validations/worker-invite';
import type { TenantSkillRow } from '@/lib/actions/skills';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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

const defaultInviteValues: InviteWorkerFormInput = {
  full_name: '',
  phone: '',
  email: '',
  home_postcode: '',
  worker_type: 'company_subcontractor',
  status: 'available',
  skills: [],
};

export function InviteWorkerDialog({
  children,
  tenantSkills,
}: {
  children: React.ReactNode;
  tenantSkills: TenantSkillRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [postcodeValidation, setPostcodeValidation] = useState<{
    status: 'idle' | 'loading' | 'valid' | 'invalid';
    message?: string;
  }>({ status: 'idle' });

  const form = useForm<InviteWorkerFormInput>({
    resolver: zodResolver(inviteWorkerPayloadSchema),
    defaultValues: defaultInviteValues,
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

  const q = skillSearch.toLowerCase();
  const filteredSkills = tenantSkills.filter((skill) => {
    const hay = `${skill.label} ${skill.key}`.toLowerCase();
    return hay.includes(q);
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

  async function handleSubmit(values: InviteWorkerFormInput) {
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

    const fd = new FormData();
    fd.set('full_name', values.full_name);
    fd.set('phone', values.phone);
    fd.set('email', values.email);
    fd.set('home_postcode', values.home_postcode);
    fd.set('worker_type', values.worker_type);
    fd.set('status', values.status);
    fd.set('skills', JSON.stringify(values.skills ?? []));

    const result = await inviteWorker(fd);

    if (result.success) {
      toast.success('Invitation sent', {
        description:
          'They will receive an email to set their password and open the app.',
      });
      form.reset(defaultInviteValues);
      setPostcodeValidation({ status: 'idle' });
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to send invite');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset(defaultInviteValues);
          setPostcodeValidation({ status: 'idle' });
          setSkillsOpen(false);
          setSkillSearch('');
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[min(90vh,720px)] max-w-xl flex-col gap-0 p-0 sm:max-w-xl">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex max-h-[min(90vh,720px)] flex-col overflow-hidden"
          >
            <div className="shrink-0 border-b border-border/80 px-6 pb-4 pt-6">
              <DialogHeader className="space-y-2 text-left">
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                    <UserPlus className="size-4 text-primary" />
                  </span>
                  Invite worker
                </DialogTitle>
                <DialogDescription>
                  Their profile is saved on your team. An invite email is sent so they can sign in to
                  the mobile app.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
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
                          disabled={form.formState.isSubmitting}
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
                          disabled={form.formState.isSubmitting}
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
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          {...field}
                          disabled={form.formState.isSubmitting}
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
                          disabled={form.formState.isSubmitting}
                        />
                      </FormControl>
                      {postcodeValidation.status === 'loading' && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          Checking postcode…
                        </p>
                      )}
                      {postcodeValidation.status === 'valid' && postcodeValidation.message && (
                        <p className="text-sm text-emerald-600 dark:text-emerald-400">
                          {postcodeValidation.message}
                        </p>
                      )}
                      {postcodeValidation.status === 'invalid' &&
                        postcodeValidation.message && (
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
                        disabled={form.formState.isSubmitting}
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
                        disabled={form.formState.isSubmitting}
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
                                <span className={cn('size-2.5 rounded-full', o.color)} />
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
                      <FormLabel>
                        Skills (optional, max {MAX_SKILLS})
                      </FormLabel>
                      <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full justify-between font-normal"
                              disabled={
                                form.formState.isSubmitting || skills.length >= MAX_SKILLS
                              }
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
                        <PopoverContent
                          className="w-full min-w-[var(--radix-popover-trigger-width)] p-2"
                          align="start"
                        >
                          <Input
                            placeholder="Search skills..."
                            value={skillSearch}
                            onChange={(e) => setSkillSearch(e.target.value)}
                            className="mb-2 h-8"
                          />
                          <div className="max-h-48 space-y-0.5 overflow-y-auto">
                            {filteredSkills.map((skill) => (
                              <button
                                key={skill.key}
                                type="button"
                                onClick={() => addSkill(skill.key)}
                                disabled={skills.includes(skill.key)}
                                className={cn(
                                  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm',
                                  skills.includes(skill.key)
                                    ? 'cursor-not-allowed bg-muted text-muted-foreground'
                                    : 'hover:bg-muted'
                                )}
                              >
                                {skill.label}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {skills.map((key) => {
                          const display =
                            tenantSkills.find((s) => s.key === key)?.label ?? key;
                          return (
                            <span
                              key={key}
                              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/50 py-0.5 pl-2 pr-1 text-xs"
                            >
                              {display}
                              <button
                                type="button"
                                onClick={() => removeSkill(key)}
                                className="rounded p-0.5 hover:bg-muted"
                                aria-label={`Remove ${display}`}
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t border-border/80 px-6 py-4 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="gradient" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
