'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { CheckCircle2, MessageSquareOff } from 'lucide-react';
import { LookCard, Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import { markNotDeliveredSorted } from '@/lib/actions/not-delivered';
import type { NotDelivered } from '@/lib/data/messaging/not-delivered';

/** Customers whose payment link or reminder never went because the business had no texts. */
export function NotDeliveredList({ items }: { items: NotDelivered[] }): JSX.Element {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = items.filter((i) => !hidden.has(i.messageId));

  async function sorted(id: string) {
    setHidden((prev) => new Set(prev).add(id));
    const result = await markNotDeliveredSorted(id);
    if ('error' in result) {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <LookCard title="Didn't get their message" icon={MessageSquareOff} tone={shown.length > 0 ? 'amber' : 'emerald'}>
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-(--tone-emerald-text)" aria-hidden />
          Everyone got their message. Nice.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((item) => (
            <li key={item.messageId} className="flex flex-col gap-2 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.customerName}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Tag tone="amber">{item.label}</Tag>
                  {item.why === 'expired' ? 'waited too long' : 'no texts left at the time'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {item.phone ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`sms:${item.phone}`}>Text</a>
                  </Button>
                ) : null}
                {item.email ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`mailto:${item.email}`}>Email</a>
                  </Button>
                ) : null}
                <Button asChild size="sm" variant="outline">
                  <Link href={`/customers/${item.customerId}`}>Open customer</Link>
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void sorted(item.messageId)}>
                  Mark sorted
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </LookCard>
  );
}
