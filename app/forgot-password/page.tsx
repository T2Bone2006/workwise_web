'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import { requestPasswordReset } from '@/lib/actions/auth';
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

type Phase = 'form' | 'sent';

export default function ForgotPasswordPage() {
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await requestPasswordReset(email);
      if (!result.success) {
        setError(result.error ?? 'Failed to send reset link');
        return;
      }
      setPhase('sent');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (phase === 'sent') {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`If there's an account for ${email}, a reset link is on its way.`}
      >
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-xl border border-[#EBEBEA] bg-[#FAFAF8] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
              <MailCheck className="size-[18px]" aria-hidden />
            </span>
            <p className="text-sm leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
              Open the link in the email to choose a new password. Didn&apos;t get it? Check your
              spam folder.
            </p>
          </div>
          <Link href="/login" className={authSecondaryButtonClassName}>
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you sign in with and we'll send you a link."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <AuthAlert>{error}</AuthAlert> : null}
        <div className="grid gap-2">
          <Label htmlFor="email" className={authLabelClassName}>
            Email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            required
            disabled={isSubmitting}
            className={authInputClassName}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="pt-1">
          <button type="submit" className={authButtonClassName} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Sending…
              </>
            ) : (
              'Send reset link'
            )}
          </button>
        </div>
        <p className="text-center text-sm">
          <Link href="/login" className={authLinkClassName}>
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
