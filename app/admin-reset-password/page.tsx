'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const DEFAULT_ERROR_MESSAGE = 'This reset link is invalid or has expired.';

type PagePhase = 'interstitial' | 'loading' | 'form' | 'error';

function AdminResetPasswordContent() {
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

      window.location.href = 'https://app.joinworkwise.com/dashboard';
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    phase === 'interstitial'
      ? 'Reset your password'
      : phase === 'error'
        ? 'Reset link problem'
        : 'Set a new password';

  const description =
    phase === 'interstitial'
      ? 'Click below to continue resetting your WorkWise password'
      : phase === 'loading'
        ? 'Validating your reset link…'
        : phase === 'form'
          ? 'Choose a new password for your WorkWise dashboard'
          : errorMessage ?? DEFAULT_ERROR_MESSAGE;

  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-6">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={120}
            height={120}
            className="h-auto w-[120px] object-contain"
            priority
          />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {phase === 'interstitial' ? (
          <Button variant="gradient" className="w-full" onClick={() => void handleContinue()}>
            Continue
          </Button>
        ) : phase === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Validating your reset link…</p>
          </div>
        ) : phase === 'form' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={isSubmitting}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                  setSubmitError(null);
                }}
              />
              {passwordError ? <p className="text-sm text-destructive">{passwordError}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={isSubmitting}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setConfirmError(null);
                  setSubmitError(null);
                }}
              />
              {confirmError ? <p className="text-sm text-destructive">{confirmError}</p> : null}
            </div>
            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            <Button type="submit" variant="gradient" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Updating password…
                </>
              ) : (
                'Set New Password'
              )}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            This reset link is invalid or has expired.{' '}
            <Link href="/forgot-password" className="text-primary hover:underline">
              Request a new link
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AdminResetPasswordLoadingCard() {
  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-6">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={120}
            height={120}
            className="h-auto w-[120px] object-contain"
            priority
          />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Reset your password
        </CardTitle>
        <CardDescription>
          Click below to continue resetting your WorkWise password
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="gradient" className="w-full" disabled>
          Continue
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <Suspense fallback={<AdminResetPasswordLoadingCard />}>
      <AdminResetPasswordContent />
    </Suspense>
  );
}
