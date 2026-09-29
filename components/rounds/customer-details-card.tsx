'use client';

import { useState, type JSX, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  InlineAddress,
  InlineEditGroup,
  InlineSelect,
  InlineSwitch,
  InlineText,
} from '@/components/rounds/inline-field';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { updateCustomerField } from '@/lib/actions/rounds/customer-field';
import {
  CONTACT_CHOICE_LABELS,
  type ContactChoice,
} from '@/lib/messaging/channel';
import { isUkMobileE164 } from '@/lib/messaging/phone';
import type { RoundsCustomerDetail } from '@/lib/data/rounds/customers';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';

const CONTACT_BY_OPTIONS: ContactChoice[] = ['default', 'sms', 'email', 'none'];

const PAYMENT_OPTIONS = [
  { value: 'on_the_day' as const, label: 'Pay on the day' },
  { value: 'invoice' as const, label: 'Send an invoice after each visit' },
];

function DetailSection(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-3 border-t border-border/60 pt-4 first:border-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {props.title}
      </h3>
      <div className="grid items-start gap-x-8 gap-y-4 sm:grid-cols-2">{props.children}</div>
    </section>
  );
}

function savedText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return fallback;
}

export function CustomerDetailsCard(props: {
  customer: RoundsCustomerDetail;
  house: { address: string | null; postcode: string | null };
  messaging: {
    contactChoice: ContactChoice;
    visitReminders: boolean;
    paymentChasers: boolean;
    paymentThanks: boolean;
    remindersEnabled: boolean;
    chasersEnabled: boolean;
    thanksEnabled: boolean;
    reminderDaysBefore: number;
  };
}): JSX.Element {
  const { customer, messaging } = props;
  const router = useRouter();
  const initialPhone = formatUkPhoneDisplay(customer.phone_e164) || customer.phone || '';
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(props.house.address);
  const [postcode, setPostcode] = useState(props.house.postcode);
  const [contactChoice, setContactChoice] = useState(messaging.contactChoice);
  const hasMobile = isUkMobileE164(normalizeUkPhoneE164(phone));
  const remindersBlocked = !messaging.remindersEnabled || !hasMobile;
  const dayWord = messaging.reminderDaysBefore === 1 ? 'day' : 'days';
  const reminderBlockReason = [
    messaging.remindersEnabled ? null : 'Reminders are off for your business',
    hasMobile ? null : 'Needs a mobile number',
  ]
    .filter((line): line is string => line != null)
    .join(' ');

  async function save(change: Parameters<typeof updateCustomerField>[1]) {
    const result = await updateCustomerField(customer.id, change);
    if (result.success) router.refresh();
    return result;
  }

  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">Details</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <InlineEditGroup>
          <DetailSection title="Personal">
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
            <div className="space-y-1">
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
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  No mobile — texts can&apos;t be sent
                </p>
              )}
            </div>
            <InlineText
              label="Email"
              value={customer.email}
              inputMode="email"
              emptyText="Add email"
              placeholder="name@example.com"
              onSave={(value) => save({ field: 'email', value })}
            />
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
            <div className="sm:col-span-2">
              <InlineText
                label="Access notes"
                value={customer.access_notes}
                multiline
                emptyText="Add access notes"
                placeholder="Gate code, dog, park on the left…"
                onSave={(value) => save({ field: 'access_notes', value })}
              />
            </div>
          </DetailSection>
          <DetailSection title="Notifications">
            <div className="sm:col-span-2">
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
            </div>
            <InlineSwitch
              label="Remind before each visit"
              checked={messaging.visitReminders}
              help={`Texts them ${messaging.reminderDaysBefore} ${dayWord} before (uses texts). Reply NO shows here.`}
              disabled={remindersBlocked}
              disabledReason={reminderBlockReason || undefined}
              onSave={(next) => save({ field: 'visit_reminders', value: next })}
            />
            <InlineSwitch
              label="Chase unpaid visits"
              checked={messaging.paymentChasers}
              help="Friendly reminders at 7 and 21 days."
              disabled={!messaging.chasersEnabled}
              disabledReason={
                messaging.chasersEnabled
                  ? undefined
                  : 'Payment reminders are off for your business'
              }
              onSave={(next) => save({ field: 'payment_chasers', value: next })}
            />
            <InlineSwitch
              label="Thank them for payments"
              checked={messaging.paymentThanks}
              help="“Thanks for your £X payment” after they pay."
              disabled={!messaging.thanksEnabled}
              disabledReason={
                messaging.thanksEnabled
                  ? undefined
                  : 'Payment thank-yous are off for your business'
              }
              onSave={(next) => save({ field: 'payment_thanks', value: next })}
            />
          </DetailSection>
          <DetailSection title="Payments">
            <InlineSelect
              label="Payment terms"
              value={customer.payment_terms}
              options={PAYMENT_OPTIONS}
              onSave={(value) => save({ field: 'payment_terms', value })}
            />
          </DetailSection>
          <DetailSection title="Notes">
            <div className="sm:col-span-2">
              <InlineText
                label="Notes"
                value={customer.notes}
                multiline
                hideLabel
                emptyText="Add notes"
                onSave={(value) => save({ field: 'notes', value })}
              />
            </div>
          </DetailSection>
        </InlineEditGroup>
      </CardContent>
    </Card>
  );
}
