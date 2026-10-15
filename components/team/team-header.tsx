'use client';

import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { PageTabs } from '@/components/look';

export type TeamTab = 'people' | 'pay' | 'cash';

const TABS: { key: TeamTab; label: string; href: string }[] = [
  { key: 'people', label: 'Team', href: '/team' },
  { key: 'pay', label: 'Pay & days', href: '/team/pay' },
  { key: 'cash', label: 'Cash to hand in', href: '/team/cash' },
];

/** The header and tab row shared by Team, Pay & days and Cash to hand in. */
export function TeamHeader({
  tab,
  subtitle,
  actions,
}: {
  tab: TeamTab;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <>
      <PageGradientHeader title="Team" subtitle={subtitle} actions={actions} />
      <PageTabs ariaLabel="Team" items={TABS} active={tab} />
    </>
  );
}
