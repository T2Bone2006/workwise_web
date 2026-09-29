'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2,
  User,
  AlertTriangle,
  CreditCard,
  MessageSquare,
  Route,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SettingsPageData } from '@/lib/data/settings-types';
import type { TenantSkillRow } from '@/lib/actions/skills';
import type { BillingSummary } from '@/lib/data/billing';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import type { PaymentSettings } from '@/lib/data/payments/settings';
import type { RoundsSettings } from '@/lib/rounds/settings';
import { SettingsCompanyTab } from './settings-company-tab';
import { SettingsPaymentsTab } from './settings-payments-tab';
import { SettingsUserTab } from './settings-user-tab';
import { SettingsDangerTab } from './settings-danger-tab';
import { SettingsBillingTab } from './settings-billing-tab';
import { SettingsRoundsTab } from './settings-rounds-tab';
import {
  SettingsMessagesSection,
  useMessagingSectionData,
} from './settings-messages-section';

interface SettingsViewProps {
  initialData: SettingsPageData;
  initialTenantSkills: TenantSkillRow[];
  billing: BillingSummary;
  rounds?: { settings: RoundsSettings } | null;
  payments?: { settings: PaymentSettings; cardPanel: CardPanelData } | null;
  companyLogoUrl?: string | null;
  showSkills: boolean;
  defaultTab?: string;
}

const baseTabs = [
  { value: 'company', label: 'Company Settings', icon: Building2 },
  { value: 'billing', label: 'Billing', icon: CreditCard },
  { value: 'profile', label: 'User Profile', icon: User },
  { value: 'danger', label: 'Danger Zone', icon: AlertTriangle },
] as const;

export function SettingsView({
  initialData,
  initialTenantSkills,
  billing,
  rounds = null,
  payments = null,
  companyLogoUrl = null,
  showSkills,
  defaultTab,
}: SettingsViewProps) {
  const router = useRouter();
  const onSaved = () => router.refresh();
  const messaging = useMessagingSectionData();
  const tabs = rounds
    ? [
        baseTabs[0],
        { value: 'rounds', label: 'Rounds', icon: Route },
        ...(messaging
          ? [{ value: 'messages', label: 'Customer messages', icon: MessageSquare }]
          : []),
        ...(payments
          ? [{ value: 'payments', label: 'Payments', icon: Wallet }]
          : []),
        ...baseTabs.slice(1),
      ]
    : [...baseTabs];
  const tabValues = new Set(tabs.map((item) => item.value));
  const initialTab = defaultTab && tabValues.has(defaultTab as (typeof tabs)[number]['value'])
    ? defaultTab
    : 'company';
  const [tab, setTab] = useState(initialTab);
  const [formDirty, setFormDirty] = useState(false);

  function onTabChange(next: string) {
    if (formDirty && next !== tab) {
      if (!window.confirm('Not saved. Leave without saving?')) return;
    }
    setFormDirty(false);
    setTab(next);
  }

  return (
    <Tabs
      value={tab}
      onValueChange={onTabChange}
      orientation="vertical"
      className={cn(
        'flex flex-col gap-6 md:flex-row md:items-start md:gap-8',
        'group/tabs'
      )}
    >
      <TabsList
        variant="default"
        className={cn(
          'h-auto w-full shrink-0 flex-row flex-wrap gap-1 rounded-xl p-1.5',
          'md:sticky md:top-0 md:h-fit md:w-56 md:flex-col md:flex-nowrap md:self-start',
          'bg-muted/80 dark:bg-muted/40',
          'border border-border/50'
        )}
      >
        {tabs.map(({ value, label, icon: Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className={cn(
              'h-auto flex-1 gap-2 whitespace-normal rounded-lg px-3 py-2.5 text-left transition-all duration-200 md:w-full md:flex-none',
              'data-[state=active]:bg-background data-[state=active]:shadow-sm',
              'data-[state=active]:ring-1 data-[state=active]:ring-brand-primary/30',
              'dark:data-[state=active]:bg-card dark:data-[state=active]:border dark:data-[state=active]:border-border',
              value === 'danger' && 'data-[state=active]:ring-destructive/40 text-destructive hover:text-destructive'
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="min-w-0 flex-1">
        <TabsContent value="company" className="mt-0 outline-none">
          <SettingsCompanyTab
            data={initialData}
            initialTenantSkills={initialTenantSkills}
            showSkills={showSkills}
            companyLogoUrl={companyLogoUrl}
            showLogo={Boolean(payments)}
            onSaved={onSaved}
            onDirtyChange={setFormDirty}
          />
        </TabsContent>
        {rounds && (
          <TabsContent value="rounds" className="mt-0 outline-none">
            <SettingsRoundsTab
              settings={rounds.settings}
              onSaved={onSaved}
              onDirtyChange={setFormDirty}
            />
          </TabsContent>
        )}
        {messaging && (
          <TabsContent value="messages" className="mt-0 outline-none">
            <SettingsMessagesSection
              settings={messaging.settings}
              companyPhone={messaging.companyPhone}
              businessName={messaging.businessName}
              onDirtyChange={setFormDirty}
            />
          </TabsContent>
        )}
        {payments && (
          <TabsContent value="payments" className="mt-0 outline-none">
            <SettingsPaymentsTab
              settings={payments.settings}
              cardPanel={payments.cardPanel}
              onSaved={onSaved}
              onDirtyChange={setFormDirty}
            />
          </TabsContent>
        )}
        <TabsContent value="billing" className="mt-0 outline-none">
          <SettingsBillingTab billing={billing} />
        </TabsContent>
        <TabsContent value="profile" className="mt-0 outline-none">
          <SettingsUserTab data={initialData} onSaved={onSaved} onDirtyChange={setFormDirty} />
        </TabsContent>
        <TabsContent value="danger" className="mt-0 outline-none">
          <SettingsDangerTab data={initialData} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
