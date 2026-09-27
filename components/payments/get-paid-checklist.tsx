'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { Check, CreditCard, ImageIcon, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">Get paid</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.text} className="flex items-start justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-start gap-3">
              <span
                className={
                  row.done
                    ? 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600'
                    : 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
                }
              >
                {row.done ? <Check className="size-4" /> : <row.icon className="size-4" />}
              </span>
              <span className="pt-1">{row.text}</span>
            </span>
            {row.done ? null : row.onClick ? (
              <button
                type="button"
                className="shrink-0 font-medium text-primary hover:underline disabled:opacity-50"
                disabled={starting}
                onClick={row.onClick}
              >
                {row.action}
              </button>
            ) : (
              <Link href={row.href ?? settingsHref} className="shrink-0 font-medium text-primary hover:underline">
                {row.action}
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
