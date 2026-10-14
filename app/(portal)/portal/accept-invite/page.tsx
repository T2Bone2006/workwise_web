'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import {
  AuthAlert,
  AuthShell,
  authButtonClassName,
} from '@/components/auth/auth-shell';
import { PortalPasswordInput } from '@/components/portal/portal-password-input';

const DEFAULT_ERROR_MESSAGE =
  'Your invite link is invalid or has expired. Please contact your service provider for a new invite.';

const PORTAL_URL = '/portal';

type PagePhase = 'interstitial' | 'loading' | 'form' | 'success' | 'error';

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token')?.trim() || null;

  const [inviteToken] = useState(tokenFromUrl);
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

  useEffect(() => {
    if (phase === 'success') {
      window.location.href = PORTAL_URL;
    }
  }, [phase]);

  async function handleGetStarted() {
    if (!inviteToken) {
      setErrorMessage(DEFAULT_ERROR_MESSAGE);
      setPhase('error');
      return;
    }

    setPhase('loading');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/customer-invite/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      });

      const data = (await res.json()) as {
        email?: string;
        error?: string;
      };

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
    if (!validatePasswords() || !inviteToken) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/customer-invite/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, password }),
      });

      const data = (await res.json()) as {
        email?: string;
        password?: string;
        error?: string;
      };

      if (!res.ok) {
        setSubmitError(data.error ?? 'Failed to set password');
        setIsSubmitting(false);
        return;
      }

      const supabase = createBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email!,
        password: data.password!,
      });

      if (signInError) {
        setSubmitError(signInError.message);
        setIsSubmitting(false);
        return;
      }

      setPhase('success');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    phase === 'success'
      ? "You're all set"
      : phase === 'error'
        ? 'Invite link problem'
        : phase === 'form'
          ? 'Create your password'
          : "You've been invited";

  const subtitle =
    phase === 'interstitial' || phase === 'loading'
      ? 'See the jobs raised for you, and follow each one as it moves.'
      : phase === 'form'
        ? 'Choose a password to finish setting up the customer portal. At least 8 characters.'
        : phase === 'success'
          ? 'Taking you to the portal.'
          : errorMessage ?? DEFAULT_ERROR_MESSAGE;

  return (
    <AuthShell title={title} subtitle={subtitle} side="neutral">
      {phase === 'interstitial' ? (
        <button type="button" className={authButtonClassName} onClick={() => void handleGetStarted()}>
          Get started
        </button>
      ) : phase === 'loading' ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-[#5E5A54] dark:text-[#A9B6C8]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Setting up your account…
        </div>
      ) : phase === 'form' ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          {submitError ? <AuthAlert>{submitError}</AuthAlert> : null}
          <PortalPasswordInput
            id="password"
            label="Password"
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
                  Setting password…
                </>
              ) : (
                'Set password and sign in'
              )}
            </button>
          </div>
        </form>
      ) : phase === 'success' ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-[#5E5A54] dark:text-[#A9B6C8]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening the portal…
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
          Please contact your service provider for a new invitation.
        </p>
      )}
    </AuthShell>
  );
}

function AcceptInviteFallback() {
  return (
    <AuthShell
      title="You've been invited"
      subtitle="See the jobs raised for you, and follow each one as it moves."
      side="neutral"
    >
      <button type="button" className={authButtonClassName} disabled>
        Get started
      </button>
    </AuthShell>
  );
}

export default function PortalAcceptInvitePage() {
  return (
    <Suspense fallback={<AcceptInviteFallback />}>
      <AcceptInviteContent />
    </Suspense>
  );
}
