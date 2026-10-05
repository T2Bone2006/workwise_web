'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2,
  Calculator,
  User,
  AlertTriangle,
  CreditCard,
  MessageSquare,
  Route,
  Wallet,
} from 'lucide-react';
import { useLook } from '@/components/look/use-look';
import { cn } from '@/lib/utils';
import type { SettingsPageData } from '@/lib/data/settings-types';
import type { TenantSkillRow } from '@/lib/actions/skills';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import type { PaymentSettings } from '@/lib/data/payments/settings';
import type { RoundsSettings } from '@/lib/rounds/settings';
import { SettingsCompanyTab } from './settings-company-tab';
import { SettingsPaymentsTab } from './settings-payments-tab';
import { SettingsAccountantTab } from './settings-accountant-tab';
import type { AccessSummary } from '@/lib/accountant/access';
import { SettingsUserTab } from './settings-user-tab';
import { SettingsDangerTab } from './settings-danger-tab';
import { SettingsRoundsTab } from './settings-rounds-tab';
import {
  SettingsMessagesSection,
  useMessagingSectionData,
} from './settings-messages-section';

interface SettingsViewProps {
  initialData: SettingsPageData;
  initialTenantSkills: TenantSkillRow[];
  /** Self-serve plan page, or the managed billing tab. */
  billingPanel: ReactNode;
  /** Self-serve businesses see "Plan & billing". Managed businesses keep "Billing". */
  selfServeBilling?: boolean;
  /** Any Rounds subscription, including one that has ended. Offers the data download before close. */
  hasRounds?: boolean;
  rounds?: { settings: RoundsSettings } | null;
  payments?: { settings: PaymentSettings; cardPanel: CardPanelData } | null;
  /** Rounds account owner only: their accountants (null inside = couldn't load). */
  accountant?: { accountants: AccessSummary[] | null; currentTaxYear: number } | null;
  companyLogoUrl?: string | null;
  showSkills: boolean;
  defaultTab?: string;
  /** `?gc=` return code from the GoCardless connect flow. */
  gc?: string | null;
  /** GoCardless's verification page (null when not configured). */
  verifyUrl?: string | null;
}

/** The new look's shorter tab names. Classic (Pro) keeps its own. */
const NEW_LABELS: Record<string, string> = {
  company: 'Company',
  rounds: 'Rounds',
  messages: 'Messages',
  payments: 'Payments',
  accountant: 'Accountant',
  billing: 'Plan & billing',
  profile: 'Your profile',
  danger: 'Danger zone',
};

const baseTabs = [
  { value: 'company', label: 'Company Settings', icon: Building2 },
  { value: 'billing', label: 'Billing', icon: CreditCard },
  { value: 'profile', label: 'User Profile', icon: User },
  { value: 'danger', label: 'Danger Zone', icon: AlertTriangle },
] as const;

export function SettingsView({
  initialData,
  initialTenantSkills,
  billingPanel,
  selfServeBilling = false,
  hasRounds = false,
  rounds = null,
  payments = null,
  accountant = null,
  companyLogoUrl = null,
  showSkills,
  defaultTab,
  gc,
  verifyUrl,
}: SettingsViewProps) {
  const router = useRouter();
  const fresh = useLook() === 'new';
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
        ...(accountant
          ? [{ value: 'accountant', label: 'Accountant & data', icon: Calculator }]
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
          fresh
            ? 'flex-nowrap overflow-x-auto group-data-[orientation=vertical]/tabs:flex-row md:group-data-[orientation=vertical]/tabs:flex-col rounded-2xl border border-border bg-card p-2 shadow-(--look-card-shadow) [scrollbar-width:none] md:gap-0.5 md:overflow-visible [&::-webkit-scrollbar]:hidden'
            : 'bg-muted/80 dark:bg-muted/40 border border-border/50'
        )}
      >
        {tabs.map(({ value, label, icon: Icon }) => {
          const text = fresh ? (NEW_LABELS[value] ?? label) : value === 'billing' && selfServeBilling ? 'Plan & billing' : label;
          return (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                'h-auto flex-1 gap-2 whitespace-normal rounded-lg px-3 py-2.5 text-left transition-all duration-200 md:w-full md:flex-none',
                fresh && 'flex-none whitespace-nowrap group-data-[orientation=vertical]/tabs:w-auto md:group-data-[orientation=vertical]/tabs:w-full md:whitespace-normal',
                fresh
                  ? [
                      'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                      'data-[state=active]:bg-(--tone-rounds-soft) data-[state=active]:text-(--tone-rounds-text) data-[state=active]:shadow-none',
                      value === 'danger' &&
                        'text-(--tone-rose-text) hover:text-(--tone-rose-text) data-[state=active]:bg-(--tone-rose-soft) data-[state=active]:text-(--tone-rose-text)',
                    ]
                  : [
                      'data-[state=active]:bg-background data-[state=active]:shadow-sm',
                      'data-[state=active]:ring-1 data-[state=active]:ring-brand-primary/30',
                      'dark:data-[state=active]:bg-card dark:data-[state=active]:border dark:data-[state=active]:border-border',
                      value === 'danger' && 'data-[state=active]:ring-destructive/40 text-destructive hover:text-destructive',
                    ]
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className={fresh ? undefined : 'hidden sm:inline'}>{text}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      <div className={cn('min-w-0 flex-1', fresh && 'md:max-w-[880px]')}>
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
              verifyUrl={verifyUrl}
              gc={gc}
              onSaved={onSaved}
              onDirtyChange={setFormDirty}
            />
          </TabsContent>
        )}
        {accountant && (
          <TabsContent value="accountant" className="mt-0 outline-none">
            <SettingsAccountantTab accountants={accountant.accountants} currentTaxYear={accountant.currentTaxYear} />
          </TabsContent>
        )}
        <TabsContent value="billing" className="mt-0 outline-none">
          {billingPanel}
        </TabsContent>
        <TabsContent value="profile" className="mt-0 outline-none">
          <SettingsUserTab data={initialData} onSaved={onSaved} onDirtyChange={setFormDirty} />
        </TabsContent>
        <TabsContent value="danger" className="mt-0 outline-none">
          <SettingsDangerTab data={initialData} selfServe={selfServeBilling} hasRounds={hasRounds} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
