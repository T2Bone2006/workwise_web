'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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

type Phase = 'form' | 'sent';

const ADMIN_RESET_CALLBACK =
  'https://app.joinworkwise.com/auth/callback?next=/admin-reset-password';

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const linkExpired = searchParams.get('error') === 'link_expired';

  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: ADMIN_RESET_CALLBACK,
    });

    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setPhase('sent');
  }

  if (phase === 'sent') {
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
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Check your email
          </CardTitle>
          <CardDescription className="space-y-2">
            <span className="block">We&apos;ve sent a reset link to {email}.</span>
            <span className="block">
              Click the link in the email to set a new password.
            </span>
            <span className="block">
              Didn&apos;t get it? Check your spam folder.
            </span>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

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
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Reset your password
        </CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send you a reset link
        </CardDescription>
      </CardHeader>
      <CardContent>
        {linkExpired ? (
          <div
            className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            Your reset link has expired. Request a new one below.
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={isSubmitting}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            type="submit"
            variant="gradient"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Sending…' : 'Send Reset Link'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  );
}
