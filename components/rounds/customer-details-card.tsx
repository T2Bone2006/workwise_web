'use client';

import { useState, type JSX, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, KeyRound, Mail, MapPin, Phone, StickyNote, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  InlineAddress,
  InlineEditGroup,
  InlineSelect,
  InlineText,
} from '@/components/rounds/inline-field';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { updateCustomerField } from '@/lib/actions/rounds/customer-field';
import {
  CONTACT_CHOICE_LABELS,
  type ContactChoice,
} from '@/lib/messaging/channel';
import {
  messageChoiceOptions,
  type MessageChoice,
} from '@/lib/messaging/customer-flag';
import { isUkMobileE164 } from '@/lib/messaging/phone';
import { CustomerSectionTitle } from '@/components/rounds/customer-section-title';
import { cn } from '@/lib/utils';
import type { RoundsCustomerDetail } from '@/lib/data/rounds/customers';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';

const CONTACT_BY_OPTIONS: ContactChoice[] = ['default', 'sms', 'email', 'none'];

function FieldIcon(props: { icon: LucideIcon; children: ReactNode; className?: string }): JSX.Element {
  const Icon = props.icon;
  return (
    <div className={cn('flex gap-3', props.className)}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

function savedText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return fallback;
}

export type CustomerMessagingPrefs = {
  contactChoice: ContactChoice;
  visitReminders: MessageChoice;
  paymentChasers: MessageChoice;
  paymentThanks: MessageChoice;
  remindersEnabled: boolean;
  chasersEnabled: boolean;
  thanksEnabled: boolean;
  reminderDaysBefore: number;
  chaseFirstDays: number;
  chaseSecondDays: number;
};

function useCustomerSave(customerId: string) {
  const router = useRouter();
  return async function save(change: Parameters<typeof updateCustomerField>[1]) {
    const result = await updateCustomerField(customerId, change);
    if (result.success) router.refresh();
    return result;
  };
}

export function CustomerDetailsCard(props: {
  customer: RoundsCustomerDetail;
  house: { address: string | null; postcode: string | null };
}): JSX.Element {
  const { customer } = props;
  const save = useCustomerSave(customer.id);
  const initialPhone = formatUkPhoneDisplay(customer.phone_e164) || customer.phone || '';
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(props.house.address);
  const [postcode, setPostcode] = useState(props.house.postcode);
  const hasMobile = isUkMobileE164(normalizeUkPhoneE164(phone));
  const hasAccess = Boolean(customer.access_notes?.trim());

  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-2">
        <CustomerSectionTitle
          icon={UserRound}
          title="About them"
          tone="sky"
          hint="Tap a line to change it"
        />
      </CardHeader>
      <CardContent>
        <InlineEditGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldIcon icon={UserRound}>
              <InlineText
                label="Name"
                value={customer.name}
                onSave={async (value) => {
                  const result = await save({ field: 'name', value });
                  return result.success
                    ? { success: true, value: result.value }
                    : { success: false, error: result.error };
                }}
              />
            </FieldIcon>
            <FieldIcon icon={Phone}>
              <InlineText
                label="Phone"
                value={phone}
                inputMode="tel"
                emptyText="Add phone"
                placeholder="07700 900123"
                onSave={async (value) => {
                  const result = await save({ field: 'phone', value });
                  if (!result.success) return { success: false, error: result.error };
                  setPhone(savedText(result.value, value));
                  return { success: true, value: result.value };
                }}
              />
              {hasMobile ? null : (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  No mobile — texts can&apos;t be sent
                </p>
              )}
            </FieldIcon>
            <FieldIcon icon={Mail}>
              <InlineText
                label="Email"
                value={customer.email}
                inputMode="email"
                emptyText="Add email"
                placeholder="name@example.com"
                onSave={(value) => save({ field: 'email', value })}
              />
            </FieldIcon>
            <FieldIcon icon={MapPin}>
              <InlineAddress
                label="Address"
                address={address}
                postcode={postcode}
                onSave={async (value) => {
                  const result = await save({ field: 'house', value });
                  if (!result.success) return result;
                  if (
                    result.value &&
                    typeof result.value === 'object' &&
                    'address' in result.value &&
                    'postcode' in result.value
                  ) {
                    const saved = result.value as { address: string; postcode: string };
                    setAddress(saved.address);
                    setPostcode(saved.postcode);
                  }
                  return { success: true };
                }}
              />
            </FieldIcon>
          </div>

          <div
            className={cn(
              'mt-4 rounded-xl border px-3 py-3',
              hasAccess
                ? 'border-amber-400/40 bg-amber-500/10'
                : 'border-dashed border-border bg-muted/30',
            )}
          >
            <FieldIcon icon={KeyRound}>
              <InlineText
                label="Access notes"
                value={customer.access_notes}
                multiline
                emptyText="Gate code, dog, where to park…"
                placeholder="Gate code, dog, park on the left…"
                onSave={(value) => save({ field: 'access_notes', value })}
              />
            </FieldIcon>
          </div>

          <div className="mt-4">
            <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
              <CustomerSectionTitle
                as="h3"
                icon={StickyNote}
                title="Notes"
                tone="amber"
                hint="Only you see this"
              />
              <div className="mt-3">
                <InlineText
                  label="Notes"
                  value={customer.notes}
                  multiline
                  hideLabel
                  emptyText="Add a private note"
                  onSave={(value) => save({ field: 'notes', value })}
                />
              </div>
            </div>
          </div>
        </InlineEditGroup>
      </CardContent>
    </Card>
  );
}

export function CustomerSendCard(props: {
  customerId: string;
  phoneE164: string | null;
  messaging: CustomerMessagingPrefs;
}): JSX.Element {
  const { messaging } = props;
  const save = useCustomerSave(props.customerId);
  const [contactChoice, setContactChoice] = useState(messaging.contactChoice);
  const [visitReminders, setVisitReminders] = useState(messaging.visitReminders);
  const [paymentChasers, setPaymentChasers] = useState(messaging.paymentChasers);
  const [paymentThanks, setPaymentThanks] = useState(messaging.paymentThanks);
  const hasMobile = isUkMobileE164(props.phoneE164);
  const dayWord = messaging.reminderDaysBefore === 1 ? 'day' : 'days';

  return (
    <Card className="glass-card border-violet-400/30">
      <CardHeader className="pb-2">
        <CustomerSectionTitle
          icon={Bell}
          title="What we send"
          tone="violet"
          hint="Yes or No is just for this customer. Business default follows Settings."
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <InlineSelect
          label="Contact by"
          value={contactChoice}
          options={CONTACT_BY_OPTIONS.map((value) => ({
            value,
            label: CONTACT_CHOICE_LABELS[value],
          }))}
          onSave={async (next) => {
            const previous = contactChoice;
            setContactChoice(next);
            const result = await save({ field: 'contact_choice', value: next });
            if (!result.success) setContactChoice(previous);
            return result;
          }}
        />
        <InlineSelect
          label="Remind before each visit"
          value={visitReminders}
          options={messageChoiceOptions(messaging.remindersEnabled)}
          help={
            hasMobile
              ? `Texts them ${messaging.reminderDaysBefore} ${dayWord} before.`
              : 'Needs a mobile number before a reminder can go.'
          }
          onSave={async (next) => {
            const previous = visitReminders;
            setVisitReminders(next);
            const result = await save({ field: 'visit_reminders', value: next });
            if (!result.success) setVisitReminders(previous);
            return result;
          }}
        />
        <InlineSelect
          label="Chase unpaid visits"
          value={paymentChasers}
          options={messageChoiceOptions(messaging.chasersEnabled)}
          help={`At ${messaging.chaseFirstDays} and ${messaging.chaseSecondDays} days.`}
          onSave={async (next) => {
            const previous = paymentChasers;
            setPaymentChasers(next);
            const result = await save({ field: 'payment_chasers', value: next });
            if (!result.success) setPaymentChasers(previous);
            return result;
          }}
        />
        <InlineSelect
          label="Thank them for payments"
          value={paymentThanks}
          options={messageChoiceOptions(messaging.thanksEnabled)}
          help="A short thanks after they pay."
          onSave={async (next) => {
            const previous = paymentThanks;
            setPaymentThanks(next);
            const result = await save({ field: 'payment_thanks', value: next });
            if (!result.success) setPaymentThanks(previous);
            return result;
          }}
        />
      </CardContent>
    </Card>
  );
}
