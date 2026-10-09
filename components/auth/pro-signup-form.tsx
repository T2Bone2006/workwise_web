'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Info, Loader2, Users } from 'lucide-react';
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
import { ProPlanPicker, ProTodayStrip } from '@/components/auth/pro-plan-picker';
import { cn } from '@/lib/utils';
import { startProSignup } from '@/lib/actions/pro-signup';
import { proSignupFormSchema, type ProSignupFormInput } from '@/lib/validations/pro-signup';
import { PRO_PLANS, type ProChoice } from '@/lib/billing/pro-plans';

type Step = 'plan' | 'details';

const initialState = {
  success: true as boolean,
  error: undefined as string | undefined,
  attemptedAt: undefined as number | undefined,
};

const NOTE_CLASS = 'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed';

function ReferrerNote({ name }: { name: string }) {
  return (
    <div className={cn(NOTE_CLASS, 'border-[#D6E4F8] bg-[#F3F7FD] font-medium text-[#0F2347] dark:border-[#5B8FE8]/25 dark:bg-[#5B8FE8]/10 dark:text-[#D7E4F7]')}>
      <Users className="mt-0.5 size-4 flex-shrink-0 text-[#0C66E4] dark:text-[#7FAAF0]" aria-hidden />
      <p>{name} sent you here.</p>
    </div>
  );
}

function CanceledNote() {
  return (
    <div className={cn(NOTE_CLASS, 'border-[#D6E4F8] bg-[#F3F7FD] text-[#0F2347] dark:border-[#5B8FE8]/25 dark:bg-[#5B8FE8]/10 dark:text-[#D7E4F7]')}>
      <Info className="mt-0.5 size-4 flex-shrink-0 text-[#0C66E4] dark:text-[#7FAAF0]" aria-hidden />
      <p>
        No payment was taken. Pick up where you left off: use the same email and password and you&apos;ll go straight back to
        payment.
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
  control: Control<ProSignupFormInput>;
  name: 'fullName' | 'businessName' | 'email' | 'phone' | 'trade';
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

function PasswordField({
  control,
  name,
  label,
  disabled,
  hint,
}: {
  control: Control<ProSignupFormInput>;
  name: 'password' | 'confirmPassword';
  label: string;
  disabled: boolean;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className="gap-2">
          <FormLabel className={authLabelClassName}>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={disabled}
                className={cn(authInputClassName, 'pr-12')}
                {...field}
              />
            </FormControl>
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
              tabIndex={-1}
            >
              {show ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
            </button>
          </div>
          {hint && !fieldState.error ? (
            <FormDescription className="text-[13px] text-[#6E6A63] dark:text-[#93A3BA]">{hint}</FormDescription>
          ) : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  );
}

/** Two-part Pro sign-up: team size and plan, then your details; submits to Stripe Checkout via startProSignup. */
export function ProSignupForm({
  initialChoice,
  initialWorkers,
  referrer,
  canceled,
}: {
  initialChoice: ProChoice;
  initialWorkers: number;
  referrer: { businessName: string; code: string } | null;
  canceled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(startProSignup, initialState);
  const [choice, setChoice] = useState<ProChoice>(initialChoice);
  const [workers, setWorkers] = useState(initialWorkers);
  const [step, setStep] = useState<Step>(canceled ? 'details' : 'plan');
  const stepChanged = useRef(false);

  const form = useForm<ProSignupFormInput>({
    resolver: zodResolver(proSignupFormSchema),
    defaultValues: {
      tier: initialChoice.tier,
      interval: initialChoice.interval,
      workers: initialWorkers,
      businessName: '',
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      phone: '',
      trade: '',
      ref: referrer?.code ?? '',
    },
  });

  const serverError = !state.success && state.error ? state.error : null;
  const referrerName = referrer ? referrer.businessName.trim() || 'A WorkWise customer' : null;
  const plan = PRO_PLANS[choice.tier];

  useEffect(() => {
    if (!state.success && state.error) toast.error(state.error);
  }, [state.success, state.error, state.attemptedAt]);

  useEffect(() => {
    if (!stepChanged.current) return;
    window.scrollTo({ top: 0 });
    if (step === 'details') form.setFocus('fullName');
  }, [step, form]);

  // Keep the address bar in step with the choice so a refresh (or a shared link) keeps it. No navigation.
  function remember(next: ProChoice, count: number) {
    const params = new URLSearchParams(window.location.search);
    params.set('tier', next.tier);
    params.set('interval', next.interval);
    params.set('workers', String(count));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }

  function goTo(next: Step) {
    stepChanged.current = true;
    setStep(next);
  }

  function chooseChoice(next: ProChoice) {
    setChoice(next);
    form.setValue('tier', next.tier);
    form.setValue('interval', next.interval);
    remember(next, workers);
  }

  function chooseWorkers(count: number) {
    setWorkers(count);
    form.setValue('workers', count);
    remember(choice, count);
  }

  const notes = (
    <>
      {canceled ? <CanceledNote /> : null}
      {referrerName ? <ReferrerNote name={referrerName} /> : null}
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
      <AuthShell
        title="How big is your team?"
        subtitle="Move the slider to your number of workers and we'll show the plan that costs least."
        side="pro"
        step={1}
      >
        <div className="space-y-5">
          {notes}
          <ProPlanPicker choice={choice} workers={workers} onChoice={chooseChoice} onWorkers={chooseWorkers} />
          <ProTodayStrip choice={choice} workers={workers} />
          <div className="pt-1">
            <button type="button" className={authButtonClassName} onClick={() => goTo('details')}>
              Continue with {plan.name}
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
      side="pro"
      step={2}
    >
      <Form {...form}>
        <form
          action={formAction}
          className="space-y-5"
          onSubmit={(e) => {
            // Validate against current values (sync). formState.isValid stays false until the first
            // validation, which would block a valid first click.
            const parsed = proSignupFormSchema.safeParse({ ...form.getValues(), ...choice, workers });
            if (!parsed.success) {
              e.preventDefault();
              void form.trigger();
            }
          }}
        >
          <input type="hidden" name="tier" value={choice.tier} />
          <input type="hidden" name="interval" value={choice.interval} />
          <input type="hidden" name="workers" value={workers} />
          <input type="hidden" name="ref" value={referrer?.code ?? ''} />

          {notes}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EBEBEA] px-4 py-3 dark:border-white/10">
            <p className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-[#0A1A2E] dark:text-[#EAF1FB]">
              <span aria-hidden className="size-2.5 flex-shrink-0 rounded-full bg-[#0C66E4]" />
              <span className="min-w-0">
                {plan.name} · {choice.interval === 'month' ? 'Monthly' : 'Yearly'} · {workers} {workers === 1 ? 'worker' : 'workers'}
              </span>
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
            placeholder="Smith & Sons Locksmiths"
            autoComplete="organization"
            disabled={isPending}
          />
          <TextField control={form.control} name="email" label="Email" type="email" placeholder="you@example.com" autoComplete="email" disabled={isPending} />
          <PasswordField control={form.control} name="password" label="Password" disabled={isPending} hint="At least 8 characters" />
          <PasswordField control={form.control} name="confirmPassword" label="Confirm password" disabled={isPending} />
          <TextField control={form.control} name="phone" label="Mobile number" type="tel" placeholder="07700 900000" autoComplete="tel" disabled={isPending} />
          <TextField
            control={form.control}
            name="trade"
            label="What does your business do?"
            placeholder="e.g. Locksmith, plumbing and heating"
            disabled={isPending}
          />

          <ProTodayStrip choice={choice} workers={workers} />

          {serverError ? <AuthAlert key={state.attemptedAt}>{serverError}</AuthAlert> : null}

          <div className="space-y-3 pt-1">
            <button type="submit" className={authButtonClassName} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Taking you to payment…
                </>
              ) : (
                'Go to payment'
              )}
            </button>
            <p className="text-center text-xs leading-relaxed text-[#6E6A63] dark:text-[#8696AC]">
              You&apos;ll pay on Stripe&apos;s secure page. WorkWise isn&apos;t VAT registered, so no VAT is added today. If that changes, VAT will be added to Pro plans with at least 30 days&apos; notice. Cancel any time. By continuing you agree to our{' '}
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
