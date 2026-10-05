'use client';

import { useMemo, useState } from 'react';
import { Link2, Plus, Search } from 'lucide-react';
import { Avatar } from '@/components/look';
import { copyPayLink } from '@/components/payments/copy-pay-link-button';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatGbp } from '@/lib/money/pence';

type Pick = 'record' | 'link';

/**
 * The two things you do on Payments without starting from a list: record a payment
 * (cash on the doorstep, a cheque in the post) and copy a customer's pay link.
 * Both start by choosing the customer.
 */
export function PaymentsActions({
  customers,
  owedByCustomer,
}: {
  customers: { id: string; name: string }[];
  /** What each customer owes now, so Record a payment can suggest the amount. */
  owedByCustomer: Record<string, number>;
}) {
  const [picking, setPicking] = useState<Pick | null>(null);
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? customers.filter((c) => c.name.toLowerCase().includes(needle)) : customers;
    return list.slice(0, 40);
  }, [customers, query]);

  const choose = (customerId: string) => {
    const mode = picking;
    setPicking(null);
    setQuery('');
    if (mode === 'record') setRecordFor(customerId);
    else if (mode === 'link') void copyPayLink(customerId);
  };

  const owedNow = recordFor ? owedByCustomer[recordFor] : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setPicking('link')}>
          <Link2 className="size-4" />
          Copy pay link
        </Button>
        <Button onClick={() => setPicking('record')}>
          <Plus className="size-4" />
          Record a payment
        </Button>
      </div>

      <Dialog
        open={picking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPicking(null);
            setQuery('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{picking === 'link' ? 'Whose pay link?' : 'Who paid you?'}</DialogTitle>
            <DialogDescription>
              {picking === 'link'
                ? 'Pick a customer and their pay link is copied.'
                : 'Pick a customer, then say how much and how they paid.'}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customers…"
              aria-label="Search customers"
              className="pl-9"
            />
          </div>
          {matches.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No customer called that.</p>
          ) : (
            <ul className="-mx-1 max-h-72 divide-y divide-border overflow-y-auto px-1">
              {matches.map((customer) => {
                const owes = owedByCustomer[customer.id];
                return (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => choose(customer.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <Avatar name={customer.name} size="sm" tone={owes ? 'rose' : 'slate'} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{customer.name}</span>
                      {owes ? (
                        <span className="text-xs font-medium text-(--tone-rose-text) tabular-nums">
                          owes {formatGbp(owes)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {recordFor ? (
        <RecordPaymentDialog
          key={recordFor}
          customerId={recordFor}
          defaultAmount={owedNow ?? null}
          unpaidVisits={[]}
          title="Record a payment"
          open
          onOpenChange={(open) => {
            if (!open) setRecordFor(null);
          }}
        />
      ) : null}
    </>
  );
}
