'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  AuthAlert,
  AuthShell,
  authButtonClassName,
  authLinkClassName,
} from '@/components/auth/auth-shell';
import { PortalPasswordInput } from '@/components/portal/portal-password-input';

const DEFAULT_ERROR_MESSAGE = 'This reset link is invalid or has expired.';
const PORTAL_LOGIN_PATH = '/login';

type PagePhase = 'interstitial' | 'loading' | 'form' | 'error';

function PortalResetPasswordContent() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token')?.trim() || null;

  const [resetToken] = useState(tokenFromUrl);
  const [phase, setPhase] = useState<PagePhase>(tokenFromUrl ? 'interstitial' : 'error');
  const [errorMessage, setErrorMessage] = useState<string | null>(
    tokenFromUrl ? null : DEFAULT_ERROR_MESSAGE
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleContinue() {
    if (!resetToken) {
      setErrorMessage(DEFAULT_ERROR_MESSAGE);
      setPhase('error');
      return;
    }

    setPhase('loading');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/password-reset/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? DEFAULT_ERROR_MESSAGE);
        setPhase('error');
        return;
      }

      setPhase('form');
    } catch {
      setErrorMessage(DEFAULT_ERROR_MESSAGE);
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

      window.location.href = PORTAL_LOGIN_PATH;
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    phase === 'interstitial' || phase === 'loading'
      ? 'Reset your password'
      : phase === 'error'
        ? 'Reset link problem'
        : 'Set a new password';

  const subtitle =
    phase === 'interstitial' || phase === 'loading'
      ? 'Confirm this link, then choose a new password for the customer portal.'
      : phase === 'form'
        ? 'Choose a new password for the customer portal. At least 8 characters.'
        : errorMessage ?? DEFAULT_ERROR_MESSAGE;

  return (
    <AuthShell title={title} subtitle={subtitle} side="neutral">
      {phase === 'interstitial' ? (
        <button type="button" className={authButtonClassName} onClick={() => void handleContinue()}>
          Continue
        </button>
      ) : phase === 'loading' ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-[#5E5A54] dark:text-[#A9B6C8]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking your link…
        </div>
      ) : phase === 'form' ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          {submitError ? <AuthAlert>{submitError}</AuthAlert> : null}
          <PortalPasswordInput
            id="password"
            label="New password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setPasswordError(null);
              setSubmitError(null);
            }}
            disabled={isSubmitting}
            autoComplete="new-password"
            error={passwordError}
          />
          <PortalPasswordInput
            id="confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={(value) => {
              setConfirmPassword(value);
              setConfirmError(null);
              setSubmitError(null);
            }}
            disabled={isSubmitting}
            autoComplete="new-password"
            error={confirmError}
          />
          <div className="pt-1">
            <button type="submit" className={authButtonClassName} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Updating password…
                </>
              ) : (
                'Set new password'
              )}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
          This reset link is invalid or has expired.{' '}
          <Link href="/forgot-password" className={authLinkClassName}>
            Request a new link
          </Link>
          .
        </p>
      )}
    </AuthShell>
  );
}

function PortalResetPasswordFallback() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Confirm this link, then choose a new password for the customer portal."
      side="neutral"
    >
      <button type="button" className={authButtonClassName} disabled>
        Continue
      </button>
    </AuthShell>
  );
}

export default function PortalResetPasswordPage() {
  return (
    <Suspense fallback={<PortalResetPasswordFallback />}>
      <PortalResetPasswordContent />
    </Suspense>
  );
}
