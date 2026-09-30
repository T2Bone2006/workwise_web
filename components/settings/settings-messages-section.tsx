'use client';

import { createContext, useContext, useEffect, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UnsavedSaveBar } from '@/components/settings/unsaved-save-bar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { updateMessagingSettings } from '@/lib/actions/messaging';
import { countSegments } from '@/lib/messaging/gsm';
import type { ChannelOrder } from '@/lib/messaging/channel';
import type { MessagingSettings } from '@/lib/messaging/settings';
import { reminderSms } from '@/lib/messaging/templates';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { cn } from '@/lib/utils';

export type MessagingSectionData = {
  settings: MessagingSettings;
  companyPhone: string | null;
  businessName: string;
};

const MessagingSectionContext = createContext<MessagingSectionData | null>(null);

export function MessagingSectionProvider(props: {
  value: MessagingSectionData;
  children: ReactNode;
}): JSX.Element {
  return (
    <MessagingSectionContext.Provider value={props.value}>
      {props.children}
    </MessagingSectionContext.Provider>
  );
}

export function useMessagingSectionData(): MessagingSectionData | null {
  return useContext(MessagingSectionContext);
}

function phoneFieldValue(e164: string | null): string {
  if (!e164) return '';
  return formatUkPhoneDisplay(e164) || e164;
}

function previewContactPhone(typed: string, companyPhone: string | null, saved: string | null): string | null {
  const trimmed = typed.trim();
  if (trimmed === '') return normalizeUkPhoneE164(companyPhone) ?? saved;
  return normalizeUkPhoneE164(trimmed) ?? normalizeUkPhoneE164(companyPhone) ?? saved;
}

export function SettingsMessagesSection(props: {
  settings: MessagingSettings;
  companyPhone: string | null;
  businessName: string;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const { settings, companyPhone, businessName, onDirtyChange } = props;
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [chaseError, setChaseError] = useState<string | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(settings.reminders_enabled);
  const [reminderDays, setReminderDays] = useState(settings.reminder_days_before);
  const [moneyChannel, setMoneyChannel] = useState<ChannelOrder>(settings.money_channel);
  const [changeChannel, setChangeChannel] = useState<ChannelOrder>(settings.change_channel);
  const [chasersEnabled, setChasersEnabled] = useState(settings.chasers_enabled);
  const [thanksEnabled, setThanksEnabled] = useState(settings.payment_thanks_enabled);
  const [chaseFirst, setChaseFirst] = useState(settings.chase_first_days);
  const [chaseSecond, setChaseSecond] = useState(settings.chase_second_days);
  const [contactPhone, setContactPhone] = useState(phoneFieldValue(settings.contact_phone));
  const [baseline, setBaseline] = useState({
    remindersEnabled: settings.reminders_enabled,
    reminderDays: settings.reminder_days_before,
    moneyChannel: settings.money_channel,
    changeChannel: settings.change_channel,
    chasersEnabled: settings.chasers_enabled,
    thanksEnabled: settings.payment_thanks_enabled,
    chaseFirst: settings.chase_first_days,
    chaseSecond: settings.chase_second_days,
    contactPhone: phoneFieldValue(settings.contact_phone),
  });

  const dirty =
    remindersEnabled !== baseline.remindersEnabled ||
    reminderDays !== baseline.reminderDays ||
    moneyChannel !== baseline.moneyChannel ||
    changeChannel !== baseline.changeChannel ||
    chasersEnabled !== baseline.chasersEnabled ||
    thanksEnabled !== baseline.thanksEnabled ||
    chaseFirst !== baseline.chaseFirst ||
    chaseSecond !== baseline.chaseSecond ||
    contactPhone !== baseline.contactPhone;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const previewPhone = previewContactPhone(contactPhone, companyPhone, settings.contact_phone);
  const preview = reminderSms({
    brand: { businessName, contactPhone: previewPhone },
    address: '12 Elm Rd',
    day: 'Thu 2 Oct',
    services: ['window clean'],
    time: null,
    firstText: true,
  });
  const textCount = Math.max(1, countSegments(preview).segments);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = contactPhone.trim();
    if (trimmed !== '' && normalizeUkPhoneE164(trimmed) == null) {
      setPhoneError('Enter a UK phone number');
      return;
    }
    if (!Number.isInteger(chaseFirst) || chaseFirst < 3 || chaseFirst > 30) {
      setChaseError('First reminder is between 3 and 30 days');
      return;
    }
    if (
      !Number.isInteger(chaseSecond) ||
      chaseSecond <= chaseFirst ||
      chaseSecond > 60
    ) {
      setChaseError('Second reminder must be after the first');
      return;
    }
    setPhoneError(null);
    setChaseError(null);
    setSaving(true);
    const result = await updateMessagingSettings({
      reminders_enabled: remindersEnabled,
      reminder_days_before: reminderDays,
      money_channel: moneyChannel,
      change_channel: changeChannel,
      chasers_enabled: chasersEnabled,
      payment_thanks_enabled: thanksEnabled,
      chase_first_days: chaseFirst,
      chase_second_days: chaseSecond,
      contact_phone: trimmed === '' ? null : trimmed,
    });
    setSaving(false);
    if (!result.success) {
      if (result.error === 'Enter a UK phone number') {
        setPhoneError(result.error);
        return;
      }
      if (result.error === 'Second reminder must be after the first') {
        setChaseError(result.error);
        return;
      }
      toast.error(result.error);
      return;
    }
    const shownPhone = trimmed === '' ? '' : phoneFieldValue(normalizeUkPhoneE164(trimmed));
    setContactPhone(shownPhone);
    setBaseline({
      remindersEnabled,
      reminderDays,
      moneyChannel,
      changeChannel,
      chasersEnabled,
      thanksEnabled,
      chaseFirst,
      chaseSecond,
      contactPhone: shownPhone,
    });
    setSavedAt(Date.now());
    toast.success('Customer messages saved');
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-6 xl:grid-cols-2">
      <h2 className="text-lg font-semibold xl:col-span-2">Customer messages</h2>
      <Card className="glass-card rounded-xl border border-border/60 bg-card/80 xl:col-span-2">
        <CardHeader>
          <CardTitle>Visit reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="send-reminders">Send reminders</Label>
              <p className="text-xs text-muted-foreground">
                Default for each customer. They can choose Yes, No, or this. Each reminder uses a text.
              </p>
            </div>
            <Switch
              id="send-reminders"
              checked={remindersEnabled}
              onCheckedChange={setRemindersEnabled}
            />
          </div>
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="message-reminder-days">Days before</Label>
            <Select
              value={String(reminderDays)}
              onValueChange={(value) => setReminderDays(Number(value))}
            >
              <SelectTrigger id="message-reminder-days" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <SelectItem key={day} value={String(day)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <p className="whitespace-pre-wrap text-sm">{preview}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Sample: 12 Elm Rd, window clean · {textCount} {textCount === 1 ? 'text' : 'texts'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Money messages</CardTitle>
          <CardDescription>Visit done, payment reminders, thanks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChannelRadio
            name="money-channel"
            value={moneyChannel}
            onChange={setMoneyChannel}
            options={[
              { value: 'email_first', label: 'Email first (free)' },
              { value: 'text_first', label: 'Text first (uses texts)' },
            ]}
          />
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Changes to visits</CardTitle>
          <CardDescription>Can&apos;t make it, moved, confirmations</CardDescription>
        </CardHeader>
        <CardContent>
          <ChannelRadio
            name="change-channel"
            value={changeChannel}
            onChange={setChangeChannel}
            options={[
              { value: 'text_first', label: 'Text first' },
              { value: 'email_first', label: 'Email first' },
            ]}
          />
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80 xl:col-span-2">
        <CardHeader>
          <CardTitle>Payment reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="chasers-enabled">Send payment reminders</Label>
              <p className="text-xs text-muted-foreground">
                Default for each customer. They can choose Yes, No, or this.
              </p>
            </div>
            <Switch
              id="chasers-enabled"
              checked={chasersEnabled}
              onCheckedChange={setChasersEnabled}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="thanks-enabled">Send payment thank-yous</Label>
              <p className="text-xs text-muted-foreground">
                Default for each customer. &ldquo;Thanks for your £X payment&rdquo; after they pay by
                card, bank or you mark it paid. Visit-done messages still go.
              </p>
            </div>
            <Switch
              id="thanks-enabled"
              checked={thanksEnabled}
              onCheckedChange={setThanksEnabled}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chase-first">First after</Label>
              <Input
                id="chase-first"
                type="number"
                min={3}
                max={30}
                value={chaseFirst}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isInteger(next)) return;
                  setChaseFirst(next);
                  setChaseError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">Days, 3–30. Default 7.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chase-second">Second after</Label>
              <Input
                id="chase-second"
                type="number"
                min={4}
                max={60}
                value={chaseSecond}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isInteger(next)) return;
                  setChaseSecond(next);
                  setChaseError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">Days. Default 21.</p>
              {chaseError ? <p className="text-sm text-destructive">{chaseError}</p> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80 xl:col-span-2">
        <CardHeader>
          <CardTitle>Number in your texts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="contact-phone">Call this number</Label>
          <Input
            id="contact-phone"
            value={contactPhone}
            placeholder={companyPhone ?? ''}
            maxLength={20}
            onChange={(event) => {
              setContactPhone(event.target.value);
              setPhoneError(null);
            }}
            aria-invalid={phoneError != null}
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            Customers are told to call this number. Leave blank to use your company phone.
          </p>
          {phoneError ? <p className="text-sm text-destructive">{phoneError}</p> : null}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground xl:col-span-2">
        Texts come from WorkWise&apos;s number and start with your business name. 100 texts a
        month are included; buy more on the Messages page.
      </p>

      <div className="xl:col-span-2">
        <UnsavedSaveBar dirty={dirty} saving={saving} savedAt={savedAt} />
      </div>

    </form>
  );
}

function ChannelRadio(props: {
  name: string;
  value: ChannelOrder;
  onChange: (value: ChannelOrder) => void;
  options: { value: ChannelOrder; label: string }[];
}): JSX.Element {
  return (
    <div className="space-y-2">
      {props.options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all',
            props.value === option.value
              ? 'border-emerald-400/50 bg-emerald-500/10'
              : 'border-border/80 hover:border-border hover:bg-muted/30',
          )}
        >
          <input
            type="radio"
            name={props.name}
            value={option.value}
            checked={props.value === option.value}
            onChange={() => props.onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
