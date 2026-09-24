'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createAgreement,
  updateAgreement,
} from '@/lib/actions/rounds/agreements';
import type { AgreementListRow } from '@/lib/data/rounds/agreements';
import type { ServiceRow } from '@/lib/data/rounds/service-catalog';
import {
  frequencyDaysFromParts,
  frequencyLabel,
  frequencyParts,
} from '@/lib/rounds/parse-frequency';
import type { Ymd } from '@/lib/rounds/dates';
import {
  agreementSchema,
  type AgreementInput,
} from '@/lib/validations/rounds/agreement';
import { AddressAutocompleteInput } from '@/components/ui/address-autocomplete-input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const NOTES_MAX = 500;

const WEEKDAY_OPTIONS = [
  { value: 'any', label: 'Any day' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
] as const;

const PAYMENT_METHOD_OPTIONS = [
  { value: 'none', label: 'Not set' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
] as const;

type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

function parseYmd(ymd: string): Date {
  return parseISO(ymd);
}

function priceString(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

type FormValues = AgreementInput;

export function AgreementForm({
  mode,
  customerId,
  customerName,
  services,
  today,
  agreement = null,
  showFirstBanner = false,
}: {
  mode: 'create' | 'edit';
  customerId: string;
  customerName: string;
  services: ServiceRow[];
  today: Ymd;
  agreement?: AgreementListRow | null;
  showFirstBanner?: boolean;
}) {
  const router = useRouter();
  const cancelHref = `/customers/${customerId}`;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [afterCreateOpen, setAfterCreateOpen] = useState(false);
  const [afterCreateGenerated, setAfterCreateGenerated] = useState(0);

  const initialFrequency = agreement?.frequency_days ?? 28;
  const initialParts = frequencyParts(initialFrequency);

  const form = useForm<FormValues>({
    resolver: zodResolver(agreementSchema),
    defaultValues: {
      customer_id: customerId,
      service_catalog_id: agreement?.service_catalog_id ?? null,
      title: agreement?.title ?? '',
      address: agreement?.address ?? '',
      postcode: agreement?.postcode ?? '',
      price: agreement?.price ?? 0,
      duration_minutes: agreement?.duration_minutes ?? 30,
      frequency_days: initialFrequency,
      schedule_mode: agreement?.schedule_mode ?? 'fixed',
      anchor_date: agreement?.anchor_date ?? today,
      preferred_weekday: agreement?.preferred_weekday ?? null,
      preferred_time: agreement?.preferred_time?.slice(0, 5) ?? '',
      default_payment_method: agreement?.default_payment_method ?? null,
      reminder_enabled: agreement?.reminder_enabled ?? true,
      access_notes: agreement?.access_notes ?? '',
      notes: agreement?.notes ?? '',
    },
  });

  const [frequencyMonths, setFrequencyMonths] = useState(initialParts.months);
  const [frequencyWeeks, setFrequencyWeeks] = useState(initialParts.weeks);

  const watchScheduleMode = form.watch('schedule_mode');
  const watchPrice = form.watch('price');
  const originalPrice = agreement?.price;

  const activeServices = useMemo(
    () => services.filter((s) => s.is_active),
    [services],
  );

  const applyService = (serviceId: string) => {
    if (serviceId === 'custom') {
      form.setValue('service_catalog_id', null);
      return;
    }
    const service = activeServices.find((s) => s.id === serviceId);
    if (!service) return;
    form.setValue('service_catalog_id', service.id);
    form.setValue('title', service.name, { shouldValidate: true });
    form.setValue('price', service.default_price, { shouldValidate: true });
    form.setValue('duration_minutes', service.default_duration_minutes, {
      shouldValidate: true,
    });
    if (service.default_frequency_days != null) {
      const days = service.default_frequency_days;
      form.setValue('frequency_days', days, { shouldValidate: true });
      const parts = frequencyParts(days);
      setFrequencyMonths(parts.months);
      setFrequencyWeeks(parts.weeks);
    }
  };

  const applyFrequencyParts = (months: number, weeks: number) => {
    const safeWeeks = months === 0 && weeks === 0 ? 1 : weeks;
    setFrequencyMonths(months);
    setFrequencyWeeks(safeWeeks);
    form.setValue('frequency_days', frequencyDaysFromParts(months, safeWeeks), {
      shouldValidate: true,
    });
  };

  const save = async (values: FormValues, applyPriceToFuture: boolean) => {
    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        const result = await createAgreement(values);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setAfterCreateGenerated(result.generated);
        setAfterCreateOpen(true);
        router.refresh();
        return;
      }

      if (!agreement) return;
      const result = await updateAgreement(agreement.id, values, {
        applyPriceToFuture,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Agreement updated');
      router.push(cancelHref);
      router.refresh();
    } finally {
      setIsSubmitting(false);
      setPriceDialogOpen(false);
      setPendingValues(null);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (
      mode === 'edit' &&
      agreement &&
      Number(values.price) !== Number(originalPrice)
    ) {
      setPendingValues(values);
      setPriceDialogOpen(true);
      return;
    }
    await save(values, false);
  };

  return (
    <>
      {showFirstBanner ? (
        <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Now add their first service</p>
          <p className="mt-0.5 text-muted-foreground">
            One service per agreement (own price and schedule). Need gutters as
            well as windows? Add this one, then add another.
          </p>
        </div>
      ) : null}

      <Card className="glass-card overflow-hidden border-border/80">
        <CardHeader className="pb-2">
          <h2 className="text-lg font-semibold">
            {mode === 'create' ? 'New agreement' : 'Edit agreement'}
          </h2>
          <p className="text-sm text-muted-foreground">For {customerName}</p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="service_catalog_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service</FormLabel>
                    <Select
                      value={field.value ?? 'custom'}
                      onValueChange={applyService}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick from your catalog" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="custom">
                          New custom service (type a title below)
                        </SelectItem>
                        {activeServices.map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activeServices.length === 0 ? (
                      <FormDescription>
                        No services in the catalog yet.{' '}
                        <Link
                          href="/services"
                          className="underline underline-offset-2"
                        >
                          Add presets or a service
                        </Link>
                        , or choose custom and type a title below.
                      </FormDescription>
                    ) : (
                      <FormDescription>
                        Pick one service for this agreement. Choosing a catalog
                        row fills title, price, duration, and frequency — you
                        can still change them. Another service = another
                        agreement after you save.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Window clean"
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
                name="postcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postcode</FormLabel>
                    <FormControl>
                      <AddressAutocompleteInput
                        value={field.value}
                        onValueChange={field.onChange}
                        onAddressSelect={({ address, postcode }) => {
                          if (postcode) {
                            field.onChange(postcode);
                          }
                          form.setValue('address', address, {
                            shouldValidate: true,
                          });
                        }}
                        placeholder="Start typing a postcode or address…"
                        disabled={isSubmitting}
                        className="uppercase"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Filled in automatically, or type manually"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (£)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={
                            field.value === undefined || field.value === null
                              ? ''
                              : String(field.value)
                          }
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === '' ? '' : e.target.value,
                            )
                          }
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="duration_minutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={5}
                          max={600}
                          value={
                            field.value === undefined || field.value === null
                              ? ''
                              : String(field.value)
                          }
                          onChange={(e) => field.onChange(e.target.value)}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-2">
                <FormLabel>How often</FormLabel>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    value={String(frequencyMonths)}
                    onValueChange={(value) =>
                      applyFrequencyParts(Number(value), frequencyWeeks)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 13 }, (_, months) => (
                        <SelectItem key={months} value={String(months)}>
                          {months} {months === 1 ? 'month' : 'months'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(frequencyWeeks)}
                    onValueChange={(value) =>
                      applyFrequencyParts(frequencyMonths, Number(value))
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 4 }, (_, weeks) => (
                        <SelectItem key={weeks} value={String(weeks)}>
                          {weeks} {weeks === 1 ? 'week' : 'weeks'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  {frequencyLabel(form.watch('frequency_days') || 28)}. A month
                  here is 4 weeks, so 1 month and 2 weeks is every 6 weeks.
                </p>
                {form.formState.errors.frequency_days ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.frequency_days.message}
                  </p>
                ) : null}
              </div>

              <FormField
                control={form.control}
                name="anchor_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>
                      {watchScheduleMode === 'after_completion'
                        ? 'First / next visit from'
                        : 'Anchor date'}
                    </FormLabel>
                    <Popover open={anchorOpen} onOpenChange={setAnchorOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isSubmitting}
                            className={cn(
                              'w-full justify-start gap-2 font-normal sm:max-w-xs',
                              !field.value && 'text-muted-foreground',
                            )}
                          >
                            <CalendarIcon className="size-4" />
                            {field.value
                              ? format(parseYmd(field.value), 'EEE d MMM yyyy')
                              : 'Pick a date'}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={
                            field.value ? parseYmd(field.value) : undefined
                          }
                          onSelect={(d) => {
                            if (!d) return;
                            field.onChange(toYmd(d));
                            setAnchorOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      {watchScheduleMode === 'fixed'
                        ? 'Visits are planned from this date on the calendar. Delays do not move later dates.'
                        : 'Completing a visit sets the next one from that day.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="schedule_mode"
                render={({ field }) => (
                  <FormItem className="rounded-xl border border-border/80 px-4 py-3">
                    <div className="flex flex-row items-start justify-between gap-4">
                      <div className="space-y-1">
                        <FormLabel className="text-base">
                          Shift later visits if this one runs late
                        </FormLabel>
                        <FormDescription>
                          {field.value === 'after_completion' ? (
                            <>
                              <span className="font-medium text-foreground">
                                On — count from the day you finished.
                              </span>{' '}
                              Example: due Friday, done Thursday → next visit is
                              counted from Thursday (about every{' '}
                              {form.watch('frequency_days') || 28} days from
                              then).
                            </>
                          ) : (
                            <>
                              <span className="font-medium text-foreground">
                                Off — keep the planned dates (recommended).
                              </span>{' '}
                              Example: booked every other Friday stays on those
                              Fridays even if you do one early or skip one.
                              What most window cleaners want.
                            </>
                          )}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value === 'after_completion'}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked ? 'after_completion' : 'fixed',
                            )
                          }
                          disabled={isSubmitting}
                          aria-label="Shift later visits if this one runs late"
                        />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="preferred_weekday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred weekday</FormLabel>
                      <Select
                        value={
                          field.value == null ? 'any' : String(field.value)
                        }
                        onValueChange={(v) =>
                          field.onChange(v === 'any' ? null : Number(v))
                        }
                        disabled={isSubmitting}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {WEEKDAY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
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
                  name="preferred_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred time</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          value={
                            typeof field.value === 'string' ? field.value : ''
                          }
                          onChange={(e) => field.onChange(e.target.value)}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormDescription>Optional</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="default_payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usual payment method</FormLabel>
                    <Select
                      value={field.value ?? 'none'}
                      onValueChange={(v) =>
                        field.onChange(
                          v === 'none' ? null : (v as PaymentMethod),
                        )
                      }
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full sm:max-w-xs">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHOD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      How they usually pay on the day. Logging payments lands in
                      Phase 2.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reminder_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between gap-4 rounded-xl border border-border/80 px-4 py-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Reminders</FormLabel>
                      <FormDescription>
                        On by default. Phase 3 will send “we&apos;re coming —
                        reply NO if that&apos;s a problem.” Silence means go.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="access_notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Access notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Gate code, side gate, dog…"
                        rows={3}
                        maxLength={NOTES_MAX}
                        disabled={isSubmitting}
                        className="resize-none"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Anything else for this property"
                        rows={3}
                        maxLength={NOTES_MAX}
                        disabled={isSubmitting}
                        className="resize-none"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {mode === 'create' ? 'Add service' : 'Save changes'}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href={cancelHref}>
                    <ArrowLeft className="mr-2 size-4" />
                    Cancel
                  </Link>
                </Button>
                {mode === 'create' && watchPrice != null ? (
                  <span className="text-sm text-muted-foreground">
                    {priceString(Number(watchPrice) || 0)} per visit
                  </span>
                ) : null}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply new price to upcoming visits?</DialogTitle>
            <DialogDescription>
              Planned visits that have not been done yet can keep the old price,
              or update to the new one. Done and skipped visits stay as they
              were.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                if (!pendingValues) return;
                void save(pendingValues, false);
              }}
            >
              Keep old price on visits
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={() => {
                if (!pendingValues) return;
                void save(pendingValues, true);
              }}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Update upcoming visits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={afterCreateOpen} onOpenChange={setAfterCreateOpen}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Service saved</DialogTitle>
            <DialogDescription>
              {afterCreateGenerated > 0
                ? `${afterCreateGenerated} visit${afterCreateGenerated === 1 ? '' : 's'} planned on the calendar.`
                : 'Agreement is on the customer.'}{' '}
              Each agreement is one service with its own price and schedule. Add
              another if they also need something else (e.g. gutters) or a
              second address.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setAfterCreateOpen(false);
                router.push(cancelHref);
                router.refresh();
              }}
            >
              Done
            </Button>
            <Button
              onClick={() => {
                setAfterCreateOpen(false);
                router.push(
                  `/customers/${customerId}/agreements/new`,
                );
                router.refresh();
              }}
            >
              Add another service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
