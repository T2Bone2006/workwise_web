'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createReferralPartner, type PartnerActionResult } from '@/lib/actions/partner-referrals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: PartnerActionResult | null = null;

/** Name, code and where to send the money. Only the platform admin sees this. */
export function AddPartnerForm() {
  const [state, action, pending] = useActionState(createReferralPartner, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="partner-name">Name</Label>
        <Input id="partner-name" name="name" required maxLength={80} placeholder="Sarah Jones" autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="partner-code">Code</Label>
        <Input
          id="partner-code"
          name="code"
          required
          maxLength={16}
          placeholder="SARAH"
          autoCapitalize="characters"
          autoComplete="off"
          className="font-mono uppercase"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="partner-payout">Where you pay them</Label>
        <Input
          id="partner-payout"
          name="payoutNote"
          maxLength={200}
          placeholder="Monzo, sort code and account, or 'ask Sarah'"
          autoComplete="off"
        />
      </div>
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add partner'}
        </Button>
      </div>
    </form>
  );
}
