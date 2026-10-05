'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ArrowLeft, Building2, User, Wallet } from 'lucide-react';
import { LookCard } from '@/components/look';
import { leaveViaHistory } from '@/components/layout/history-back-button';
import { toast } from 'sonner';
import {
  CONTACT_CHOICE_LABELS,
  contactChoiceFromColumn,
  type ContactChoice,
} from '@/lib/messaging/channel';
import { customerSchema, type CustomerFormInput } from '@/lib/validations/customer';
import { createCustomer, createRoundsCustomer, updateCustomer, deleteCustomer } from '@/lib/actions/customers';
import { setCustomerHouse } from '@/lib/actions/rounds/agreements';
import { splitHouse } from '@/lib/rounds/house';
import {
  AddressAutocompleteInput,
  unhookChromeAddressFill,
} from '@/components/ui/address-autocomplete-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormDescription,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { CustomerDetailRow } from '@/lib/data/customers';

const NOTES_MAX = 500;

const PAYMENT_TERM_OPTIONS = [
  { value: 'on_the_day', label: 'No invoice' },
  { value: 'invoice', label: 'Send an invoice after each visit' },
] as const;

const CONTACT_BY_OPTIONS: ContactChoice[] = ['default', 'sms', 'email', 'none'];

interface CustomerFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  customer?: CustomerDetailRow | null;
  jobCount?: number;
  variant?: 'pro' | 'rounds';
  house?: { address: string; postcode: string } | null;
  /** Create mode only. Filled from a won enquiry. */
  prefill?: {
    leadId: string;
    name: string;
    phone: string;
    email: string;
    postcode: string;
    notes: string;
  };
}

export function CustomerForm({
  mode,
  tenantId,
  customer,
  jobCount = 0,
  variant = 'pro',
  house = null,
  prefill,
}: CustomerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isRounds = variant === 'rounds';
  const cancelHref =
    mode === 'edit' && customer?.id ? `/customers/${customer.id}` : '/customers';

  // The customer's own address wins; a service address is the fallback for
  // customers saved before the address moved onto the customer.
  const stored = splitHouse(customer?.address);
  const home = stored.address ? stored : (house ?? { address: '', postcode: '' });
  const fromEnquiry = mode === 'create' ? prefill : undefined;

  const form = useForm<CustomerFormInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: fromEnquiry?.name ?? customer?.name ?? '',
      type: isRounds ? 'individual' : ((customer?.type as 'bulk_client' | 'individual') ?? 'individual'),
      email: fromEnquiry?.email ?? customer?.email ?? '',
      phone: fromEnquiry?.phone ?? customer?.phone ?? '',
      address: isRounds ? home.address : (customer?.address ?? ''),
      postcode: isRounds ? (fromEnquiry?.postcode ?? home.postcode) : '',
      notes: fromEnquiry?.notes ?? customer?.notes ?? '',
      payment_terms: customer?.payment_terms === 'invoice' ? 'invoice' : 'on_the_day',
      access_notes: customer?.access_notes ?? '',
      preferred_channel: isRounds
        ? contactChoiceFromColumn(customer?.preferred_channel)
        : undefined,
      owesFromBefore: '',
    },
  });

  const watchType = form.watch('type');
  const watchNotes = form.watch('notes') ?? '';
  const isBulkClient = watchType === 'bulk_client';

  async function onSubmit(values: CustomerFormInput) {
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.set('name', values.name);
      formData.set('type', isRounds ? 'individual' : values.type);
      formData.set('email', values.email ?? '');
      formData.set('phone', values.phone ?? '');
      formData.set('address', values.address ?? '');
      if (isRounds) {
        const address = (values.address ?? '').trim();
        const postcode = (values.postcode ?? '').trim();
        if (address.length < 5) {
          toast.error('Enter the address.');
          return;
        }
        if (postcode.length < 5) {
          toast.error('Enter a UK postcode.');
          return;
        }
        formData.set('postcode', postcode);
      }
      formData.set('notes', values.notes ?? '');
      if (isRounds && fromEnquiry) formData.set('fromLeadId', fromEnquiry.leadId);
      if (isRounds) {
        formData.set('payment_terms', values.payment_terms ?? 'on_the_day');
        formData.set('access_notes', values.access_notes ?? '');
        const contactBy =
          values.preferred_channel === 'whatsapp' ? 'sms' : (values.preferred_channel ?? 'default');
        formData.set('preferred_channel', contactBy);
        if (mode === 'create') {
          // The resolver hands back the parsed number (blank → undefined).
          const owes = values.owesFromBefore;
          if (typeof owes === 'number' && owes > 0) {
            formData.set('owesFromBefore', String(owes));
          }
        }
      }

      const result =
        mode === 'create'
          ? isRounds
            ? await createRoundsCustomer(formData)
            : await createCustomer(formData)
          : await updateCustomer(customer!.id, formData);

      if (!result.success) {
        toast.error(result.error ?? (mode === 'create' ? 'Failed to create customer' : 'Failed to update customer'));
        return;
      }
      toast.success(mode === 'create' ? 'Customer created' : 'Customer updated');
      if ('warning' in result && typeof result.warning === 'string') {
        toast.warning(result.warning);
      }
      if (isRounds) {
        const address = (values.address ?? '').trim();
        const postcode = (values.postcode ?? '').trim();
        if (mode === 'edit' && customer?.id) {
          const houseResult = await setCustomerHouse(customer.id, address, postcode);
          if (!houseResult.success) {
            toast.error(houseResult.error);
            return;
          }
        }
        if (mode === 'create' && 'id' in result && typeof result.id === 'string') {
          const params = new URLSearchParams({
            first: '1',
            address,
            postcode,
          });
          router.push(`/customers/${result.id}/agreements/new?${params.toString()}`);
        } else if (customer?.id) {
          leaveViaHistory(router, `/customers/${customer.id}`);
        } else {
          leaveViaHistory(router, '/customers');
        }
      } else {
        leaveViaHistory(router, '/customers');
      }
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleDelete = async () => {
    if (!customer?.id) return;
    setIsDeleting(true);
    const result = await deleteCustomer(customer.id);
    setIsDeleting(false);
    setDeleteDialogOpen(false);
    if (result.success) {
      toast.success('Customer deleted');
      leaveViaHistory(router, '/customers');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete customer');
    }
  };


  const nameField = (
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Customer Name</FormLabel>
          <FormControl>
            <Input
              placeholder={isBulkClient ? 'ABC Property Management' : 'John Smith'}
              {...field}
              disabled={isSubmitting}
              className="focus-visible:ring-brand-primary/30 focus-visible:shadow-[var(--shadow-input-focus-value)]"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const typeField = (
    <>{!isRounds && (
    <FormField
      control={form.control}
      name="type"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Customer Type</FormLabel>
          <FormControl>
            <div className="flex flex-col gap-3">
              <label
                className={cn(
                  'flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition-all',
                  field.value === 'bulk_client'
                    ? 'border-violet-400/60 bg-violet-500/10 shadow-[0_0_16px_-2px_rgba(139,92,246,0.25)]'
                    : 'border-border/80 hover:border-border hover:bg-muted/30'
                )}
              >
                <input
                  type="radio"
                  name={field.name}
                  value="bulk_client"
                  checked={field.value === 'bulk_client'}
                  onChange={() => field.onChange('bulk_client')}
                  className="mt-1"
                />
                <div className="flex items-start gap-2">
                  <Building2 className="size-5 shrink-0 text-violet-600 dark:text-violet-400" />
                  <div>
                    <span className="font-medium">Bulk Client</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Property management companies, housing associations. Submits jobs via CSV or bulk import.
                    </p>
                  </div>
                </div>
              </label>
              <label
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border-2 p-3 transition-all',
                  field.value === 'individual'
                    ? 'border-emerald-400/50 bg-emerald-500/10'
                    : 'border-border/80 hover:border-border hover:bg-muted/30'
                )}
              >
                <input
                  type="radio"
                  name={field.name}
                  value="individual"
                  checked={field.value === 'individual'}
                  onChange={() => field.onChange('individual')}
                  className="mt-0.5"
                />
                <div className="flex items-start gap-2">
                  <User className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <span className="text-sm font-medium">Individual</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Homeowners, one-off customers. Single job requests.
                    </p>
                  </div>
                </div>
              </label>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
    )}</>
  );

  const emailField = (
    <FormField
      control={form.control}
      name="email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Email (optional)</FormLabel>
          <FormControl>
            <Input
              type="email"
              placeholder="contact@company.com"
              {...field}
              disabled={isSubmitting}
              className="focus-visible:ring-brand-primary/30"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const phoneField = (
    <FormField
      control={form.control}
      name="phone"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Phone (optional)</FormLabel>
          <FormControl>
            <Input
              placeholder="020 7946 0958"
              {...field}
              disabled={isSubmitting}
              className="focus-visible:ring-brand-primary/30"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const addressField = (
    <FormField
      control={form.control}
      name="address"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{unhookChromeAddressFill('Address')}</FormLabel>
          <FormControl>
            <AddressAutocompleteInput
              value={field.value ?? ''}
              onValueChange={field.onChange}
              onAddressSelect={({ address, postcode }) => {
                field.onChange(address);
                if (postcode) {
                  form.setValue('postcode', postcode, { shouldValidate: true });
                }
              }}
              placeholder="Start typing a postcode or address…"
              disabled={isSubmitting}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const postcodeField = (
    <FormField
      control={form.control}
      name="postcode"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{unhookChromeAddressFill('Postcode')}</FormLabel>
          <FormControl>
            <Input
              placeholder="SW1A 1AA"
              {...field}
              name="outward"
              autoComplete="off"
              value={field.value ?? ''}
              disabled={isSubmitting}
              className="uppercase"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const paymentField = (
    <FormField
      control={form.control}
      name="payment_terms"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Invoices</FormLabel>
          <FormControl>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_TERM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => field.onChange(opt.value)}
                  className={cn(
                    'rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-all',
                    field.value === opt.value
                      ? 'border-emerald-400/50 bg-emerald-500/10'
                      : 'border-border/80 hover:border-border hover:bg-muted/30',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const owesField = (
    <>{mode === 'create' ? (
      <FormField
        control={form.control}
        name="owesFromBefore"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Owes from before (£)</FormLabel>
            <FormControl>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                onChange={field.onChange}
                value={
                  typeof field.value === 'string' || typeof field.value === 'number'
                    ? field.value
                    : ''
                }
                disabled={isSubmitting}
                className="focus-visible:ring-brand-primary/30"
              />
            </FormControl>
            <FormDescription>
              Money they owed you before you started using WorkWise. It&apos;s paid off first.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    ) : null}</>
  );

  const accessField = (
    <FormField
      control={form.control}
      name="access_notes"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Access notes</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Gate code, dog, park on the left…"
              {...field}
              value={field.value ?? ''}
              disabled={isSubmitting}
              rows={3}
              maxLength={NOTES_MAX + 50}
              className="resize-none focus-visible:ring-brand-primary/30"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const channelField = (
    <FormField
      control={form.control}
      name="preferred_channel"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Contact by</FormLabel>
          <Select
            value={field.value === 'whatsapp' ? 'sms' : (field.value ?? 'default')}
            onValueChange={field.onChange}
            disabled={isSubmitting}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {CONTACT_BY_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {CONTACT_CHOICE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>
            Business default follows Settings → Rounds → Customer messages.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const notesField = (
    <FormField
      control={form.control}
      name="notes"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Notes (optional)</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Internal notes about this customer..."
              {...field}
              disabled={isSubmitting}
              rows={3}
              maxLength={NOTES_MAX + 50}
              className="resize-none focus-visible:ring-brand-primary/30"
            />
          </FormControl>
          <p className="text-xs text-muted-foreground">
            {watchNotes.length} / {NOTES_MAX}
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const formActions = (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <Button
        type="button"
        variant="ghost"
        className="gap-2"
        disabled={isSubmitting}
        onClick={() => leaveViaHistory(router, cancelHref)}
      >
        <ArrowLeft className="size-4" />
        Cancel
      </Button>
      <Button
        type="submit"
        variant={isRounds ? 'default' : 'gradient'}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {mode === 'create' ? 'Saving…' : 'Updating…'}
          </>
        ) : mode === 'create' ? (
          'Save Customer'
        ) : (
          'Update Customer'
        )}
      </Button>
    </div>
  );

  const deleteAction = (
    <>{mode === 'edit' && !isRounds && (
      <div className="border-t border-border/80 pt-4 mt-6">
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={isSubmitting}
        >
          Delete customer
        </Button>
      </div>
    )}</>
  );

  return (
    <>
      {isRounds ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {fromEnquiry ? (
              <>
                <input type="hidden" name="fromLeadId" value={fromEnquiry.leadId} />
                <p className="rounded-xl border border-(--tone-sky-line) bg-(--tone-sky-soft) px-4 py-2.5 text-sm text-(--tone-sky-text)">
                  Filled in from {fromEnquiry.name}&apos;s enquiry
                </p>
              </>
            ) : null}
            <div className="grid gap-5 lg:grid-cols-2">
              <LookCard title="Who they are" icon={User} tone="rounds">
                <div className="space-y-5">
                  {nameField}
                  {phoneField}
                  {emailField}
                  {addressField}
                  {postcodeField}
                </div>
              </LookCard>
              <LookCard title="How they pay and what to know" icon={Wallet} tone="emerald">
                <div className="space-y-5">
                  {paymentField}
                  {owesField}
                  {channelField}
                  {accessField}
                  {notesField}
                </div>
              </LookCard>
            </div>
            {formActions}
          </form>
        </Form>
      ) : (
      <Card
        className={cn(
          'glass-card overflow-hidden border-border/80',
          'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
        )}
      >
        <CardHeader className="pb-2">
          <h2 className="text-lg font-semibold">
            {mode === 'create' ? 'New customer' : 'Edit customer'}
          </h2>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {nameField}
              {typeField}
              {emailField}
              {phoneField}
              {notesField}
              {formActions}
              {deleteAction}
            </form>
          </Form>
        </CardContent>
      </Card>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete customer?</DialogTitle>
            <DialogDescription>
              {jobCount > 0
                ? `This customer has ${jobCount} job(s). Customers with existing jobs cannot be deleted.`
                : 'This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || jobCount > 0}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
