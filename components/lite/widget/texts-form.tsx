'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveWidgetTextsAction } from '@/lib/actions/lite/widget';
import { fallbackText } from '@/lib/lite/text-templates';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MOBILE_RE = /^\+447\d{9}$/;

export function TextsForm({
  businessName,
  trade,
  signOffName,
  ownerMobileDisplay,
  followUpEnabled,
  textMeToo,
  notificationEmail,
}: {
  businessName: string;
  trade: string;
  signOffName: string;
  ownerMobileDisplay: string;
  followUpEnabled: boolean;
  textMeToo: boolean;
  notificationEmail: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(signOffName);
  const [mobile, setMobile] = useState(ownerMobileDisplay);
  const [followUps, setFollowUps] = useState(followUpEnabled);
  const [meToo, setMeToo] = useState(textMeToo);
  const [email, setEmail] = useState(notificationEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = normalizeUkPhoneE164(mobile);
  const display = e164 && MOBILE_RE.test(e164) ? formatUkPhoneDisplay(e164) : null;
  const preview = fallbackText('follow_up', {
    first_name: 'Sam',
    business_name: businessName,
    sign_off: name.trim() || 'Dave',
    trade,
    owner_mobile_display: display,
    job_summary: 'the job',
    quote_kind: null,
    allowed_amounts: [],
    booking_requested: false,
    price_changed: false,
    preferred_days: [],
  });

  async function save(next?: { followUps?: boolean; meToo?: boolean }) {
    const follow = next?.followUps ?? followUps;
    const me = next?.meToo ?? meToo;
    setPending(true);
    setError(null);
    const result = await saveWidgetTextsAction({
      signOffName: name,
      ownerMobile: mobile,
      followUpEnabled: follow,
      textMeToo: me,
      notificationEmail: email,
    });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.note) toast(result.note);
    router.refresh();
  }

  return (
    <section id="texts" className="border border-border bg-card shadow-(--look-card-shadow) space-y-4 rounded-2xl p-4 sm:p-5">
      <h2 className="text-base font-semibold">Texts after someone leaves their details</h2>
      <p className="text-sm text-muted-foreground">
        The name and mobile go in the text to the customer. They are not shown on the website.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 px-3 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Text customers for me</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              A friendly text in your name a few minutes after someone leaves their details.
            </p>
          </div>
          <Button
            type="button"
            variant={followUps ? 'default' : 'outline'}
            className="shrink-0"
            aria-pressed={followUps}
            disabled={pending}
            onClick={() => {
              const next = !followUps;
              setFollowUps(next);
              void save({ followUps: next });
            }}
          >
            {followUps ? 'On' : 'Off'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 px-3 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Text me too</p>
            <p className="mt-0.5 text-sm text-muted-foreground">A text to your mobile for every new lead, as well as the email.</p>
          </div>
          <Button
            type="button"
            variant={meToo ? 'default' : 'outline'}
            className="shrink-0"
            aria-pressed={meToo}
            disabled={pending}
            onClick={() => {
              const next = !meToo;
              setMeToo(next);
              void save({ meToo: next });
            }}
          >
            {meToo ? 'On' : 'Off'}
          </Button>
        </div>
        <label className="block text-sm font-medium" htmlFor="widget-sign-off">
          Name to sign texts with
          <Input id="widget-sign-off" className="mt-1" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block text-sm font-medium" htmlFor="widget-mobile">
          Your mobile
          <Input
            id="widget-mobile"
            className="mt-1"
            inputMode="tel"
            autoComplete="tel"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
            placeholder="07700 900123"
          />
        </label>
        <p className="text-sm text-muted-foreground">Put in texts to customers so they can reach you. Never shown on the website.</p>
        <label className="block text-sm font-medium" htmlFor="widget-email">
          Send lead emails to
          <Input
            id="widget-email"
            className="mt-1"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <div className="space-y-2">
          <p className="text-sm font-medium">Customers will get something like:</p>
          <p className="rounded-2xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{preview}</p>
          <p className="text-xs text-muted-foreground">The real text is written for each customer from what they asked about.</p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </form>
    </section>
  );
}
