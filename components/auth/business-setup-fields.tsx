'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authInputClassName, authLabelClassName } from '@/components/auth/auth-shell';

export type BusinessSetupValues = { businessName: string; trade: string; postcode: string };

/** The "About your business" block of the self-employed set-up. */
export function BusinessSetupFields({
  values,
  onChange,
  nameError,
  employerName,
  disabled,
}: {
  values: BusinessSetupValues;
  onChange: (next: BusinessSetupValues) => void;
  nameError: string | null;
  employerName: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-[#E6E5E0] p-4 dark:border-white/10" disabled={disabled}>
      <legend className="px-1.5 text-sm font-semibold text-[#0A1A2E] dark:text-[#EAF1FB]">About your business</legend>
      <p className="-mt-1 text-[13px] leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
        This is your own account. {employerName} can see the jobs they give you, not your business.
      </p>
      <div className="space-y-2">
        <Label htmlFor="business-name" className={authLabelClassName}>
          Business name
        </Label>
        <Input
          id="business-name"
          type="text"
          placeholder="e.g. Dave Smith Locksmiths"
          autoComplete="organization"
          maxLength={80}
          value={values.businessName}
          className={authInputClassName}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'business-name-error' : undefined}
          onChange={(e) => onChange({ ...values, businessName: e.target.value })}
        />
        {nameError ? (
          <p id="business-name-error" className="text-sm text-red-700 dark:text-red-300">
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="business-trade" className={authLabelClassName}>
            Trade <span className="font-normal text-[#928E88]">(optional)</span>
          </Label>
          <Input
            id="business-trade"
            type="text"
            placeholder="e.g. Locksmith"
            maxLength={60}
            value={values.trade}
            className={authInputClassName}
            onChange={(e) => onChange({ ...values, trade: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="business-postcode" className={authLabelClassName}>
            Postcode <span className="font-normal text-[#928E88]">(optional)</span>
          </Label>
          <Input
            id="business-postcode"
            type="text"
            autoComplete="postal-code"
            autoCapitalize="characters"
            maxLength={10}
            value={values.postcode}
            className={authInputClassName}
            onChange={(e) => onChange({ ...values, postcode: e.target.value })}
          />
        </div>
      </div>
    </fieldset>
  );
}
