'use client';

import { useEffect, useRef, useState } from 'react';
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

export default function AcceptInvitePage() {
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    function clearSessionTimeout() {
      if (sessionTimeoutRef.current !== null) {
        clearTimeout(sessionTimeoutRef.current);
        sessionTimeoutRef.current = null;
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        clearSessionTimeout();
        setHasSession(true);
        setSessionReady(true);
      }
    });

    // Fallback — if no session after 4 seconds, stop loading (hasSession stays false)
    sessionTimeoutRef.current = setTimeout(() => {
      sessionTimeoutRef.current = null;
      setSessionReady(true);
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearSessionTimeout();
    };
  }, []);

  function validate(): boolean {
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
    if (!validate()) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const supabase = createBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

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
          Welcome to WorkWise
        </CardTitle>
        <CardDescription>
          {sessionReady && !hasSession
            ? 'Your invite link is invalid or has expired. Please ask your manager for a new invite.'
            : 'Create a password to finish setting up your account'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!sessionReady ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Setting up your account…</p>
          </div>
        ) : hasSession ? (
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
                disabled={isSubmitting}
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
        ) : null}
      </CardContent>
    </Card>
  );
}
