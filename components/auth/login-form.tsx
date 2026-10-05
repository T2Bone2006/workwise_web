'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  AuthAlert,
  SITE_URL,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
  authLinkClassName,
} from '@/components/auth/auth-shell';
import { cn } from '@/lib/utils';
import { login } from '@/lib/actions/auth';
import {
  WORKER_WEB_LOGIN_ERROR,
  WORKER_WEB_LOGIN_ERROR_PARAM,
} from '@/lib/auth/worker-web-access';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

const initialState = {
  success: true as boolean,
  error: undefined as string | undefined,
  attemptedAt: undefined as number | undefined,
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const error =
    !state.success && state.error
      ? state.error
      : searchParams.get('error') === WORKER_WEB_LOGIN_ERROR_PARAM
        ? WORKER_WEB_LOGIN_ERROR
        : null;
  const closedNotice =
    searchParams.get('closed') === '1'
      ? 'Your account is closed. Check your email for the details.'
      : null;

  return (
    <Form {...form}>
      <form action={formAction} className="space-y-5">
        {error ? (
          <AuthAlert key={state.attemptedAt ?? 'param'}>{error}</AuthAlert>
        ) : closedNotice ? (
          <AuthAlert key="closed">{closedNotice}</AuthAlert>
        ) : null}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className={authLabelClassName}>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  disabled={isPending}
                  className={authInputClassName}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className={authLabelClassName}>Password</FormLabel>
              <div className="relative">
                <FormControl>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={isPending}
                    className={cn(authInputClassName, 'pr-12')}
                    {...field}
                  />
                </FormControl>
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
                  onClick={() => setShowPassword((v) => !v)}
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
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="pt-1">
          <button type="submit" className={authButtonClassName} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </div>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className={authLinkClassName}>
            Forgot password?
          </Link>
        </p>
      </form>
      <p className="mt-8 border-t border-[#EBEBEA] pt-6 text-center text-sm text-[#5E5A54] dark:border-white/10 dark:text-[#A9B6C8]">
        New to WorkWise?{' '}
        <a href={`${SITE_URL}/pricing`} className={authLinkClassName}>
          See the plans
        </a>
      </p>
    </Form>
  );
}
