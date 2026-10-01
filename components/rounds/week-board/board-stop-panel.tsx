'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import type { SmsBrand } from '@/lib/messaging/templates';
import type { BoardStop } from '@/lib/rounds/week-board';
import { VisitStopCard } from '@/components/rounds/visit-stop-card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/** "Open job": the same card as the day plan (Done, Skip, Reschedule…), in a side panel. */
export function BoardStopPanel(props: {
  stop: BoardStop | null;
  brand: SmsBrand;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { stop } = props;
  const customerId = stop?.visits[0]?.customer_id ?? null;
  return (
    <Sheet open={stop !== null} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{stop?.name ?? 'Job'}</SheetTitle>
          <SheetDescription>
            {customerId ? (
              <Link href={`/customers/${customerId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                Customer page
              </Link>
            ) : (
              'This visit has no customer page.'
            )}
          </SheetDescription>
        </SheetHeader>
        {stop && stop.visits[0] ? (
          <ul className="px-4 pb-4">
            <VisitStopCard visit={stop.visits[0]} visits={stop.visits} brand={props.brand} />
          </ul>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
