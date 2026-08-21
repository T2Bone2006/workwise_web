'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
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
  'Your invite link is invalid or has expired. Please ask your manager for a new invite.';

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleGetStarted() {
    if (!inviteToken) {
      setErrorMessage(DEFAULT_ERROR_MESSAGE);
      setPhase('error');
      return;
    }

    setPhase('loading');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/invite/validate', {
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
      const res = await fetch('/api/invite/confirm', {
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

      // Verify credentials work, then clear the web session — workers use the mobile app.
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

      await supabase.auth.signOut();
      setPhase('success');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    phase === 'interstitial'
      ? "You've been invited to WorkWise"
      : phase === 'success'
        ? "You're all set!"
        : phase === 'error'
          ? 'Invite link problem'
          : 'Welcome to WorkWise';

  const description =
    phase === 'interstitial'
      ? "You're just a few steps away from receiving jobs on the WorkWise app."
      : phase === 'loading'
        ? 'Setting up your account…'
        : phase === 'form'
          ? 'Create a password to finish setting up your account'
          : phase === 'success'
            ? 'Open the WorkWise app on your phone to sign in.'
            : phase === 'error'
              ? errorMessage ?? DEFAULT_ERROR_MESSAGE
              : null;

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
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {phase === 'interstitial' ? (
          <Button variant="gradient" className="w-full" onClick={() => void handleGetStarted()}>
            Get Started
          </Button>
        ) : phase === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Setting up your account…</p>
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
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={isSubmitting}
                  value={password}
                  className="pr-10"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                    setSubmitError(null);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={isSubmitting}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </Button>
              </div>
              {passwordError ? (
                <p className="text-sm text-destructive">{passwordError}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={isSubmitting}
                  value={confirmPassword}
                  className="pr-10"
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmError(null);
                    setSubmitError(null);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  disabled={isSubmitting}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </Button>
              </div>
              {confirmError ? (
                <p className="text-sm text-destructive">{confirmError}</p>
              ) : null}
            </div>
            {submitError ? (
              <p className="text-sm text-destructive">{submitError}</p>
            ) : null}
            <Button
              type="submit"
              variant="gradient"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Setting password…
                </>
              ) : (
                'Set Password & Sign In'
              )}
            </Button>
          </form>
        ) : phase === 'error' ? (
          <p className="text-sm text-muted-foreground text-center">
            Please ask your manager to send a new invitation.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AcceptInviteLoadingCard() {
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
          You&apos;ve been invited to WorkWise
        </CardTitle>
        <CardDescription>
          You&apos;re just a few steps away from receiving jobs on the WorkWise app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="gradient" className="w-full" disabled>
          Get Started
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<AcceptInviteLoadingCard />}>
      <AcceptInviteContent />
    </Suspense>
  );
}
