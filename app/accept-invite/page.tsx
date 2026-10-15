'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AuthAlert,
  AuthShell,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
  authLinkClassName,
  authSecondaryButtonClassName,
} from '@/components/auth/auth-shell';
import { BusinessSetupFields, type BusinessSetupValues } from '@/components/auth/business-setup-fields';
import { APP_DOWNLOAD_PATH } from '@/lib/app-stores';
import { WORKER_HOME } from '@/lib/auth/worker-web-access';

const DEFAULT_ERROR_MESSAGE =
  'Your invite link is invalid or has expired. Please ask your manager for a new invite.';

type Phase = 'checking' | 'form' | 'done' | 'error';
type InviteInfo = { kind: 'employee' | 'business'; employerName: string; workerName: string; email: string };

const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

function PasswordField({
  id,
  label,
  value,
  show,
  onToggle,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  show: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={authLabelClassName}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          placeholder="••••••••"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          className={`${authInputClassName} pr-12`}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
          onClick={onToggle}
          disabled={disabled}
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {show ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
        </button>
      </div>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() || null;

  const [phase, setPhase] = useState<Phase>(token ? 'checking' : 'error');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>(DEFAULT_ERROR_MESSAGE);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [business, setBusiness] = useState<BusinessSetupValues>({ businessName: '', trade: '', postcode: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Look the invite up as soon as the page opens, so the welcome can name the employer.
  // Looking is harmless: the link is only used up when the form is sent.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/invite/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as Partial<InviteInfo> & { error?: string; employerName?: string | null; workerName?: string | null };
        if (cancelled) return;
        if (!res.ok) {
          setErrorMessage(data.error ?? DEFAULT_ERROR_MESSAGE);
          setPhase('error');
          return;
        }
        setInfo({
          kind: data.kind === 'business' ? 'business' : 'employee',
          employerName: data.employerName?.trim() || 'Your manager',
          workerName: data.workerName?.trim() || '',
          email: data.email ?? '',
        });
        setPhase('form');
      } catch {
        if (cancelled) return;
        setErrorMessage(DEFAULT_ERROR_MESSAGE);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function validate(): boolean {
    let ok = true;
    setPasswordError(null);
    setConfirmError(null);
    setNameError(null);
    setSubmitError(null);
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      ok = false;
    }
    if (password !== confirm) {
      setConfirmError('Passwords do not match');
      ok = false;
    }
    if (info?.kind === 'business' && business.businessName.trim().length < 2) {
      setNameError('Please enter your business name.');
      ok = false;
    }
    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !info || submitting || !validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/invite/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          ...(info.kind === 'business' ? { business } : {}),
        }),
      });
      const data = (await res.json()) as { email?: string; password?: string; error?: string };
      if (!res.ok || !data.email || !data.password) {
        setSubmitError(data.error ?? 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }

      // Keep the session: workers use the website too, so they go straight in.
      const supabase = createBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError) {
        setSubmitError(`Your account is ready, but we couldn't sign you in: ${signInError.message}`);
        setSubmitting(false);
        return;
      }
      setPhase('done');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'checking') {
    return (
      <AuthShell title="One moment" subtitle="Checking your invite…">
        <div className="flex items-center gap-3 py-4 text-sm text-[#5E5A54] dark:text-[#A9B6C8]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Opening your invite
        </div>
      </AuthShell>
    );
  }

  if (phase === 'error' || !info) {
    return (
      <AuthShell title="Invite link problem" subtitle={errorMessage}>
        <p className="text-sm leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
          Please ask your manager to send a new invitation.
        </p>
        <p className="mt-5 text-sm">
          <Link href="/login" className={authLinkClassName}>
            Already set up? Log in
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (phase === 'done') {
    return (
      <AuthShell title="You're all set" subtitle="Welcome to WorkWise.">
        <div className="space-y-3">
          <Link href={WORKER_HOME} className={authButtonClassName}>
            {info.kind === 'business' ? 'Go to my dashboard' : 'See my jobs'}
          </Link>
          <a href={APP_DOWNLOAD_PATH} className={authSecondaryButtonClassName}>
            Get the app
          </a>
          <p className="text-center text-xs text-[#6E6A63] dark:text-[#8696AC]">
            The app is where you accept jobs and finish them on site. Sign in with the email and password you just set.
          </p>
        </div>
      </AuthShell>
    );
  }

  const first = firstNameOf(info.workerName);
  const isBusiness = info.kind === 'business';

  return (
    <AuthShell
      title={first ? `Welcome, ${first}` : 'Welcome to WorkWise'}
      subtitle={
        isBusiness
          ? `${info.employerName} invited you to WorkWise. Choose a password and tell us about your business. It takes about two minutes.`
          : `${info.employerName} invited you to WorkWise. Choose a password to finish setting up. It takes about a minute.`
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError ? <AuthAlert>{submitError}</AuthAlert> : null}
        {info.email ? (
          <div className="space-y-2">
            <Label htmlFor="invite-email" className={authLabelClassName}>
              Email
            </Label>
            <Input id="invite-email" type="email" value={info.email} readOnly className={authInputClassName} autoComplete="username" />
          </div>
        ) : null}
        <PasswordField
          id="password"
          label="Password"
          value={password}
          show={showPassword}
          onToggle={() => setShowPassword((v) => !v)}
          onChange={(v) => {
            setPassword(v);
            setPasswordError(null);
            setSubmitError(null);
          }}
          error={passwordError}
          disabled={submitting}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm password"
          value={confirm}
          show={showConfirm}
          onToggle={() => setShowConfirm((v) => !v)}
          onChange={(v) => {
            setConfirm(v);
            setConfirmError(null);
            setSubmitError(null);
          }}
          error={confirmError}
          disabled={submitting}
        />
        {isBusiness ? (
          <BusinessSetupFields
            values={business}
            onChange={(next) => {
              setBusiness(next);
              setNameError(null);
              setSubmitError(null);
            }}
            nameError={nameError}
            employerName={info.employerName}
            disabled={submitting}
          />
        ) : null}
        <button type="submit" className={authButtonClassName} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {isBusiness ? 'Setting up your account…' : 'Creating your account…'}
            </>
          ) : isBusiness ? (
            'Set up my account'
          ) : (
            'Create my account'
          )}
        </button>
      </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <AuthShell title="One moment" subtitle="Opening your invite…">
          <div className="py-4" />
        </AuthShell>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
