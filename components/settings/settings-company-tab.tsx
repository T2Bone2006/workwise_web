'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { updateCompanySettings } from '@/lib/actions/settings';
import { INDUSTRIES, type SettingsPageData } from '@/lib/data/settings-types';
import type { TenantSkillRow } from '@/lib/actions/skills';
import { SettingsSkillsSection } from './settings-skills-section';
import { cn } from '@/lib/utils';

interface SettingsCompanyTabProps {
  data: SettingsPageData;
  initialTenantSkills: TenantSkillRow[];
  /** Pro uses skills to match workers to jobs. Lite and Rounds do not. */
  showSkills: boolean;
  onSaved: () => void;
}

export function SettingsCompanyTab({
  data,
  initialTenantSkills,
  showSkills,
  onSaved,
}: SettingsCompanyTabProps) {
  const [saving, setSaving] = useState(false);
  const tenant = data.tenant;
  const company = tenant?.settings?.company ?? {};

  const [name, setName] = useState(tenant?.name ?? '');
  const storedIndustry = tenant?.industry ?? company?.industry ?? '';
  const [industry, setIndustry] = useState(storedIndustry === 'Rounds' ? '' : storedIndustry);
  const [phone, setPhone] = useState(company?.phone ?? '');
  // Signup stores the address on the login, not in company settings, so the
  // box is blank until they save. Show the login email until they set one.
  const [email, setEmail] = useState(company?.email?.trim() || data.user?.email || '');
  const [address, setAddress] = useState(company?.address ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    const formData = new FormData();
    formData.set('name', name);
    formData.set('industry', industry);
    formData.set('phone', phone);
    formData.set('email', email);
    formData.set('address', address);
    const result = await updateCompanySettings(formData);
    setSaving(false);
    if (result.success) {
      toast.success('Company settings saved');
      onSaved();
    } else {
      toast.error(result.error ?? 'Failed to save');
    }
  }

  if (!tenant) {
    return (
      <Card className="glass-card rounded-xl border">
        <CardContent className="py-8 text-center text-muted-foreground">
          No tenant found. You need to be linked to a company to edit settings.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Read-only account overview */}
      <Card className="rounded-xl border border-border/50 bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">Account overview</CardTitle>
          <CardDescription>Read-only information about your account.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Tenant ID</span>
            <p className="font-mono text-foreground break-all">{tenant.id}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Subscription status</span>
            <p className="text-foreground capitalize">{tenant.subscription_status ?? '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Account created</span>
            <p className="text-foreground">
              {tenant.created_at
                ? new Date(tenant.created_at).toLocaleDateString('en-GB', {
                    timeZone: 'Europe/London',
                  })
                : '—'}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Total jobs</span>
            <p className="text-foreground">{data.totalJobsCount}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Total workers</span>
            <p className="text-foreground">{data.totalWorkersCount}</p>
          </div>
        </CardContent>
      </Card>

    <form onSubmit={handleSubmit}>
      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <CardTitle>Company information</CardTitle>
          <CardDescription>
            Your business details used on quotes and communications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Ltd"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <SearchableSelect
              id="industry"
              value={industry || undefined}
              onValueChange={setIndustry}
              placeholder="Select industry"
              searchPlaceholder="Search industries"
              emptyText="No industry matches."
              options={[
                ...(industry && !(INDUSTRIES as readonly string[]).includes(industry)
                  ? [{ value: industry, label: industry }]
                  : []),
                ...INDUSTRIES.map((name) => ({ value: name, label: name })),
              ]}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company-phone">Phone</Label>
              <Input
                id="company-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+44 20 7123 4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-email">Email</Label>
              <Input
                id="company-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="hello@company.com"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-address">Address</Label>
            <Input
              id="company-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 High Street, London"
            />
          </div>
        </CardContent>
        <CardContent className="pt-0">
          <Button type="submit" variant="gradient" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save company settings
          </Button>
        </CardContent>
      </Card>
    </form>

      {showSkills ? (
        <SettingsSkillsSection
          tenantId={tenant.id}
          initialSkills={initialTenantSkills}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
