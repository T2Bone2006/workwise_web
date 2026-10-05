'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { Check, CreditCard, ImageIcon, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { IconChip, LookCard } from '@/components/look';
import { Button } from '@/components/ui/button';
import { startCardPaymentsSetup } from '@/lib/actions/stripe-connect';
import type { GetPaidChecklist as Checklist } from '@/lib/data/payments/checklist';

export function GetPaidChecklist({
  checklist,
  settingsHref,
  logoHref,
}: {
  checklist: Checklist;
  settingsHref: string;
  logoHref: string;
}): JSX.Element | null {
  const [starting, setStarting] = useState(false);
  if (checklist.allDone) return null;

  const cardLabel =
    checklist.cardPayments === 'in_progress'
      ? 'Finish setting up'
      : checklist.cardPayments === 'restricted'
        ? 'Update details'
        : 'Set up';

  async function beginCardSetup() {
    setStarting(true);
    const result = await startCardPaymentsSetup();
    setStarting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    window.location.href = result.url;
  }

  const rows: {
    done: boolean;
    icon: typeof Landmark;
    text: string;
    action: string;
    href?: string;
    onClick?: () => void;
  }[] = [
    {
      done: checklist.bankDetails,
      icon: Landmark,
      text: 'Add your bank details — so customers can pay by transfer',
      action: 'Add',
      href: settingsHref,
    },
    {
      done: checklist.logo,
      icon: ImageIcon,
      text: 'Upload your logo — it goes on invoices and the pay page',
      action: 'Upload',
      href: logoHref,
    },
    {
      done: checklist.cardPayments === 'active',
      icon: CreditCard,
      text: 'Set up card payments — customers pay by card, money goes to your bank',
      action: cardLabel,
      onClick: () => void beginCardSetup(),
    },
  ];

  const doneCount = rows.filter((row) => row.done).length;

  return (
    <LookCard
      title="Get paid"
      icon={CreditCard}
      tone="rounds"
      aside={
        <span className="tabular-nums">
          {doneCount} of {rows.length} done
        </span>
      }
    >
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-(--tone-emerald-solid)"
          style={{ width: `${Math.round((doneCount / rows.length) * 100)}%` }}
        />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.text} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <span className="flex min-w-0 items-center gap-3">
              <IconChip icon={row.done ? Check : row.icon} tone={row.done ? 'emerald' : 'slate'} size="sm" />
              <span className={row.done ? 'text-muted-foreground line-through decoration-border' : ''}>{row.text}</span>
            </span>
            {row.done ? null : row.onClick ? (
              <Button type="button" size="sm" variant="outline" disabled={starting} onClick={row.onClick} className="shrink-0">
                {row.action}
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href={row.href ?? settingsHref}>{row.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </LookCard>
  );
}
