'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ArrowLeft, Building2, User } from 'lucide-react';
import { toast } from 'sonner';
import { customerSchema, type CustomerFormInput } from '@/lib/validations/customer';
import { createCustomer, updateCustomer, deleteCustomer } from '@/lib/actions/customers';
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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { CustomerDetailRow } from '@/lib/data/customers';

const NOTES_MAX = 500;

interface CustomerFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  customer?: CustomerDetailRow | null;
  jobCount?: number;
}

export function CustomerForm({ mode, tenantId, customer, jobCount = 0 }: CustomerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const form = useForm<CustomerFormInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: customer?.name ?? '',
      type: (customer?.type as 'bulk_client' | 'individual') ?? 'individual',
      email: customer?.email ?? '',
      phone: customer?.phone ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
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
      formData.set('type', values.type);
      formData.set('email', values.email ?? '');
      formData.set('phone', values.phone ?? '');
      formData.set('address', values.address ?? '');
      formData.set('notes', values.notes ?? '');

      const result =
        mode === 'create'
          ? await createCustomer(formData)
          : await updateCustomer(customer!.id, formData);

      if (!result.success) {
        toast.error(result.error ?? (mode === 'create' ? 'Failed to create customer' : 'Failed to update customer'));
        return;
      }
      toast.success(mode === 'create' ? 'Customer created' : 'Customer updated');
      router.push('/customers');
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
      router.push('/customers');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete customer');
    }
  };

  return (
    <>
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

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button type="button" variant="ghost" asChild disabled={isSubmitting}>
                  <Link href="/customers" className="gap-2">
                    <ArrowLeft className="size-4" />
                    Cancel
                  </Link>
                </Button>
                <Button
                  type="submit"
                  variant="gradient"
                  disabled={isSubmitting}
                  className="shadow-[var(--shadow-btn-glow-value)]"
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

              {mode === 'edit' && (
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
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

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
