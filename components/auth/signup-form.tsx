'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Gift, Info, Loader2 } from 'lucide-react';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  AuthAlert,
  AuthShell,
  SITE_URL,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
  authLinkClassName,
} from '@/components/auth/auth-shell';
import { SIDE_COLOUR } from '@/components/auth/auth-side-panel';
import { PLAN_LOOK, PlanPicker, type FoundingView } from '@/components/auth/plan-picker';
import { SignupSummary } from '@/components/auth/signup-summary';
import { cn } from '@/lib/utils';
import { startSignup } from '@/lib/actions/signup';
import { signupSchema, type SignupInput } from '@/lib/validations/signup';
import { formatPence, PLANS, type BillingInterval, type PlanChoice, type PlanKey } from '@/lib/billing/plans';
import type { SignupOfferView } from '@/lib/billing/offers';

export type SignupOffers = Record<PlanKey, Record<BillingInterval, SignupOfferView>>;

type Step = 'plan' | 'details';

const initialState = {
  success: true as boolean,
  error: undefined as string | undefined,
  attemptedAt: undefined as number | undefined,
};

const NOTE_CLASS =
  'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed';

function ReferralBanner({ name, choice, offer }: { name: string; choice: PlanChoice; offer: SignupOfferView }) {
  let text: string | null = null;
  if (offer === 'free_month') text = `${name} gave you a free month.`;
  if (offer === 'free_then_half') {
    text = `${name} gave you a free month, then half price for your second.`;
  }
  if (offer === 'month_off_year') {
    text = `${name} gave you ${formatPence(PLANS[choice.plan].pence.month)} off your first year.`;
  }
  if (offer === 'founding') {
    text = `${name} sent you here. You're getting our founding offer instead: half price for 2 months.`;
  }
  if (!text) return null;
  return (
    <div
      className={cn(
        NOTE_CLASS,
        'border-emerald-200 bg-emerald-50 font-medium text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100'
      )}
    >
      <Gift className="mt-0.5 size-4 flex-shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

function CanceledNote() {
  return (
    <div
      className={cn(
        NOTE_CLASS,
        'border-[#D6E4F8] bg-[#F3F7FD] text-[#0F2347] dark:border-[#5B8FE8]/25 dark:bg-[#5B8FE8]/10 dark:text-[#D7E4F7]'
      )}
    >
      <Info className="mt-0.5 size-4 flex-shrink-0 text-[#0C66E4] dark:text-[#7FAAF0]" aria-hidden />
      <p>
        No payment was taken. Pick up where you left off: use the same email and password and you&apos;ll go
        straight back to payment.
      </p>
    </div>
  );
}

function TextField({
  control,
  name,
  label,
  disabled,
  ...input
}: {
  control: Control<SignupInput>;
  name: 'fullName' | 'businessName' | 'email' | 'phone' | 'postcode' | 'trade';
  label: string;
  disabled: boolean;
} & Pick<React.ComponentProps<'input'>, 'type' | 'placeholder' | 'autoComplete' | 'inputMode' | 'autoCapitalize'>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="gap-2">
          <FormLabel className={authLabelClassName}>{label}</FormLabel>
          <FormControl>
            <Input {...input} disabled={disabled} className={authInputClassName} {...field} />
          </FormControl>
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  );
}

/** Two-part sign-up: choose a plan, then your details; submits to Stripe Checkout via startSignup. */
export function SignupForm({
  initialChoice,
  founding,
  referrer,
  canceled,
  offers,
}: {
  initialChoice: PlanChoice;
  founding: FoundingView;
  referrer: { businessName: string; code: string } | null;
  canceled: boolean;
  offers: SignupOffers;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState(startSignup, initialState);
  const [choice, setChoice] = useState<PlanChoice>(initialChoice);
  const [step, setStep] = useState<Step>(canceled ? 'details' : 'plan');
  const [showPassword, setShowPassword] = useState(false);
  const stepChanged = useRef(false);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      plan: initialChoice.plan,
      interval: initialChoice.interval,
      businessName: '',
      fullName: '',
      email: '',
      password: '',
      phone: '',
      postcode: '',
      trade: '',
      ref: referrer?.code ?? '',
    },
  });

  const offer = offers[choice.plan][choice.interval];
  const includesLite = PLANS[choice.plan].products.includes('lite');
  const serverError = !state.success && state.error ? state.error : null;
  const referrerName = referrer ? referrer.businessName.trim() || 'A WorkWise customer' : null;

  useEffect(() => {
    if (!state.success && state.error) {
      toast.error(state.error);
    }
  }, [state.success, state.error, state.attemptedAt]);

  useEffect(() => {
    if (!stepChanged.current) return;
    window.scrollTo({ top: 0 });
    if (step === 'details') form.setFocus('fullName');
  }, [step, form]);

  function goTo(next: Step) {
    stepChanged.current = true;
    setStep(next);
  }

  function choose(next: PlanChoice) {
    setChoice(next);
    form.setValue('plan', next.plan);
    form.setValue('interval', next.interval);
    const params = new URLSearchParams({ plan: next.plan, interval: next.interval });
    for (const key of ['ref', 'canceled']) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const notes = (
    <>
      {canceled ? <CanceledNote /> : null}
      {referrerName ? <ReferralBanner name={referrerName} choice={choice} offer={offer} /> : null}
    </>
  );

  const signIn = (
    <p className="mt-5 border-t border-[#EBEBEA] pt-4 text-center text-sm text-[#5E5A54] dark:border-white/10 dark:text-[#A9B6C8]">
      Already have an account?{' '}
      <Link href="/login" className={authLinkClassName}>
        Sign in
      </Link>
    </p>
  );

  if (step === 'plan') {
    return (
      <AuthShell title="Choose your plan" subtitle="Pick what you need. You can add the other one later." side={choice.plan} step={1}>
        <div className="space-y-5">
          {notes}
          <PlanPicker choice={choice} founding={founding} referred={Boolean(referrer)} onChange={choose} />
          <div className="pt-1">
            <button type="button" className={authButtonClassName} style={{ background: SIDE_COLOUR[choice.plan] }} onClick={() => goTo('details')}>
              Continue
            </button>
          </div>
        </div>
        {signIn}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Your details"
      subtitle="This sets up your WorkWise login. You'll pay on the next screen."
      side={choice.plan}
      step={2}
    >
      <Form {...form}>
        <form
          action={formAction}
          className="space-y-5"
          onSubmit={(e) => {
            // Validate against current values (sync). formState.isValid stays
            // false until the first validation, which would block a valid first click.
            const parsed = signupSchema.safeParse({ ...form.getValues(), ...choice });
            if (!parsed.success) {
              e.preventDefault();
              void form.trigger();
            }
          }}
        >
          <input type="hidden" name="plan" value={choice.plan} />
          <input type="hidden" name="interval" value={choice.interval} />
          <input type="hidden" name="ref" value={referrer?.code ?? ''} />

          {notes}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EBEBEA] px-4 py-3 dark:border-white/10">
            <p className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-[#0A1A2E] dark:text-[#EAF1FB]">
              <span aria-hidden className="size-2.5 flex-shrink-0 rounded-full" style={{ background: PLAN_LOOK[choice.plan].accent }} />
              {PLANS[choice.plan].label} · {choice.interval === 'month' ? 'Monthly' : 'Yearly'}
            </p>
            <button
              type="button"
              onClick={() => goTo('plan')}
              disabled={isPending}
              className={cn(authLinkClassName, 'flex-shrink-0 text-sm')}
              aria-label="Change plan"
            >
              Change
            </button>
          </div>

          <TextField control={form.control} name="fullName" label="Your name" placeholder="Dave Smith" autoComplete="name" disabled={isPending} />
          <TextField
            control={form.control}
            name="businessName"
            label="Business name"
            placeholder="Dave's Window Cleaning"
            autoComplete="organization"
            disabled={isPending}
          />
          <TextField
            control={form.control}
            name="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            disabled={isPending}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem className="gap-2">
                <FormLabel className={authLabelClassName}>Password</FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      disabled={isPending}
                      className={cn(authInputClassName, 'pr-12')}
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="size-[18px]" aria-hidden />
                    ) : (
                      <Eye className="size-[18px]" aria-hidden />
                    )}
                  </button>
                </div>
                {fieldState.error ? null : (
                  <FormDescription className="text-[13px] text-[#6E6A63] dark:text-[#93A3BA]">
                    At least 8 characters
                  </FormDescription>
                )}
                <FormMessage role="alert" />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              control={form.control}
              name="phone"
              label="Mobile"
              type="tel"
              placeholder="07700 900000"
              autoComplete="tel"
              disabled={isPending}
            />
            <TextField
              control={form.control}
              name="postcode"
              label="Postcode"
              placeholder="SW1A 1AA"
              autoComplete="postal-code"
              autoCapitalize="characters"
              disabled={isPending}
            />
          </div>

          {includesLite ? (
            <TextField
              control={form.control}
              name="trade"
              label="What's your trade?"
              placeholder="e.g. plasterer, locksmith"
              disabled={isPending}
            />
          ) : null}

          <SignupSummary choice={choice} offer={offer} />

          {serverError ? <AuthAlert key={state.attemptedAt}>{serverError}</AuthAlert> : null}

          <div className="space-y-3 pt-1">
            <button type="submit" className={authButtonClassName} style={{ background: SIDE_COLOUR[choice.plan] }} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Taking you to payment…
                </>
              ) : (
                'Continue to payment'
              )}
            </button>
            <p className="text-center text-xs leading-relaxed text-[#6E6A63] dark:text-[#8696AC]">
              By continuing you agree to our{' '}
              <a href={`${SITE_URL}/terms`} className={authLinkClassName}>
                Terms
              </a>{' '}
              and{' '}
              <a href={`${SITE_URL}/privacy`} className={authLinkClassName}>
                Privacy policy
              </a>
              .
            </p>
          </div>
        </form>
      </Form>
      {signIn}
    </AuthShell>
  );
}
