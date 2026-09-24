'use client';

import { CalendarDays, PoundSterling, Repeat, Wallet } from 'lucide-react';
import { SummaryStrip } from '@/components/jobs/status-summary-strip';

export function CustomerStatStrip({
  nextVisit,
  services,
  price,
  payment,
  nextOverdue,
}: {
  nextVisit: string;
  services: string;
  price: string;
  payment: string;
  nextOverdue: boolean;
}) {
  return (
    <SummaryStrip
      label="This customer"
      hint=""
      activeKey={null}
      onSelect={() => {}}
      gridClassName="grid-cols-2 gap-3 lg:grid-cols-4"
      items={[
        {
          key: 'next',
          title: 'Next visit',
          icon: CalendarDays,
          glow: nextOverdue ? 'rgb(225 29 72)' : 'rgb(14 165 233)',
          count: nextVisit,
        },
        {
          key: 'services',
          title: 'Services',
          icon: Repeat,
          glow: 'rgb(6 182 212)',
          count: services,
        },
        {
          key: 'price',
          title: 'Each visit',
          icon: PoundSterling,
          glow: 'rgb(245 158 11)',
          count: price,
        },
        {
          key: 'payment',
          title: 'Payment',
          icon: Wallet,
          glow: 'rgb(16 185 129)',
          count: payment,
        },
      ]}
    />
  );
}
