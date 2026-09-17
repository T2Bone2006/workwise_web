import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignupForm } from '@/components/auth/signup-form';
import { isSelfServeProduct, PRODUCT_LABELS, TRIAL_DAYS } from '@/lib/stripe/products';

export const metadata: Metadata = {
  title: 'Sign up | WorkWise',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; canceled?: string }>;
}) {
  const params = await searchParams;
  const product = isSelfServeProduct(params.product) ? params.product : 'rounds';

  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="mb-4 flex justify-center">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={96}
            height={96}
            className="h-auto w-[96px] object-contain"
            priority
          />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Start your {PRODUCT_LABELS[product]} trial
        </CardTitle>
        <CardDescription>
          {TRIAL_DAYS} days free, then £29/month. Cancel any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {params.canceled && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Checkout was cancelled. Your details are safe; you can pick up where you left off.
          </p>
        )}
        <Suspense fallback={null}>
          <SignupForm product={product} />
        </Suspense>
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="underline underline-offset-2 hover:text-foreground">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
