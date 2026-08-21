'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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

type Phase = 'loading' | 'form' | 'submitting' | 'success';

interface SetNewPasswordFormProps {
  variant: 'admin' | 'worker';
}

export function SetNewPasswordForm({ variant }: SetNewPasswordFormProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    async function verifySession() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/forgot-password?error=link_expired');
        return;
      }

      setPhase('form');
    }

    void verifySession();
  }, [router]);

  useEffect(() => {
    if (phase !== 'success' || variant !== 'admin') return;

    const timer = window.setTimeout(() => {
      router.push('/dashboard');
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [phase, variant, router]);

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
    if (!validatePasswords()) return;

    setPhase('submitting');
    setSubmitError(null);

    const supabase = createBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setSubmitError(error.message);
      setPhase('form');
      return;
    }

    if (variant === 'worker') {
      await supabase.auth.signOut();
    }

    setPhase('success');
  }

  const isAdmin = variant === 'admin';

  const title =
    phase === 'success'
      ? 'Password updated'
      : phase === 'loading'
        ? 'Set a new password'
        : 'Set a new password';

  const description =
    phase === 'success'
      ? isAdmin
        ? 'Redirecting you to the dashboard...'
        : 'Your password has been reset. Open the WorkWise app on your phone to sign in with your new password.'
      : phase === 'loading'
        ? 'Verifying your reset link…'
        : 'Enter a new password for your WorkWise account';

  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="mb-6 flex justify-center">
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
        {phase === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
          </div>
        ) : phase === 'success' ? (
          isAdmin ? (
            <p className="text-center text-sm text-muted-foreground">
              Redirecting you to the dashboard...
            </p>
          ) : null
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={phase === 'submitting'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                  setSubmitError(null);
                }}
              />
              {passwordError ? (
                <p className="text-sm text-destructive">{passwordError}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={phase === 'submitting'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setConfirmError(null);
                  setSubmitError(null);
                }}
              />
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
              disabled={phase === 'submitting'}
            >
              {phase === 'submitting' ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Updating password…
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
