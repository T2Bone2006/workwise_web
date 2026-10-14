'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserCheck } from 'lucide-react';
import { Notice, floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { markAllChecked, markCustomerChecked } from '@/lib/actions/customers-added';

/** The top of the customer list when your team has added customers you haven't looked at. */
export function AddedByBanner({ count }: { count: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (count <= 0) return null;

  const markAll = async () => {
    if (pending) return;
    setPending(true);
    const result = await markAllChecked();
    setPending(false);
    floatingMessage(
      result.ok
        ? { title: result.changed === 0 ? 'Nothing to mark' : `Marked ${result.changed} ${result.changed === 1 ? 'customer' : 'customers'} as checked`, tone: 'success' }
        : { title: result.error, tone: 'error' },
    );
    router.refresh();
  };

  return (
    <Notice
      tone="amber"
      icon={UserCheck}
      title={`${count} ${count === 1 ? 'customer was' : 'customers were'} added by your team`}
      action={
        <Button type="button" size="sm" onClick={markAll} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Mark all checked
        </Button>
      }
    >
      Have a look and mark them checked.
    </Notice>
  );
}

/** "Looks fine" on the customer's page: marks just this customer as checked. Changes nothing else about them. */
export function LooksFineButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        const result = await markCustomerChecked(customerId);
        setPending(false);
        floatingMessage(result.ok ? { title: 'Marked as checked', tone: 'success' } : { title: result.error, tone: 'error' });
        router.refresh();
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserCheck />}
      Looks fine
    </Button>
  );
}
