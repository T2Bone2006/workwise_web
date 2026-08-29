'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

type DisplayCustomer = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
};

interface JobDetailCustomerCardProps {
  jobId: string;
  customerId: string | null;
  customer: DisplayCustomer | null;
  customers: CustomerRow[];
  readOnly?: boolean;
}

function customerLabel(name: string, type: string) {
  return type === 'bulk_client' ? `${name} (Bulk)` : name;
}

function resolveCustomer(
  customer: DisplayCustomer | null,
  customerId: string | null,
  customers: CustomerRow[]
): DisplayCustomer | null {
  if (customer) return customer;
  if (!customerId) return null;
  const match = customers.find((c) => c.id === customerId);
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    type: match.type,
    email: null,
    phone: null,
  };
}

export function JobDetailCustomerCard({
  jobId,
  customerId,
  customer,
  customers,
  readOnly = false,
}: JobDetailCustomerCardProps) {
  const router = useRouter();
  const [isChanging, setIsChanging] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [displayed, setDisplayed] = useState<DisplayCustomer | null>(() =>
    resolveCustomer(customer, customerId, customers)
  );

  useEffect(() => {
    setDisplayed(resolveCustomer(customer, customerId, customers));
  }, [jobId]);

  useEffect(() => {
    const resolved = resolveCustomer(customer, customerId, customers);
    if (resolved) {
      setDisplayed(resolved);
    }
  }, [customer, customerId, customers]);

  const canChange = !readOnly && (customers.length > 0 || displayed != null);
  const typeLabel = displayed ? TYPE_LABELS[displayed.type] ?? displayed.type : null;

  const options = useMemo(() => {
    const next = [
      { value: NONE_VALUE, label: 'No customer' },
      ...customers.map((c) => ({
        value: c.id,
        label: customerLabel(c.name, c.type),
      })),
    ];
    if (displayed && !customers.some((c) => c.id === displayed.id)) {
      next.splice(1, 0, {
        value: displayed.id,
        label: customerLabel(displayed.name, displayed.type),
      });
    }
    return next;
  }, [customers, displayed]);

  const selectValue = displayed?.id ?? NONE_VALUE;

  function stopChanging() {
    setIsChanging(false);
    setPendingValue(null);
  }

  function handleSelect(value: string) {
    const nextId = value === NONE_VALUE ? null : value;
    const currentId = displayed?.id ?? null;
    if (nextId === currentId) {
      stopChanging();
      return;
    }
    setPendingValue(value);
  }

  function confirmDescription() {
    if (!pendingValue) return '';
    if (pendingValue === NONE_VALUE) {
      return displayed
        ? `This job will no longer show under ${displayed.name}. It will have no customer.`
        : 'This job will have no customer.';
    }
    const next =
      customers.find((c) => c.id === pendingValue) ??
      (displayed?.id === pendingValue ? displayed : null);
    const nextName = next?.name ?? 'the selected customer';
    if (displayed) {
      return `This job will no longer show under ${displayed.name}. It will show under ${nextName}.`;
    }
    return `This job will show under ${nextName}.`;
  }

  async function handleConfirm() {
    if (!pendingValue) return;
    setIsSaving(true);
    try {
      const nextId = pendingValue === NONE_VALUE ? '' : pendingValue;
      const result = await updateJobCustomer({ jobId, customerId: nextId });
      if (result.success) {
        toast.success(result.customer ? 'Customer updated' : 'Customer removed');
        setDisplayed(result.customer);
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
        {displayed ? (
          <>
            <div className="flex items-center gap-2">
              <User className="size-4 shrink-0 text-muted-foreground" />
              <Link
                href={`/customers/${displayed.id}`}
                className="truncate font-medium text-foreground hover:text-primary hover:underline"
              >
                {displayed.name || '—'}
              </Link>
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
            {displayed.email && (
              <div className="flex items-center gap-1">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={`mailto:${displayed.email}`}
                  className="text-sm text-primary hover:underline truncate"
                >
                  {displayed.email}
                </a>
                <CopyButton value={displayed.email} label="Copy email" />
              </div>
            )}
            {displayed.phone && (
              <div className="flex items-center gap-1">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={`tel:${displayed.phone}`}
                  className="text-sm text-primary hover:underline"
                >
                  {displayed.phone}
                </a>
                <CopyButton value={displayed.phone} label="Copy phone" />
              </div>
            )}
            {!displayed.email && !displayed.phone && (
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
              type="button"
              variant="outline"
              onClick={() => setPendingValue(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
