'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail, Phone, User } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CopyButton } from '@/components/jobs/copy-button';
import { updateJobCustomer } from '@/lib/actions/jobs';
import type { CustomerRow } from '@/lib/data/customers';
import { cn } from '@/lib/utils';

const NONE_VALUE = '__none__';

const TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  bulk_client: 'Bulk client',
};

interface JobDetailCustomerCardProps {
  jobId: string;
  customer: {
    id: string;
    name: string;
    type: string;
    email: string | null;
    phone: string | null;
  } | null;
  customers: CustomerRow[];
  readOnly?: boolean;
}

function customerLabel(name: string, type: string) {
  return type === 'bulk_client' ? `${name} (Bulk)` : name;
}

export function JobDetailCustomerCard({
  jobId,
  customer,
  customers,
  readOnly = false,
}: JobDetailCustomerCardProps) {
  const router = useRouter();
  const [isChanging, setIsChanging] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canChange = !readOnly && (customers.length > 0 || customer != null);
  const typeLabel = customer ? TYPE_LABELS[customer.type] ?? customer.type : null;

  const options = useMemo(() => {
    const next = [
      { value: NONE_VALUE, label: 'No customer' },
      ...customers.map((c) => ({
        value: c.id,
        label: customerLabel(c.name, c.type),
      })),
    ];
    if (customer && !customers.some((c) => c.id === customer.id)) {
      next.splice(1, 0, {
        value: customer.id,
        label: customerLabel(customer.name, customer.type),
      });
    }
    return next;
  }, [customers, customer]);

  const selectValue = customer?.id ?? NONE_VALUE;

  function stopChanging() {
    setIsChanging(false);
    setPendingValue(null);
  }

  function handleSelect(value: string) {
    const nextId = value === NONE_VALUE ? null : value;
    const currentId = customer?.id ?? null;
    if (nextId === currentId) {
      stopChanging();
      return;
    }
    setPendingValue(value);
  }

  function confirmDescription() {
    if (!pendingValue) return '';
    if (pendingValue === NONE_VALUE) {
      return customer
        ? `This job will no longer show under ${customer.name}. It will have no customer.`
        : 'This job will have no customer.';
    }
    const next =
      customers.find((c) => c.id === pendingValue) ??
      (customer?.id === pendingValue ? customer : null);
    const nextName = next?.name ?? 'the selected customer';
    if (customer) {
      return `This job will no longer show under ${customer.name}. It will show under ${nextName}.`;
    }
    return `This job will show under ${nextName}.`;
  }

  async function handleConfirm() {
    if (!pendingValue) return;
    setIsSaving(true);
    try {
      const nextId = pendingValue === NONE_VALUE ? null : pendingValue;
      const result = await updateJobCustomer(jobId, nextId);
      if (result.success) {
        toast.success(nextId ? 'Customer updated' : 'Customer removed');
        stopChanging();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to update customer');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Customer</h2>
        {canChange && (
          <CardAction>
            {isChanging ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={stopChanging}
                disabled={isSaving}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setIsChanging(true)}
              >
                Change
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isChanging && (
          <SearchableSelect
            value={selectValue}
            onValueChange={handleSelect}
            disabled={isSaving}
            placeholder="Select customer"
            searchPlaceholder="Search customer..."
            emptyText="No customers found."
            className={cn(
              'w-full border-border/80 bg-background/50 backdrop-blur-sm',
              'focus:ring-primary/20 focus:border-primary/40'
            )}
            options={options}
          />
        )}
        {customer ? (
          <>
            <div className="flex items-center gap-2">
              <User className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium text-foreground">{customer.name || '—'}</span>
            </div>
            {typeLabel && (
              <span
                className={cn(
                  'inline-flex rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400'
                )}
              >
                {typeLabel}
              </span>
            )}
            {customer.email && (
              <div className="flex items-center gap-1">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={`mailto:${customer.email}`}
                  className="text-sm text-primary hover:underline truncate"
                >
                  {customer.email}
                </a>
                <CopyButton value={customer.email} label="Copy email" />
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-1">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={`tel:${customer.phone}`}
                  className="text-sm text-primary hover:underline"
                >
                  {customer.phone}
                </a>
                <CopyButton value={customer.phone} label="Copy phone" />
              </div>
            )}
            {!customer.email && !customer.phone && (
              <p className="text-xs text-muted-foreground">No contact details</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No customer</p>
        )}
      </CardContent>

      <Dialog
        open={pendingValue != null}
        onOpenChange={(open) => {
          if (!open && !isSaving) setPendingValue(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change customer</DialogTitle>
            <DialogDescription>{confirmDescription()}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPendingValue(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
