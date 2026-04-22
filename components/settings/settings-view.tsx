'use client';

import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2,
  User,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SettingsPageData } from '@/lib/data/settings-types';
import { SettingsCompanyTab } from './settings-company-tab';
import { SettingsUserTab } from './settings-user-tab';
import { SettingsDangerTab } from './settings-danger-tab';

interface SettingsViewProps {
  initialData: SettingsPageData;
}

const tabs = [
  { value: 'company', label: 'Company Settings', icon: Building2 },
  { value: 'profile', label: 'User Profile', icon: User },
  { value: 'danger', label: 'Danger Zone', icon: AlertTriangle },
] as const;

export function SettingsView({ initialData }: SettingsViewProps) {
  const router = useRouter();
  const onSaved = () => router.refresh();

  return (
    <Tabs
      defaultValue="company"
      orientation="vertical"
      className={cn(
        'flex flex-col gap-6 md:flex-row md:gap-8',
        'group/tabs'
      )}
    >
      <TabsList
        variant="default"
        className={cn(
          'w-full flex flex-row flex-wrap gap-1 rounded-xl p-1.5 h-auto',
          'md:w-56 md:flex-col md:flex-nowrap md:shrink-0',
          'bg-muted/80 dark:bg-muted/40',
          'border border-border/50'
        )}
      >
        {tabs.map(({ value, label, icon: Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className={cn(
              'flex-1 md:flex-none gap-2 rounded-lg px-3 py-2.5 transition-all duration-200',
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

      <div className="flex-1 min-w-0">
        <TabsContent value="company" className="mt-0 outline-none">
          <SettingsCompanyTab data={initialData} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="profile" className="mt-0 outline-none">
          <SettingsUserTab data={initialData} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="danger" className="mt-0 outline-none">
          <SettingsDangerTab data={initialData} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
