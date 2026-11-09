'use client';

import { Suspense, useState } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
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

const DEFAULT_ERROR_MESSAGE =
  'This reset link is invalid or has expired. Ask your manager to send a new reset link.';

type PagePhase = 'interstitial' | 'loading' | 'form' | 'success' | 'error';

function ResetPasswordContent() {
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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

      setPhase('success');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    phase === 'interstitial'
      ? 'Reset your password'
      : phase === 'success'
        ? 'Password updated'
        : phase === 'error'
          ? 'Reset link problem'
          : 'Set a new password';

  const description =
    phase === 'interstitial'
      ? 'Click below to continue resetting your WorkWise password'
      : phase === 'loading'
        ? 'Validating your reset link…'
        : phase === 'form'
          ? 'Create a new password to sign in to WorkWise'
          : phase === 'success'
            ? 'Your password has been reset. Open the WorkWise app on your phone to sign in.'
            : errorMessage ?? DEFAULT_ERROR_MESSAGE;

  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-6">
          <BrandMark width={120} alt="WorkWise" priority />
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  value={password}
                  className="pr-12"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                    setSubmitError(null);
                  }}
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground"
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
              {passwordError ? <p className="text-sm text-destructive">{passwordError}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  value={confirmPassword}
                  className="pr-12"
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmError(null);
                    setSubmitError(null);
                  }}
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground"
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
        ) : phase === 'error' ? (
          <p className="text-sm text-muted-foreground text-center">
            This reset link is invalid or has expired. Ask your manager to send a new reset link.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResetPasswordLoadingCard() {
  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-6">
          <BrandMark width={120} alt="WorkWise" priority />
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordLoadingCard />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
