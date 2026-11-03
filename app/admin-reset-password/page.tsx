'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AuthAlert,
  AuthShell,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
} from '@/components/auth/auth-shell';

const EXPIRED_TITLE = 'This link has expired or has already been used.';

type PagePhase = 'interstitial' | 'loading' | 'form' | 'error';

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-destructive">
      {children}
    </p>
  );
}

function AdminResetPasswordContent() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token')?.trim() || null;

  const [resetToken] = useState(tokenFromUrl);
  const [phase, setPhase] = useState<PagePhase>(tokenFromUrl ? 'interstitial' : 'error');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleContinue() {
    if (!resetToken) {
      setPhase('error');
      return;
    }

    setPhase('loading');

    try {
      const res = await fetch('/api/password-reset/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken }),
      });

      if (!res.ok) {
        setPhase('error');
        return;
      }

      setPhase('form');
    } catch {
      setPhase('error');
    }
  }

  function validatePasswords(): boolean {
    let valid = true;
    setPasswordError(null);
    setConfirmError(null);
    setSubmitError(null);

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      valid = false;
    }

    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match');
      valid = false;
    }

    return valid;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validatePasswords() || !resetToken) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? 'Failed to reset password');
        return;
      }

      window.location.href = 'https://app.joinworkwise.com/dashboard';
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (phase === 'error') {
    return (
      <AuthShell title={EXPIRED_TITLE} subtitle="Reset links work once and last 24 hours.">
        <div className="space-y-5">
          <Link href="/forgot-password" className={authButtonClassName}>
            Send me a new link
          </Link>
          <p className="text-balance text-center text-sm text-[#5E5A54] dark:text-[#A9B6C8]">
            Work for a company on WorkWise? Ask your manager for a new link.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'interstitial' || phase === 'loading') {
    return (
      <AuthShell
        title="Choose a new password"
        subtitle="Press continue to pick a new password for your WorkWise account."
      >
        <button
          type="button"
          className={authButtonClassName}
          disabled={phase === 'loading'}
          onClick={() => void handleContinue()}
        >
          {phase === 'loading' ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking your link…
            </>
          ) : (
            'Continue'
          )}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={handleSubmit} className="space-y-5">
        {submitError ? <AuthAlert>{submitError}</AuthAlert> : null}
        <div className="grid gap-2">
          <Label htmlFor="password" className={authLabelClassName}>
            New password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              disabled={isSubmitting}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? 'password-error' : 'password-hint'}
              className={`${authInputClassName} pr-12`}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
                setSubmitError(null);
              }}
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
              onClick={() => setShowPassword((v) => !v)}
              disabled={isSubmitting}
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
          {passwordError ? (
            <FieldError id="password-error">{passwordError}</FieldError>
          ) : (
            <p id="password-hint" className="text-sm text-[#6E6A63] dark:text-[#93A3BA]">
              At least 8 characters.
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-password" className={authLabelClassName}>
            Type it again
          </Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              disabled={isSubmitting}
              aria-invalid={Boolean(confirmError)}
              aria-describedby={confirmError ? 'confirm-error' : undefined}
              className={`${authInputClassName} pr-12`}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setConfirmError(null);
                setSubmitError(null);
              }}
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
              onClick={() => setShowConfirm((v) => !v)}
              disabled={isSubmitting}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showConfirm ? (
                <EyeOff className="size-[18px]" aria-hidden />
              ) : (
                <Eye className="size-[18px]" aria-hidden />
              )}
            </button>
          </div>
          {confirmError ? <FieldError id="confirm-error">{confirmError}</FieldError> : null}
        </div>
        <div className="pt-1">
          <button type="submit" className={authButtonClassName} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              'Save and sign in'
            )}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

function AdminResetPasswordFallback() {
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Press continue to pick a new password for your WorkWise account."
    >
      <button type="button" className={authButtonClassName} disabled>
        Continue
      </button>
    </AuthShell>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <Suspense fallback={<AdminResetPasswordFallback />}>
      <AdminResetPasswordContent />
    </Suspense>
  );
}
